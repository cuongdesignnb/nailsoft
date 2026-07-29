-- Sprint 11 closure: campaign delivery, consent races, review delay and compensation synchronization.
BEGIN;

ALTER TABLE communication_settings
  ADD COLUMN review_request_delay_hours integer NOT NULL DEFAULT 24 CHECK(review_request_delay_hours BETWEEN 0 AND 720),
  ADD COLUMN review_request_policy_version integer NOT NULL DEFAULT 1 CHECK(review_request_policy_version > 0),
  ADD COLUMN review_requests_enabled_from timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN campaign_audience_limit integer NOT NULL DEFAULT 100000 CHECK(campaign_audience_limit BETWEEN 1 AND 1000000);

ALTER TABLE communication_messages
  ADD COLUMN claim_token uuid,
  ADD COLUMN claim_expires_at timestamptz,
  ADD COLUMN consent_state_version integer,
  ADD COLUMN preference_version integer,
  ADD COLUMN suppression_generation bigint,
  ADD COLUMN frequency_reservation_id uuid;

CREATE TABLE communication_suppression_generations (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  purpose text NOT NULL,
  generation bigint NOT NULL DEFAULT 0 CHECK(generation >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,customer_id,purpose),
  FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id) ON DELETE CASCADE
);
INSERT INTO communication_suppression_generations(tenant_id,customer_id,purpose,generation)
SELECT tenant_id,customer_id,purpose,count(*)::bigint
FROM communication_suppressions
WHERE customer_id IS NOT NULL AND purpose IS NOT NULL
GROUP BY tenant_id,customer_id,purpose
ON CONFLICT DO NOTHING;

CREATE FUNCTION sprint11_bump_suppression_generation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p text;
BEGIN
  p := COALESCE(NEW.purpose, OLD.purpose, 'GLOBAL');
  IF COALESCE(NEW.customer_id,OLD.customer_id) IS NOT NULL THEN
    INSERT INTO communication_suppression_generations(tenant_id,customer_id,purpose,generation)
    VALUES(COALESCE(NEW.tenant_id,OLD.tenant_id),COALESCE(NEW.customer_id,OLD.customer_id),p,1)
    ON CONFLICT(tenant_id,customer_id,purpose) DO UPDATE
      SET generation=communication_suppression_generations.generation+1,updated_at=now();
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER communication_suppressions_generation
AFTER INSERT OR UPDATE OF active OR DELETE ON communication_suppressions
FOR EACH ROW EXECUTE FUNCTION sprint11_bump_suppression_generation();

CREATE TABLE marketing_frequency_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  customer_id uuid NOT NULL,
  message_id uuid NOT NULL,
  window_started_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','CONSUMED','RELEASED','EXPIRED')),
  lease_expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY(tenant_id,message_id) REFERENCES communication_messages(tenant_id,id)
);
CREATE UNIQUE INDEX marketing_frequency_reservations_active_message
  ON marketing_frequency_reservations(tenant_id,message_id) WHERE status='ACTIVE';
CREATE INDEX marketing_frequency_reservations_gate
  ON marketing_frequency_reservations(tenant_id,customer_id,status,lease_expires_at);
ALTER TABLE communication_messages ADD CONSTRAINT communication_messages_frequency_reservation_fk
  FOREIGN KEY(tenant_id,frequency_reservation_id) REFERENCES marketing_frequency_reservations(tenant_id,id);

ALTER TABLE marketing_campaign_audience DROP CONSTRAINT marketing_campaign_audience_status_check;
ALTER TABLE marketing_campaign_audience ADD CONSTRAINT marketing_campaign_audience_status_check
  CHECK(status IN('ELIGIBLE','SENT','SKIPPED','SUPPRESSED','CANCELLED','FAILED'));
ALTER TABLE marketing_campaigns
  ADD COLUMN final_generation integer,
  ADD COLUMN sent_total integer NOT NULL DEFAULT 0 CHECK(sent_total>=0),
  ADD COLUMN suppressed_total integer NOT NULL DEFAULT 0 CHECK(suppressed_total>=0),
  ADD COLUMN failed_total integer NOT NULL DEFAULT 0 CHECK(failed_total>=0),
  ADD COLUMN cancelled_total integer NOT NULL DEFAULT 0 CHECK(cancelled_total>=0);

ALTER TABLE review_requests
  ADD COLUMN due_at timestamptz DEFAULT now(),
  ADD COLUMN policy_version integer NOT NULL DEFAULT 1 CHECK(policy_version>0);
UPDATE review_requests SET due_at=COALESCE(sent_at,created_at) WHERE due_at IS NULL;
ALTER TABLE review_requests ALTER COLUMN due_at SET NOT NULL;
CREATE INDEX review_requests_due_idx ON review_requests(status,due_at,expires_at);

ALTER TABLE service_recovery_compensation_requests
  ADD COLUMN sync_status text NOT NULL DEFAULT 'NOT_STARTED' CHECK(sync_status IN('NOT_STARTED','PENDING','POSTED','FAILED','REJECTED','CANCELLED')),
  ADD COLUMN sync_error_code text,
  ADD COLUMN posted_at timestamptz;
UPDATE service_recovery_compensation_requests
SET sync_status=CASE status WHEN 'POSTED' THEN 'POSTED' WHEN 'APPROVED' THEN 'PENDING' WHEN 'REJECTED' THEN 'REJECTED' WHEN 'CANCELLED' THEN 'CANCELLED' WHEN 'FAILED' THEN 'FAILED' ELSE 'NOT_STARTED' END,
    posted_at=CASE WHEN status='POSTED' THEN updated_at ELSE NULL END;

CREATE FUNCTION sprint11_sync_recovery_compensation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE comp_status text;
DECLARE comp_sync text;
DECLARE comp_id uuid;
DECLARE comp_branch uuid;
BEGIN
  IF TG_TABLE_NAME='stored_value_adjustment_requests' THEN
    SELECT id,branch_id INTO comp_id,comp_branch FROM service_recovery_compensation_requests
    WHERE tenant_id=NEW.tenant_id AND existing_domain_reference_type='CUSTOMER_CREDIT' AND existing_domain_reference_id=NEW.id FOR UPDATE;
  ELSE
    SELECT id,branch_id INTO comp_id,comp_branch FROM service_recovery_compensation_requests
    WHERE tenant_id=NEW.tenant_id AND existing_domain_reference_type='LOYALTY_POINTS' AND existing_domain_reference_id=NEW.id FOR UPDATE;
  END IF;
  IF comp_id IS NULL THEN RETURN NEW; END IF;
  comp_status := CASE NEW.status WHEN 'APPROVED' THEN 'POSTED' WHEN 'REJECTED' THEN 'REJECTED' WHEN 'CANCELLED' THEN 'CANCELLED' ELSE 'APPROVED' END;
  comp_sync := CASE NEW.status WHEN 'APPROVED' THEN 'POSTED' WHEN 'REJECTED' THEN 'REJECTED' WHEN 'CANCELLED' THEN 'CANCELLED' ELSE 'PENDING' END;
  UPDATE service_recovery_compensation_requests
    SET status=comp_status,sync_status=comp_sync,posted_at=CASE WHEN comp_status='POSTED' THEN now() ELSE posted_at END,
        sync_error_code=NULL,version=version+1,updated_at=now()
    WHERE tenant_id=NEW.tenant_id AND id=comp_id;
  IF comp_status='POSTED' THEN
    INSERT INTO outbox_events(tenant_id,branch_id,event_type,aggregate_type,aggregate_id,payload_json,metadata_json)
    VALUES(NEW.tenant_id,comp_branch,'service_recovery.compensation_posted','service_recovery_compensation',comp_id,
      jsonb_build_object('aggregateId',comp_id,'branchId',comp_branch,'refetch',true),'{"schemaVersion":1,"pii":false}');
  ELSIF comp_status IN('REJECTED','CANCELLED') THEN
    INSERT INTO outbox_events(tenant_id,branch_id,event_type,aggregate_type,aggregate_id,payload_json,metadata_json)
    VALUES(NEW.tenant_id,comp_branch,'service_recovery.compensation_failed','service_recovery_compensation',comp_id,
      jsonb_build_object('aggregateId',comp_id,'branchId',comp_branch,'status',comp_status,'refetch',true),'{"schemaVersion":1,"pii":false}');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stored_value_adjustment_recovery_sync AFTER UPDATE OF status ON stored_value_adjustment_requests
FOR EACH ROW WHEN(OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION sprint11_sync_recovery_compensation();
CREATE TRIGGER loyalty_adjustment_recovery_sync AFTER UPDATE OF status ON loyalty_adjustment_requests
FOR EACH ROW WHEN(OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION sprint11_sync_recovery_compensation();

-- Branch managers retain branch-scoped commands, but global template/rule ownership is Owner-only.
DELETE FROM role_permissions WHERE role='BRANCH_MANAGER' AND permission_code IN(
  'communication.template.manage','communication.rule.manage'
);

INSERT INTO schema_migrations(version) VALUES('0022_sprint11_engagement_correctness_hardening');
COMMIT;

-- Sprint 11: Notifications, marketing consent, reviews and service recovery.
-- PostgreSQL remains authoritative. Customer outbound channel is EMAIL only.

BEGIN;

CREATE TABLE communication_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  email_provider_mode text NOT NULL DEFAULT 'DISABLED' CHECK(email_provider_mode IN('DISABLED','FAKE','PRODUCTION')),
  reminder_lead_minutes integer NOT NULL DEFAULT 1440 CHECK(reminder_lead_minutes>0),
  marketing_frequency_limit integer NOT NULL DEFAULT 2 CHECK(marketing_frequency_limit>0),
  marketing_frequency_window_days integer NOT NULL DEFAULT 7 CHECK(marketing_frequency_window_days>0),
  quiet_hours_start time NOT NULL DEFAULT '20:00',
  quiet_hours_end time NOT NULL DEFAULT '08:00',
  low_rating_threshold integer NOT NULL DEFAULT 2 CHECK(low_rating_threshold BETWEEN 1 AND 5),
  auto_create_recovery_case boolean NOT NULL DEFAULT true,
  campaign_dual_control_threshold integer NOT NULL DEFAULT 100 CHECK(campaign_dual_control_threshold>=0),
  delivery_max_attempts integer NOT NULL DEFAULT 5 CHECK(delivery_max_attempts BETWEEN 1 AND 20),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO communication_settings(tenant_id) SELECT id FROM tenants ON CONFLICT DO NOTHING;
CREATE FUNCTION sprint11_initialize_tenant_communication_settings() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO communication_settings(tenant_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER tenants_initialize_communication_settings AFTER INSERT ON tenants
FOR EACH ROW EXECUTE FUNCTION sprint11_initialize_tenant_communication_settings();

CREATE TABLE consent_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  purpose text NOT NULL CHECK(purpose IN('MARKETING_EMAIL','REVIEW_REQUEST','CUSTOMER_RESEARCH','SERVICE_RECOVERY_CONTACT')),
  definition_version integer NOT NULL CHECK(definition_version>0), locale text NOT NULL CHECK(locale IN('vi-VN','en-US')),
  consent_text text NOT NULL, consent_text_hash text NOT NULL, status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('DRAFT','ACTIVE','SUPERSEDED','ARCHIVED')),
  effective_from timestamptz NOT NULL DEFAULT now(), effective_to timestamptz, created_by_user_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,purpose,definition_version,locale), UNIQUE(tenant_id,id)
);

CREATE TABLE customer_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), customer_id uuid NOT NULL,
  purpose text NOT NULL CHECK(purpose IN('MARKETING_EMAIL','REVIEW_REQUEST','CUSTOMER_RESEARCH','SERVICE_RECOVERY_CONTACT')),
  event_type text NOT NULL CHECK(event_type IN('GRANT','WITHDRAW','EXPIRE','MIGRATION','ADMIN_CORRECTION')),
  resulting_state text NOT NULL CHECK(resulting_state IN('GRANTED','WITHDRAWN','NOT_GRANTED','UNKNOWN')),
  consent_definition_id uuid, definition_version integer, consent_text_hash text,
  source text NOT NULL CHECK(source IN('BOOKING_WEB','CUSTOMER_PORTAL','ADMIN_WEB','IMPORT','UNSUBSCRIBE_LINK','API')),
  actor_user_id uuid, evidence_redacted_json jsonb NOT NULL DEFAULT '{}', request_id text NOT NULL,
  generation_key text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,generation_key), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY(tenant_id,consent_definition_id) REFERENCES consent_definitions(tenant_id,id)
);

CREATE TABLE customer_consent_states (
  tenant_id uuid NOT NULL REFERENCES tenants(id), customer_id uuid NOT NULL, purpose text NOT NULL,
  state text NOT NULL DEFAULT 'NOT_GRANTED' CHECK(state IN('GRANTED','WITHDRAWN','NOT_GRANTED','UNKNOWN')),
  last_event_id uuid, version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,customer_id,purpose),
  FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,last_event_id) REFERENCES customer_consent_events(tenant_id,id)
);

CREATE TABLE customer_communication_preferences (
  tenant_id uuid NOT NULL REFERENCES tenants(id), customer_id uuid NOT NULL,
  preferred_locale text NOT NULL DEFAULT 'vi-VN' CHECK(preferred_locale IN('vi-VN','en-US')),
  preferred_timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh', email_address text,
  email_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK(email_status IN('UNVERIFIED','VERIFIED','BOUNCED','COMPLAINED','INVALID','SUPPRESSED')),
  marketing_email_allowed boolean NOT NULL DEFAULT false, review_request_allowed boolean NOT NULL DEFAULT false,
  service_recovery_contact_allowed boolean NOT NULL DEFAULT false, quiet_hours_start time, quiet_hours_end time,
  version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,customer_id), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id) ON DELETE CASCADE
);
INSERT INTO customer_communication_preferences(tenant_id,customer_id,preferred_locale,preferred_timezone,email_address)
SELECT c.tenant_id,c.id,COALESCE(t.default_locale,'vi-VN'),COALESCE(t.timezone,'Asia/Ho_Chi_Minh'),c.email_normalized
FROM customers c JOIN tenants t ON t.id=c.tenant_id ON CONFLICT DO NOTHING;
INSERT INTO customer_consent_states(tenant_id,customer_id,purpose,state)
SELECT c.tenant_id,c.id,p.purpose,'NOT_GRANTED' FROM customers c CROSS JOIN (VALUES
('MARKETING_EMAIL'),('REVIEW_REQUEST'),('CUSTOMER_RESEARCH'),('SERVICE_RECOVERY_CONTACT')) p(purpose)
ON CONFLICT DO NOTHING;

CREATE FUNCTION sprint11_initialize_customer_communication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO customer_communication_preferences(tenant_id,customer_id,preferred_locale,preferred_timezone,email_address)
  SELECT NEW.tenant_id,NEW.id,COALESCE(t.default_locale,'vi-VN'),COALESCE(t.timezone,'Asia/Ho_Chi_Minh'),NEW.email_normalized
  FROM tenants t WHERE t.id=NEW.tenant_id ON CONFLICT DO NOTHING;
  INSERT INTO customer_consent_states(tenant_id,customer_id,purpose,state)
  SELECT NEW.tenant_id,NEW.id,p.purpose,'NOT_GRANTED' FROM (VALUES
  ('MARKETING_EMAIL'),('REVIEW_REQUEST'),('CUSTOMER_RESEARCH'),('SERVICE_RECOVERY_CONTACT')) p(purpose)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER customers_initialize_communication AFTER INSERT ON customers
FOR EACH ROW EXECUTE FUNCTION sprint11_initialize_customer_communication();

CREATE TABLE communication_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), customer_id uuid,
  purpose text, reason text NOT NULL CHECK(reason IN('MARKETING_WITHDRAWN','GLOBAL_UNSUBSCRIBE','HARD_BOUNCE','COMPLAINT','INVALID_ADDRESS','ADMIN_BLOCK','FREQUENCY_CAP','QUIET_HOURS','DUPLICATE','CUSTOMER_DELETED')),
  contact_hash text, active boolean NOT NULL DEFAULT true, source_event_id uuid, created_at timestamptz NOT NULL DEFAULT now(), lifted_at timestamptz,
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);
CREATE UNIQUE INDEX communication_suppressions_active_unique ON communication_suppressions(tenant_id,customer_id,purpose,reason) WHERE active;

CREATE TABLE communication_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), code text NOT NULL,
  category text NOT NULL CHECK(category IN('TRANSACTIONAL','ENGAGEMENT','MARKETING','INTERNAL')),
  channel text NOT NULL DEFAULT 'EMAIL' CHECK(channel='EMAIL'), status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','ACTIVE','INACTIVE','SUPERSEDED','ARCHIVED')),
  version integer NOT NULL DEFAULT 1, created_by_user_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,code), UNIQUE(tenant_id,id)
);
CREATE TABLE communication_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), template_id uuid NOT NULL,
  version_number integer NOT NULL CHECK(version_number>0), locale text NOT NULL CHECK(locale IN('vi-VN','en-US')),
  subject text NOT NULL, html_body text NOT NULL, plain_text_body text NOT NULL,
  allowed_variables_json jsonb NOT NULL DEFAULT '[]', required_variables_json jsonb NOT NULL DEFAULT '[]', compliance_footer text,
  content_hash text NOT NULL, status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','ACTIVE','INACTIVE','SUPERSEDED','ARCHIVED')),
  effective_from timestamptz, effective_to timestamptz, created_by_user_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,template_id,version_number,locale), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,template_id) REFERENCES communication_templates(tenant_id,id)
);
CREATE TABLE communication_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid,
  domain_event text NOT NULL, purpose text NOT NULL, template_version_id uuid NOT NULL, delay_seconds integer NOT NULL DEFAULT 0 CHECK(delay_seconds>=0),
  recipient_resolver text NOT NULL DEFAULT 'APPOINTMENT_CUSTOMER', eligibility_policy_json jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','ACTIVE','PAUSED','INACTIVE')), version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,template_version_id) REFERENCES communication_template_versions(tenant_id,id)
);

CREATE TABLE communication_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid, customer_id uuid,
  category text NOT NULL CHECK(category IN('TRANSACTIONAL','ENGAGEMENT','MARKETING','INTERNAL')),
  purpose text NOT NULL, channel text NOT NULL DEFAULT 'EMAIL' CHECK(channel='EMAIL'), template_version_id uuid,
  generation_key text NOT NULL, recipient_hash text, recipient_reference text, locale text NOT NULL DEFAULT 'vi-VN', timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  variables_json jsonb NOT NULL DEFAULT '{}', rendered_subject text, rendered_html text, rendered_text text,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','SCHEDULED','PROCESSING','SENT','DELIVERED','BOUNCED','COMPLAINED','FAILED','DEAD_LETTER','SUPPRESSED','CANCELLED')),
  scheduled_at timestamptz, processing_started_at timestamptz, sent_at timestamptz, delivered_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0, next_attempt_at timestamptz, safe_error_code text, suppression_reason text,
  appointment_id uuid, marketing_campaign_id uuid, review_request_id uuid, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,generation_key), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY(tenant_id,template_version_id) REFERENCES communication_template_versions(tenant_id,id), FOREIGN KEY(tenant_id,appointment_id) REFERENCES appointments(tenant_id,id)
);
CREATE INDEX communication_messages_delivery_idx ON communication_messages(status,next_attempt_at,scheduled_at);
CREATE TABLE communication_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), message_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK(attempt_number>0), provider_reference text, result text NOT NULL,
  safe_error_code text, retry_after timestamptz, redacted_metadata_json jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,message_id,attempt_number), FOREIGN KEY(tenant_id,message_id) REFERENCES communication_messages(tenant_id,id)
);
CREATE TABLE communication_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), provider text NOT NULL,
  provider_event_id text NOT NULL, provider_reference text, event_type text NOT NULL, signature_verified boolean NOT NULL DEFAULT false,
  payload_hash text NOT NULL, redacted_metadata_json jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'PENDING',
  received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz, UNIQUE(tenant_id,provider,provider_event_id)
);
CREATE TABLE internal_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid, recipient_user_id uuid,
  type text NOT NULL, title text NOT NULL, body_redacted text NOT NULL, entity_type text, entity_id uuid,
  status text NOT NULL DEFAULT 'UNREAD' CHECK(status IN('UNREAD','READ','DISMISSED')), created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz, dismissed_at timestamptz,
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE customer_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), name text NOT NULL, color text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','INACTIVE')), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,name), UNIQUE(tenant_id,id)
);
CREATE TABLE customer_tag_assignments (
  tenant_id uuid NOT NULL REFERENCES tenants(id), customer_id uuid NOT NULL, tag_id uuid NOT NULL, assigned_by_user_id uuid, assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,customer_id,tag_id), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id), FOREIGN KEY(tenant_id,tag_id) REFERENCES customer_tags(tenant_id,id)
);
CREATE TABLE customer_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid, name text NOT NULL,
  filter_json jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','ACTIVE','INACTIVE')),
  version integer NOT NULL DEFAULT 1, created_by_user_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,name), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE TABLE marketing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid, segment_id uuid NOT NULL, template_version_id uuid NOT NULL,
  name text NOT NULL, campaign_type text NOT NULL, risk_level text NOT NULL DEFAULT 'STANDARD',
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','PENDING_APPROVAL','APPROVED','SCHEDULED','RUNNING','PAUSED','COMPLETED','CANCELLED','FAILED')),
  requested_by_user_id uuid NOT NULL, approved_by_user_id uuid, scheduled_at timestamptz, started_at timestamptz, completed_at timestamptz,
  audience_generation integer NOT NULL DEFAULT 0, version integer NOT NULL DEFAULT 1, failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,segment_id) REFERENCES customer_segments(tenant_id,id),
  FOREIGN KEY(tenant_id,template_version_id) REFERENCES communication_template_versions(tenant_id,id)
);
ALTER TABLE communication_messages ADD CONSTRAINT communication_messages_campaign_fk FOREIGN KEY(tenant_id,marketing_campaign_id) REFERENCES marketing_campaigns(tenant_id,id);
CREATE TABLE marketing_campaign_audience (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), campaign_id uuid NOT NULL, customer_id uuid NOT NULL,
  generation integer NOT NULL, consent_event_id uuid NOT NULL, contact_hash text NOT NULL, contact_reference text NOT NULL,
  locale text NOT NULL, timezone text NOT NULL, segment_version integer NOT NULL, eligibility_snapshot_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'ELIGIBLE' CHECK(status IN('ELIGIBLE','SENT','SKIPPED','SUPPRESSED')), skipped_reason text, snapshotted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,campaign_id,generation,customer_id),
  FOREIGN KEY(tenant_id,campaign_id) REFERENCES marketing_campaigns(tenant_id,id), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY(tenant_id,consent_event_id) REFERENCES customer_consent_events(tenant_id,id)
);
CREATE TABLE marketing_frequency_counters (
  tenant_id uuid NOT NULL REFERENCES tenants(id), customer_id uuid NOT NULL, window_start date NOT NULL, sent_count integer NOT NULL DEFAULT 0 CHECK(sent_count>=0), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,customer_id,window_start), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);
CREATE TABLE communication_unsubscribe_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), customer_id uuid NOT NULL, purpose text NOT NULL,
  token_hash text NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(token_hash), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);

CREATE TABLE review_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid NOT NULL, customer_id uuid NOT NULL,
  appointment_id uuid NOT NULL, invoice_id uuid NOT NULL, token_hash text NOT NULL, expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','SENT','SUBMITTED','EXPIRED','CANCELLED','SUPPRESSED')),
  generation_key text NOT NULL, sent_at timestamptz, submitted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,generation_key), UNIQUE(token_hash), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY(tenant_id,appointment_id) REFERENCES appointments(tenant_id,id), FOREIGN KEY(tenant_id,invoice_id) REFERENCES invoices(tenant_id,id)
);
CREATE TABLE customer_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid NOT NULL, customer_id uuid NOT NULL,
  appointment_id uuid NOT NULL, invoice_id uuid NOT NULL, review_request_id uuid NOT NULL, overall_rating integer NOT NULL CHECK(overall_rating BETWEEN 1 AND 5),
  service_rating integer CHECK(service_rating BETWEEN 1 AND 5), cleanliness_rating integer CHECK(cleanliness_rating BETWEEN 1 AND 5), staff_rating integer CHECK(staff_rating BETWEEN 1 AND 5),
  comment text, staff_snapshot_json jsonb NOT NULL DEFAULT '[]', service_snapshot_json jsonb NOT NULL DEFAULT '[]', verified_evidence_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'VERIFIED' CHECK(status IN('DRAFT','SUBMITTED','VERIFIED','PUBLISHED','HIDDEN','FLAGGED','ARCHIVED')),
  version integer NOT NULL DEFAULT 1, submitted_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz, hidden_at timestamptz,
  UNIQUE(tenant_id,appointment_id), UNIQUE(tenant_id,review_request_id), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY(tenant_id,appointment_id) REFERENCES appointments(tenant_id,id), FOREIGN KEY(tenant_id,invoice_id) REFERENCES invoices(tenant_id,id),
  FOREIGN KEY(tenant_id,review_request_id) REFERENCES review_requests(tenant_id,id)
);
CREATE TABLE customer_review_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), review_id uuid NOT NULL, revision_number integer NOT NULL,
  rating_snapshot_json jsonb NOT NULL, comment text, actor_type text NOT NULL, reason text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,review_id,revision_number), FOREIGN KEY(tenant_id,review_id) REFERENCES customer_reviews(tenant_id,id)
);
CREATE TABLE review_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), review_id uuid NOT NULL, response_text text NOT NULL,
  version integer NOT NULL DEFAULT 1, author_user_id uuid NOT NULL, status text NOT NULL DEFAULT 'PUBLISHED', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,review_id,version), FOREIGN KEY(tenant_id,review_id) REFERENCES customer_reviews(tenant_id,id)
);

CREATE TABLE service_recovery_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid NOT NULL, customer_id uuid NOT NULL,
  appointment_id uuid, invoice_id uuid, review_id uuid, source text NOT NULL CHECK(source IN('LOW_REVIEW','CUSTOMER_COMPLAINT','STAFF_REPORT','REFUND_ESCALATION','SERVICE_FAILURE','MANUAL')),
  severity text NOT NULL CHECK(severity IN('LOW','MEDIUM','HIGH','CRITICAL')), category text NOT NULL, summary text NOT NULL, customer_statement text,
  status text NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','TRIAGED','IN_PROGRESS','WAITING_CUSTOMER','RESOLVED','CLOSED','CANCELLED')),
  assigned_user_id uuid, branch_timezone text NOT NULL, sla_policy_version integer NOT NULL, first_response_due_at timestamptz NOT NULL, resolution_due_at timestamptz NOT NULL,
  resolution text, generation_key text NOT NULL, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,generation_key), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY(tenant_id,appointment_id) REFERENCES appointments(tenant_id,id), FOREIGN KEY(tenant_id,invoice_id) REFERENCES invoices(tenant_id,id),
  FOREIGN KEY(tenant_id,review_id) REFERENCES customer_reviews(tenant_id,id)
);
CREATE TABLE service_recovery_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), case_id uuid NOT NULL, from_status text, to_status text NOT NULL,
  actor_user_id uuid, reason text, request_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,case_id) REFERENCES service_recovery_cases(tenant_id,id)
);
CREATE TABLE service_recovery_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), case_id uuid NOT NULL,
  task_type text NOT NULL CHECK(task_type IN('CALL_CUSTOMER','EMAIL_CUSTOMER','MANAGER_REVIEW','QUALITY_REVIEW','COMPENSATION_APPROVAL','FOLLOW_UP')),
  assigned_user_id uuid, status text NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','IN_PROGRESS','COMPLETED','CANCELLED')),
  due_at timestamptz, completed_at timestamptz, note text, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,case_id) REFERENCES service_recovery_cases(tenant_id,id)
);
CREATE TABLE service_recovery_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), case_id uuid NOT NULL,
  contact_type text NOT NULL CHECK(contact_type IN('EMAIL_SENT','PHONE_ATTEMPTED','PHONE_CONNECTED','IN_PERSON','CUSTOMER_REPLY','INTERNAL_NOTE')),
  summary_redacted text NOT NULL, actor_user_id uuid NOT NULL, generation_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,generation_key), FOREIGN KEY(tenant_id,case_id) REFERENCES service_recovery_cases(tenant_id,id)
);
CREATE TABLE service_recovery_compensation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), case_id uuid NOT NULL, branch_id uuid NOT NULL, customer_id uuid NOT NULL,
  compensation_type text NOT NULL CHECK(compensation_type IN('CUSTOMER_CREDIT','LOYALTY_POINTS','VOUCHER','COMPLIMENTARY_SERVICE_FOUNDATION','NO_MONETARY_COMPENSATION')),
  proposal_json jsonb NOT NULL, status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','POSTED','CANCELLED','FAILED')),
  requested_by_user_id uuid NOT NULL, approved_by_user_id uuid, existing_domain_reference_type text, existing_domain_reference_id uuid,
  reason text NOT NULL, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,case_id) REFERENCES service_recovery_cases(tenant_id,id), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);
CREATE TABLE customer_engagement_export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), requested_by_user_id uuid NOT NULL,
  filter_json jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','PROCESSING','READY','FAILED','EXPIRED')),
  storage_key text, safe_error_code text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);

CREATE FUNCTION sprint11_prevent_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'SPRINT11_IMMUTABLE_RECORD'; END $$;
CREATE FUNCTION sprint11_protect_template_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.template_id IS DISTINCT FROM OLD.template_id OR NEW.version_number IS DISTINCT FROM OLD.version_number OR NEW.locale IS DISTINCT FROM OLD.locale OR NEW.subject IS DISTINCT FROM OLD.subject OR NEW.html_body IS DISTINCT FROM OLD.html_body OR NEW.plain_text_body IS DISTINCT FROM OLD.plain_text_body OR NEW.allowed_variables_json IS DISTINCT FROM OLD.allowed_variables_json OR NEW.required_variables_json IS DISTINCT FROM OLD.required_variables_json OR NEW.compliance_footer IS DISTINCT FROM OLD.compliance_footer OR NEW.content_hash IS DISTINCT FROM OLD.content_hash THEN
    RAISE EXCEPTION 'TEMPLATE_VERSION_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION sprint11_protect_audience_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.generation IS DISTINCT FROM OLD.generation OR NEW.consent_event_id IS DISTINCT FROM OLD.consent_event_id OR NEW.contact_hash IS DISTINCT FROM OLD.contact_hash OR NEW.contact_reference IS DISTINCT FROM OLD.contact_reference OR NEW.locale IS DISTINCT FROM OLD.locale OR NEW.timezone IS DISTINCT FROM OLD.timezone OR NEW.segment_version IS DISTINCT FROM OLD.segment_version OR NEW.eligibility_snapshot_json IS DISTINCT FROM OLD.eligibility_snapshot_json OR NEW.snapshotted_at IS DISTINCT FROM OLD.snapshotted_at THEN
    RAISE EXCEPTION 'CAMPAIGN_AUDIENCE_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customer_consent_events_append_only BEFORE UPDATE OR DELETE ON customer_consent_events FOR EACH ROW EXECUTE FUNCTION sprint11_prevent_mutation();
CREATE TRIGGER communication_template_versions_immutable BEFORE UPDATE OR DELETE ON communication_template_versions FOR EACH ROW EXECUTE FUNCTION sprint11_protect_template_version();
CREATE TRIGGER marketing_campaign_audience_immutable BEFORE UPDATE OR DELETE ON marketing_campaign_audience FOR EACH ROW EXECUTE FUNCTION sprint11_protect_audience_snapshot();
CREATE TRIGGER customer_review_revisions_append_only BEFORE UPDATE OR DELETE ON customer_review_revisions FOR EACH ROW EXECUTE FUNCTION sprint11_prevent_mutation();
CREATE TRIGGER service_recovery_history_append_only BEFORE UPDATE OR DELETE ON service_recovery_history FOR EACH ROW EXECUTE FUNCTION sprint11_prevent_mutation();

CREATE INDEX consent_events_customer_idx ON customer_consent_events(tenant_id,customer_id,purpose,occurred_at DESC);
CREATE INDEX campaign_audience_send_idx ON marketing_campaign_audience(tenant_id,campaign_id,generation,status);
CREATE INDEX review_requests_scheduler_idx ON review_requests(status,created_at,expires_at);
CREATE INDEX recovery_cases_branch_status_idx ON service_recovery_cases(tenant_id,branch_id,status,first_response_due_at);
CREATE INDEX recovery_tasks_assignee_idx ON service_recovery_tasks(tenant_id,assigned_user_id,status,due_at);

INSERT INTO permissions(code,description) SELECT code,'Sprint 11 customer engagement permission' FROM unnest(ARRAY[
'communication.preference.read','communication.preference.manage','communication.consent.read','communication.consent.capture','communication.consent.withdraw',
'communication.template.read','communication.template.manage','communication.rule.read','communication.rule.manage','communication.message.read','communication.message.retry','communication.internal.read',
'marketing.segment.read','marketing.segment.manage','marketing.campaign.read','marketing.campaign.create','marketing.campaign.approve','marketing.campaign.schedule','marketing.campaign.cancel','marketing.report.read',
'review.read','review.moderate','review.respond','review.request.manage','review.report.read',
'service_recovery.read','service_recovery.create','service_recovery.assign','service_recovery.manage','service_recovery.contact','service_recovery.compensation.request','service_recovery.compensation.approve','service_recovery.report.read',
'customer.engagement_timeline.read','customer.engagement.export']) code ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) SELECT 'SALON_OWNER',code FROM permissions WHERE code LIKE 'communication.%' OR code LIKE 'marketing.%' OR code LIKE 'review.%' OR code LIKE 'service_recovery.%' OR code LIKE 'customer.engagement%' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) SELECT 'BRANCH_MANAGER',code FROM permissions WHERE code LIKE 'communication.%' OR code LIKE 'marketing.%' OR code LIKE 'review.%' OR code LIKE 'service_recovery.%' OR code='customer.engagement_timeline.read' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) VALUES
('RECEPTIONIST','communication.preference.read'),('RECEPTIONIST','communication.preference.manage'),('RECEPTIONIST','communication.consent.read'),('RECEPTIONIST','communication.consent.capture'),('RECEPTIONIST','communication.consent.withdraw'),('RECEPTIONIST','service_recovery.read'),('RECEPTIONIST','service_recovery.create'),('RECEPTIONIST','service_recovery.contact'),('RECEPTIONIST','customer.engagement_timeline.read'),
('CASHIER','communication.preference.read'),('CASHIER','service_recovery.create'),
('NAIL_TECHNICIAN','service_recovery.read'),('NAIL_TECHNICIAN','service_recovery.contact'),
('ACCOUNTANT','marketing.report.read'),('ACCOUNTANT','service_recovery.report.read'),
('MARKETING','communication.template.read'),('MARKETING','communication.template.manage'),('MARKETING','communication.rule.read'),('MARKETING','communication.rule.manage'),('MARKETING','communication.message.read'),('MARKETING','marketing.segment.read'),('MARKETING','marketing.segment.manage'),('MARKETING','marketing.campaign.read'),('MARKETING','marketing.campaign.create'),('MARKETING','marketing.campaign.schedule'),('MARKETING','marketing.campaign.cancel'),('MARKETING','marketing.report.read'),('MARKETING','review.read'),('MARKETING','review.report.read')
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version)
VALUES('0021_notifications_marketing_reviews_service_recovery');

COMMIT;

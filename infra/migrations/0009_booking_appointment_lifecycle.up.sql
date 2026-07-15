BEGIN;

-- Extend the Sprint 0 appointment foundation in place. Existing rows remain addressable.
ALTER TABLE customers
  ADD COLUMN email_normalized text,
  ADD COLUMN preferred_locale text NOT NULL DEFAULT 'vi-VN',
  ADD COLUMN is_guest boolean NOT NULL DEFAULT false,
  ADD COLUMN status text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN contact_verification_version integer NOT NULL DEFAULT 1,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT customers_locale_check CHECK (preferred_locale IN ('vi-VN','en-US')),
  ADD CONSTRAINT customers_status_check CHECK (status IN ('ACTIVE','INACTIVE','MERGED')),
  ADD CONSTRAINT customers_contact_verification_version_check CHECK (contact_verification_version > 0);
CREATE UNIQUE INDEX customers_tenant_email_unique
  ON customers(tenant_id, lower(email_normalized)) WHERE email_normalized IS NOT NULL;

UPDATE tenant_settings
SET booking_policy_json = '{"maxItems":5,"holdTtlMinutes":10,"activeHoldLimit":3,"minimumAdvanceMinutes":60,"maximumAdvanceDays":90,"contactVerificationRequired":true,"depositWaiverEnabled":true}'::jsonb || booking_policy_json,
    cancellation_policy_json = '{"cancelWindowHours":24,"lateOutcome":"MANUAL_REVIEW","standardOutcome":"NO_FINANCIAL_ACTION","version":1}'::jsonb || cancellation_policy_json;
UPDATE branch_settings
SET booking_policy_json = '{"confirmationPolicy":"INTERNAL_AUTO_CONFIRM","holdTtlMinutes":10,"activeHoldLimit":3,"allowAnyTechnician":true,"allowCustomerSelectStaff":true,"hideStaffNamesOnPublicBooking":false,"pendingExpiryMinutes":30,"version":1}'::jsonb || booking_policy_json;

ALTER TABLE appointments
  ADD COLUMN booking_reference varchar(20),
  ADD COLUMN source text,
  ADD COLUMN locale text,
  ADD COLUMN timezone text,
  ADD COLUMN schedule_version integer,
  ADD COLUMN contact_snapshot_json jsonb,
  ADD COLUMN policy_snapshot_json jsonb,
  ADD COLUMN pricing_summary_json jsonb,
  ADD COLUMN deposit_required_minor bigint,
  ADD COLUMN deposit_status text,
  ADD COLUMN deposit_waived_by_user_id uuid,
  ADD COLUMN deposit_waiver_reason text,
  ADD COLUMN customer_note text,
  ADD COLUMN internal_note text,
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN confirmed_at timestamptz,
  ADD COLUMN confirmed_by_user_id uuid,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by_user_id uuid,
  ADD COLUMN cancellation_reason_code varchar(80),
  ADD COLUMN cancellation_note text,
  ADD COLUMN cancellation_outcome text,
  ADD COLUMN created_by_user_id uuid,
  ADD COLUMN updated_by_user_id uuid,
  ADD COLUMN contact_verification_version integer,
  ADD COLUMN created_at timestamptz,
  ADD COLUMN updated_at timestamptz;

UPDATE appointments a
SET booking_reference = 'NS-' || upper(substr(md5(a.id::text), 1, 8)),
    source = 'IMPORT',
    locale = COALESCE(t.default_locale, 'vi-VN'),
    timezone = b.timezone,
    schedule_version = 1,
    contact_snapshot_json = jsonb_build_object(
      'displayName', COALESCE((SELECT c.display_name FROM customers c WHERE c.tenant_id=a.tenant_id AND c.id=a.customer_id), 'Guest'),
      'phone', (SELECT c.phone_normalized FROM customers c WHERE c.tenant_id=a.tenant_id AND c.id=a.customer_id),
      'email', (SELECT c.email_normalized FROM customers c WHERE c.tenant_id=a.tenant_id AND c.id=a.customer_id),
      'locale', COALESCE((SELECT c.preferred_locale FROM customers c WHERE c.tenant_id=a.tenant_id AND c.id=a.customer_id), t.default_locale, 'vi-VN'),
      'verified', false
    ),
    policy_snapshot_json = jsonb_build_object('source', 'legacy-backfill', 'version', 1),
    pricing_summary_json = jsonb_build_object('amountMinor', 0, 'currency', t.currency),
    deposit_required_minor = 0,
    deposit_status = 'NOT_REQUIRED',
    confirmed_at = CASE
      WHEN a.status IN ('CONFIRMED','CHECKED_IN','IN_SERVICE','COMPLETED','CHECKED_OUT','PAID','NO_SHOW')
        THEN a.start_at
      ELSE NULL
    END,
    cancelled_at = CASE
      WHEN a.status IN ('CANCELLED_BY_CUSTOMER','CANCELLED_BY_SALON')
        THEN a.start_at
      ELSE NULL
    END,
    cancellation_reason_code = CASE
      WHEN a.status IN ('CANCELLED_BY_CUSTOMER','CANCELLED_BY_SALON')
        THEN 'LEGACY_REIMPORT'
      ELSE NULL
    END,
    contact_verification_version = 1,
    created_at = a.start_at,
    updated_at = a.start_at
FROM branches b
JOIN tenants t ON t.id = b.tenant_id
WHERE b.tenant_id = a.tenant_id AND b.id = a.branch_id;

ALTER TABLE appointments
  ALTER COLUMN booking_reference SET NOT NULL,
  ALTER COLUMN source SET NOT NULL,
  ALTER COLUMN locale SET NOT NULL,
  ALTER COLUMN timezone SET NOT NULL,
  ALTER COLUMN schedule_version SET NOT NULL,
  ALTER COLUMN schedule_version SET DEFAULT 1,
  ALTER COLUMN contact_snapshot_json SET NOT NULL,
  ALTER COLUMN contact_snapshot_json SET DEFAULT '{}',
  ALTER COLUMN policy_snapshot_json SET NOT NULL,
  ALTER COLUMN policy_snapshot_json SET DEFAULT '{}',
  ALTER COLUMN pricing_summary_json SET NOT NULL,
  ALTER COLUMN pricing_summary_json SET DEFAULT '{}',
  ALTER COLUMN deposit_required_minor SET NOT NULL,
  ALTER COLUMN deposit_required_minor SET DEFAULT 0,
  ALTER COLUMN deposit_status SET NOT NULL,
  ALTER COLUMN deposit_status SET DEFAULT 'NOT_REQUIRED',
  ALTER COLUMN contact_verification_version SET NOT NULL,
  ALTER COLUMN contact_verification_version SET DEFAULT 1,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ADD CONSTRAINT appointments_source_check CHECK (source IN ('RECEPTION','CUSTOMER_WEB','OWNER_MOBILE','STAFF_MOBILE','API','IMPORT')),
  ADD CONSTRAINT appointments_status_check CHECK (status IN ('DRAFT','SLOT_HELD','PENDING_CONFIRMATION','PENDING_DEPOSIT','CONFIRMED','EXPIRED','CANCELLED_BY_CUSTOMER','CANCELLED_BY_SALON','CHECKED_IN','IN_SERVICE','COMPLETED','CHECKED_OUT','PAID','NO_SHOW','RESCHEDULED','PARTIALLY_COMPLETED')),
  ADD CONSTRAINT appointments_locale_check CHECK (locale IN ('vi-VN','en-US')),
  ADD CONSTRAINT appointments_schedule_version_check CHECK (schedule_version > 0),
  ADD CONSTRAINT appointments_version_check CHECK (version > 0),
  ADD CONSTRAINT appointments_deposit_required_check CHECK (deposit_required_minor >= 0),
  ADD CONSTRAINT appointments_deposit_status_check CHECK (deposit_status IN ('NOT_REQUIRED','REQUIRED','PENDING','WAIVED')),
  ADD CONSTRAINT appointments_deposit_waiver_check CHECK ((deposit_status <> 'WAIVED') OR (deposit_waived_by_user_id IS NOT NULL AND length(trim(deposit_waiver_reason)) > 0)),
  ADD CONSTRAINT appointments_cancelled_metadata_check CHECK ((status NOT IN ('CANCELLED_BY_CUSTOMER','CANCELLED_BY_SALON')) OR cancelled_at IS NOT NULL),
  ADD CONSTRAINT appointments_confirmed_metadata_check CHECK ((status <> 'CONFIRMED') OR confirmed_at IS NOT NULL),
  ADD CONSTRAINT appointments_contact_verification_version_check CHECK (contact_verification_version > 0),
  ADD CONSTRAINT appointments_deposit_waived_by_fkey FOREIGN KEY (deposit_waived_by_user_id) REFERENCES users(id),
  ADD CONSTRAINT appointments_confirmed_by_fkey FOREIGN KEY (confirmed_by_user_id) REFERENCES users(id),
  ADD CONSTRAINT appointments_cancelled_by_fkey FOREIGN KEY (cancelled_by_user_id) REFERENCES users(id),
  ADD CONSTRAINT appointments_created_by_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  ADD CONSTRAINT appointments_updated_by_fkey FOREIGN KEY (updated_by_user_id) REFERENCES users(id);
CREATE UNIQUE INDEX appointments_tenant_reference_unique
  ON appointments(tenant_id, lower(booking_reference));
CREATE INDEX appointments_customer_history_idx ON appointments(tenant_id,customer_id,start_at DESC);

CREATE TABLE appointment_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  appointment_id uuid NOT NULL,
  customer_id uuid,
  display_name varchar(200) NOT NULL,
  participant_order integer NOT NULL DEFAULT 1 CHECK (participant_order > 0),
  is_booking_owner boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,appointment_id,participant_order),
  FOREIGN KEY(tenant_id,appointment_id) REFERENCES appointments(tenant_id,id),
  FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);

CREATE TABLE appointment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  appointment_id uuid NOT NULL,
  participant_id uuid,
  service_id uuid NOT NULL,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','CONFIRMED','CANCELLED')),
  service_start_at timestamptz NOT NULL,
  service_end_at timestamptz NOT NULL,
  staff_occupancy_start_at timestamptz NOT NULL,
  staff_occupancy_end_at timestamptz NOT NULL,
  resource_occupancy_start_at timestamptz NOT NULL,
  resource_occupancy_end_at timestamptz NOT NULL,
  duration_min integer NOT NULL CHECK (duration_min > 0),
  prep_time_min integer NOT NULL DEFAULT 0 CHECK (prep_time_min >= 0),
  cleanup_time_min integer NOT NULL DEFAULT 0 CHECK (cleanup_time_min >= 0),
  buffer_before_min integer NOT NULL DEFAULT 0 CHECK (buffer_before_min >= 0),
  buffer_after_min integer NOT NULL DEFAULT 0 CHECK (buffer_after_min >= 0),
  service_snapshot_json jsonb NOT NULL,
  price_snapshot_json jsonb NOT NULL,
  tax_snapshot_json jsonb NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,appointment_id,sequence_no),
  FOREIGN KEY(tenant_id,appointment_id) REFERENCES appointments(tenant_id,id),
  FOREIGN KEY(tenant_id,participant_id) REFERENCES appointment_participants(tenant_id,id),
  FOREIGN KEY(tenant_id,service_id) REFERENCES services(tenant_id,id),
  CHECK (service_end_at > service_start_at),
  CHECK (staff_occupancy_end_at > staff_occupancy_start_at),
  CHECK (resource_occupancy_end_at > resource_occupancy_start_at)
);
CREATE INDEX appointment_items_schedule_idx ON appointment_items(tenant_id,appointment_id,sequence_no);

CREATE TABLE appointment_item_staff_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  appointment_item_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  assignment_role text NOT NULL CHECK (assignment_role IN ('PRIMARY','ASSISTANT')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RELEASED')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,appointment_item_id) REFERENCES appointment_items(tenant_id,id),
  FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id)
);
CREATE UNIQUE INDEX appointment_item_one_primary_active
  ON appointment_item_staff_assignments(tenant_id,appointment_item_id)
  WHERE assignment_role='PRIMARY' AND status='ACTIVE';

CREATE TABLE appointment_item_resource_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  appointment_item_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  is_exclusive boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RELEASED')),
  allocated_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,appointment_item_id,resource_id),
  FOREIGN KEY(tenant_id,appointment_item_id) REFERENCES appointment_items(tenant_id,id),
  FOREIGN KEY(tenant_id,resource_id) REFERENCES resources(tenant_id,id)
);

CREATE TABLE slot_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('CUSTOMER_WEB','RECEPTION','OWNER_MOBILE','API')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CONSUMED','EXPIRED','RELEASED')),
  public_token_version integer NOT NULL DEFAULT 1 CHECK (public_token_version > 0),
  client_key_hash varchar(128),
  request_fingerprint varchar(128) NOT NULL,
  availability_data_version bigint NOT NULL CHECK (availability_data_version > 0),
  expires_at timestamptz NOT NULL,
  consumed_by_appointment_id uuid,
  consumed_at timestamptz,
  released_at timestamptz,
  created_by_user_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,consumed_by_appointment_id) REFERENCES appointments(tenant_id,id),
  FOREIGN KEY(created_by_user_id) REFERENCES users(id),
  CHECK (expires_at > created_at),
  CHECK ((status <> 'CONSUMED') OR (consumed_by_appointment_id IS NOT NULL AND consumed_at IS NOT NULL)),
  CHECK ((status <> 'RELEASED') OR released_at IS NOT NULL)
);
CREATE INDEX slot_holds_active_expiry_idx ON slot_holds(tenant_id,branch_id,expires_at) WHERE status='ACTIVE';
CREATE INDEX slot_holds_client_limit_idx ON slot_holds(tenant_id,client_key_hash,expires_at) WHERE status='ACTIVE';

CREATE TABLE slot_hold_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  slot_hold_id uuid NOT NULL,
  service_id uuid NOT NULL,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  selected_staff_id uuid NOT NULL,
  service_start_at timestamptz NOT NULL,
  service_end_at timestamptz NOT NULL,
  staff_occupancy_start_at timestamptz NOT NULL,
  staff_occupancy_end_at timestamptz NOT NULL,
  resource_occupancy_start_at timestamptz NOT NULL,
  resource_occupancy_end_at timestamptz NOT NULL,
  service_snapshot_json jsonb NOT NULL,
  price_snapshot_json jsonb NOT NULL,
  tax_snapshot_json jsonb NOT NULL DEFAULT '{}',
  resource_plan_json jsonb NOT NULL DEFAULT '[]',
  availability_fingerprint varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,slot_hold_id,sequence_no),
  FOREIGN KEY(tenant_id,slot_hold_id) REFERENCES slot_holds(tenant_id,id),
  FOREIGN KEY(tenant_id,service_id) REFERENCES services(tenant_id,id),
  FOREIGN KEY(tenant_id,selected_staff_id) REFERENCES staff_profiles(tenant_id,id),
  CHECK (service_end_at > service_start_at),
  CHECK (staff_occupancy_end_at > staff_occupancy_start_at),
  CHECK (resource_occupancy_end_at > resource_occupancy_start_at)
);

CREATE TABLE staff_schedule_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  appointment_item_id uuid,
  slot_hold_item_id uuid,
  reservation_type text NOT NULL CHECK (reservation_type IN ('APPOINTMENT','HOLD')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RELEASED','EXPIRED')),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  expires_at timestamptz,
  reservation_range tstzrange GENERATED ALWAYS AS (tstzrange(start_at,end_at,'[)')) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id),
  FOREIGN KEY(tenant_id,appointment_item_id) REFERENCES appointment_items(tenant_id,id),
  FOREIGN KEY(tenant_id,slot_hold_item_id) REFERENCES slot_hold_items(tenant_id,id),
  CHECK (end_at > start_at),
  CHECK ((appointment_item_id IS NOT NULL)::integer + (slot_hold_item_id IS NOT NULL)::integer = 1),
  CHECK ((reservation_type='APPOINTMENT' AND appointment_item_id IS NOT NULL) OR (reservation_type='HOLD' AND slot_hold_item_id IS NOT NULL)),
  CHECK ((reservation_type <> 'HOLD') OR expires_at IS NOT NULL)
);
ALTER TABLE staff_schedule_reservations ADD CONSTRAINT staff_schedule_no_active_overlap
  EXCLUDE USING gist (tenant_id WITH =, staff_id WITH =, reservation_range WITH &&)
  WHERE (status='ACTIVE');
CREATE INDEX staff_schedule_reservations_branch_idx ON staff_schedule_reservations(tenant_id,branch_id,start_at,end_at,status);

CREATE TABLE resource_schedule_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  appointment_item_id uuid,
  slot_hold_item_id uuid,
  reservation_type text NOT NULL CHECK (reservation_type IN ('APPOINTMENT','HOLD')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RELEASED','EXPIRED')),
  quantity integer NOT NULL CHECK (quantity > 0),
  is_exclusive boolean NOT NULL DEFAULT false,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  expires_at timestamptz,
  reservation_range tstzrange GENERATED ALWAYS AS (tstzrange(start_at,end_at,'[)')) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,resource_id) REFERENCES resources(tenant_id,id),
  FOREIGN KEY(tenant_id,appointment_item_id) REFERENCES appointment_items(tenant_id,id),
  FOREIGN KEY(tenant_id,slot_hold_item_id) REFERENCES slot_hold_items(tenant_id,id),
  CHECK (end_at > start_at),
  CHECK ((appointment_item_id IS NOT NULL)::integer + (slot_hold_item_id IS NOT NULL)::integer = 1),
  CHECK ((reservation_type='APPOINTMENT' AND appointment_item_id IS NOT NULL) OR (reservation_type='HOLD' AND slot_hold_item_id IS NOT NULL)),
  CHECK ((reservation_type <> 'HOLD') OR expires_at IS NOT NULL)
);
CREATE INDEX resource_schedule_reservations_overlap_idx
  ON resource_schedule_reservations(tenant_id,resource_id,start_at,end_at,status);

CREATE TABLE appointment_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  appointment_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('USER','CUSTOMER','SYSTEM')),
  actor_user_id uuid,
  actor_customer_id uuid,
  reason_code varchar(80),
  note text,
  request_id varchar(160) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,appointment_id) REFERENCES appointments(tenant_id,id),
  FOREIGN KEY(actor_user_id) REFERENCES users(id),
  FOREIGN KEY(tenant_id,actor_customer_id) REFERENCES customers(tenant_id,id)
);
CREATE INDEX appointment_status_history_lookup_idx ON appointment_status_history(tenant_id,appointment_id,created_at,id);

INSERT INTO appointment_status_history(tenant_id,appointment_id,from_status,to_status,actor_type,reason_code,note,request_id,created_at)
SELECT tenant_id,id,NULL,status,'SYSTEM','LEGACY_BACKFILL','Deterministic Sprint 4 migration backfill','migration:0009',created_at
FROM appointments;

CREATE TABLE appointment_schedule_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  appointment_id uuid NOT NULL,
  schedule_version integer NOT NULL CHECK (schedule_version > 1),
  previous_start_at timestamptz NOT NULL,
  previous_end_at timestamptz NOT NULL,
  new_start_at timestamptz NOT NULL,
  new_end_at timestamptz NOT NULL,
  previous_schedule_json jsonb NOT NULL,
  new_schedule_json jsonb NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('USER','CUSTOMER','SYSTEM')),
  actor_user_id uuid,
  actor_customer_id uuid,
  reason_code varchar(80),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,appointment_id,schedule_version),
  FOREIGN KEY(tenant_id,appointment_id) REFERENCES appointments(tenant_id,id),
  FOREIGN KEY(actor_user_id) REFERENCES users(id),
  FOREIGN KEY(tenant_id,actor_customer_id) REFERENCES customers(tenant_id,id),
  CHECK (previous_end_at > previous_start_at),
  CHECK (new_end_at > new_start_at)
);

CREATE FUNCTION booking_append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'booking history is append-only' USING ERRCODE='55000';
END $$;
CREATE TRIGGER appointment_status_history_append_only
  BEFORE UPDATE OR DELETE ON appointment_status_history
  FOR EACH ROW EXECUTE FUNCTION booking_append_only_guard();
CREATE TRIGGER appointment_schedule_revisions_append_only
  BEFORE UPDATE OR DELETE ON appointment_schedule_revisions
  FOR EACH ROW EXECUTE FUNCTION booking_append_only_guard();

CREATE TABLE booking_access_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  appointment_id uuid,
  booking_reference varchar(20) NOT NULL,
  contact_hash varchar(128) NOT NULL,
  channel text NOT NULL CHECK (channel IN ('SMS','EMAIL')),
  purpose text NOT NULL CHECK (purpose IN ('BOOKING_ACCESS','BOOKING_CONFIRMATION','BOOKING_RESCHEDULE','BOOKING_CANCEL')),
  code_hash varchar(128) NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  blocked_until timestamptz,
  request_ip inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,appointment_id) REFERENCES appointments(tenant_id,id)
);
CREATE INDEX booking_access_challenge_lookup_idx
  ON booking_access_challenges(tenant_id,lower(booking_reference),contact_hash,purpose,created_at DESC);

CREATE TABLE booking_notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  event_id uuid NOT NULL,
  notification_type text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('SMS','EMAIL','PUSH','IN_APP')),
  destination_hash varchar(128),
  payload_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','DELIVERED','FAILED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by varchar(160),
  delivered_at timestamptz,
  failed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id,notification_type,channel),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,appointment_id) REFERENCES appointments(tenant_id,id)
);
CREATE INDEX booking_notification_jobs_pending_idx
  ON booking_notification_jobs(status,available_at,created_at) WHERE status='PENDING';

ALTER TABLE idempotency_keys
  ADD COLUMN actor_scope varchar(200) NOT NULL DEFAULT 'legacy',
  ADD COLUMN command_type varchar(100) NOT NULL DEFAULT 'legacy',
  ADD COLUMN idempotency_key_hash varchar(128),
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX idempotency_command_scope_idx
  ON idempotency_keys(tenant_id,actor_scope,command_type,key);

CREATE FUNCTION bump_booking_availability_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_tenant uuid;
  target_branch uuid;
BEGIN
  target_tenant := COALESCE(NEW.tenant_id,OLD.tenant_id);
  target_branch := COALESCE(NEW.branch_id,OLD.branch_id);
  INSERT INTO availability_versions(tenant_id,branch_id,version,updated_at)
  VALUES(target_tenant,target_branch,1,now())
  ON CONFLICT(tenant_id,branch_id)
  DO UPDATE SET version=availability_versions.version+1,updated_at=now();
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER booking_availability_staff_reservations
  AFTER INSERT OR UPDATE OR DELETE ON staff_schedule_reservations
  FOR EACH ROW EXECUTE FUNCTION bump_booking_availability_version();
CREATE TRIGGER booking_availability_resource_reservations
  AFTER INSERT OR UPDATE OR DELETE ON resource_schedule_reservations
  FOR EACH ROW EXECUTE FUNCTION bump_booking_availability_version();
CREATE TRIGGER booking_availability_slot_holds
  AFTER INSERT OR UPDATE OR DELETE ON slot_holds
  FOR EACH ROW EXECUTE FUNCTION bump_booking_availability_version();

INSERT INTO permissions(code,description) VALUES
('appointment.read','Read appointment summary and detail'),
('appointment.read_branch','Read appointments in authorized branches'),
('appointment.read_own','Read own assigned appointment items'),
('appointment.create','Create appointments'),
('appointment.confirm','Confirm appointments'),
('appointment.reschedule','Reschedule appointments'),
('appointment.cancel','Cancel appointments'),
('appointment.assign_staff','Assign staff through a validated booking plan'),
('appointment.override_policy','Override soft booking policy with reason'),
('appointment.waive_deposit','Waive a deposit requirement with reason'),
('slot_hold.read','Read slot holds'),
('slot_hold.create','Create slot holds'),
('slot_hold.release','Release slot holds'),
('customer.booking_lookup','Lookup customers for internal booking'),
('customer.booking_create','Create guest/customer records during booking')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role,permission_code)
SELECT 'SALON_OWNER',code FROM permissions
WHERE code LIKE 'appointment.%' OR code LIKE 'slot_hold.%' OR code IN ('customer.booking_lookup','customer.booking_create')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code)
SELECT 'BRANCH_MANAGER',code FROM permissions
WHERE code LIKE 'appointment.%' OR code LIKE 'slot_hold.%' OR code IN ('customer.booking_lookup','customer.booking_create')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) VALUES
('RECEPTIONIST','appointment.read'),('RECEPTIONIST','appointment.read_branch'),('RECEPTIONIST','appointment.create'),
('RECEPTIONIST','appointment.confirm'),('RECEPTIONIST','appointment.reschedule'),('RECEPTIONIST','appointment.cancel'),
('RECEPTIONIST','appointment.assign_staff'),('RECEPTIONIST','slot_hold.read'),('RECEPTIONIST','slot_hold.create'),
('RECEPTIONIST','slot_hold.release'),('RECEPTIONIST','customer.booking_lookup'),('RECEPTIONIST','customer.booking_create'),
('CASHIER','appointment.read'),('CASHIER','appointment.read_branch'),
('NAIL_TECHNICIAN','appointment.read_own'),
('ACCOUNTANT','appointment.read'),('ACCOUNTANT','appointment.read_branch')
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version) VALUES('0009_booking_appointment_lifecycle');
COMMIT;

BEGIN;

ALTER TABLE appointments
  ADD COLUMN checkout_ready boolean NOT NULL DEFAULT false;

ALTER TABLE appointment_items
  ADD COLUMN item_source text NOT NULL DEFAULT 'BOOKING',
  ADD COLUMN parent_item_id uuid,
  ADD COLUMN added_at timestamptz,
  ADD COLUMN added_by_user_id uuid,
  ADD COLUMN customer_approved_at timestamptz,
  ADD COLUMN customer_approval_method text,
  ADD CONSTRAINT appointment_items_source_check CHECK (item_source IN ('BOOKING','WALK_IN','ADD_ON','MANUAL')),
  ADD CONSTRAINT appointment_items_approval_method_check CHECK (customer_approval_method IS NULL OR customer_approval_method IN ('VERBAL','DIGITAL','WRITTEN')),
  ADD CONSTRAINT appointment_items_parent_fkey FOREIGN KEY (tenant_id,parent_item_id) REFERENCES appointment_items(tenant_id,id),
  ADD CONSTRAINT appointment_items_added_by_fkey FOREIGN KEY (added_by_user_id) REFERENCES users(id),
  ADD CONSTRAINT appointment_items_added_approval_check CHECK (item_source='BOOKING' OR (added_at IS NOT NULL AND added_by_user_id IS NOT NULL AND customer_approved_at IS NOT NULL AND customer_approval_method IS NOT NULL));

CREATE TABLE appointment_arrivals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  arrival_method text NOT NULL CHECK (arrival_method IN ('RECEPTION','QR','KIOSK','MOBILE')),
  arrived_at timestamptz NOT NULL DEFAULT now(),
  checked_in_at timestamptz,
  late_minutes integer NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
  early_minutes integer NOT NULL DEFAULT 0 CHECK (early_minutes >= 0),
  party_size integer NOT NULL DEFAULT 1 CHECK (party_size >= 1),
  note text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_user_id uuid,
  updated_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  revert_reason text,
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,appointment_id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,appointment_id) REFERENCES appointments(tenant_id,id),
  FOREIGN KEY(created_by_user_id) REFERENCES users(id),
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id),
  CHECK (late_minutes=0 OR early_minutes=0)
);
CREATE INDEX appointment_arrivals_board_idx ON appointment_arrivals(tenant_id,branch_id,arrived_at DESC) WHERE reverted_at IS NULL;

CREATE TABLE walk_in_queue_counters (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  local_queue_date date NOT NULL,
  last_queue_number integer NOT NULL DEFAULT 0 CHECK (last_queue_number >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,branch_id,local_queue_date),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE walk_in_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  local_queue_date date NOT NULL,
  queue_number integer NOT NULL CHECK (queue_number > 0),
  customer_id uuid,
  contact_snapshot_json jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','READY','CALLED','CONVERTED','CANCELLED','LEFT')),
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL','RECOVERY','MANAGER_OVERRIDE')),
  priority_reason text,
  staff_preference_json jsonb NOT NULL DEFAULT '{"type":"ANY"}',
  estimated_start_at timestamptz,
  estimated_wait_minutes integer CHECK (estimated_wait_minutes >= 0),
  estimate_generated_at timestamptz,
  called_at timestamptz,
  converted_appointment_id uuid,
  converted_at timestamptz,
  cancellation_reason_code varchar(80),
  note text,
  source text NOT NULL DEFAULT 'RECEPTION' CHECK (source IN ('RECEPTION','KIOSK','QR','MOBILE')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_user_id uuid,
  updated_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,branch_id,local_queue_date,queue_number),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY(tenant_id,converted_appointment_id) REFERENCES appointments(tenant_id,id),
  FOREIGN KEY(created_by_user_id) REFERENCES users(id),
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id),
  CHECK (priority <> 'MANAGER_OVERRIDE' OR length(trim(priority_reason)) > 0),
  CHECK (status <> 'CONVERTED' OR (converted_appointment_id IS NOT NULL AND converted_at IS NOT NULL))
);
CREATE INDEX walk_in_entries_queue_idx ON walk_in_entries(tenant_id,branch_id,local_queue_date,status,priority,created_at,queue_number);

CREATE TABLE walk_in_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  walk_in_entry_id uuid NOT NULL,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  service_id uuid NOT NULL,
  staff_preference_json jsonb NOT NULL DEFAULT '{"type":"ANY"}',
  service_snapshot_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,walk_in_entry_id,sequence_no),
  FOREIGN KEY(tenant_id,walk_in_entry_id) REFERENCES walk_in_entries(tenant_id,id),
  FOREIGN KEY(tenant_id,service_id) REFERENCES services(tenant_id,id)
);

CREATE TABLE walk_in_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  walk_in_entry_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL CHECK (to_status IN ('WAITING','READY','CALLED','CONVERTED','CANCELLED','LEFT')),
  actor_user_id uuid,
  reason_code varchar(80),
  note text,
  request_id varchar(160) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,walk_in_entry_id) REFERENCES walk_in_entries(tenant_id,id),
  FOREIGN KEY(actor_user_id) REFERENCES users(id)
);
CREATE INDEX walk_in_status_history_lookup_idx ON walk_in_status_history(tenant_id,walk_in_entry_id,created_at,id);

CREATE TABLE service_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  appointment_item_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_PROGRESS','PAUSED','COMPLETED','CANCELLED')),
  scheduled_start_at timestamptz NOT NULL,
  scheduled_end_at timestamptz NOT NULL,
  actual_started_at timestamptz,
  actual_ended_at timestamptz,
  total_pause_seconds integer NOT NULL DEFAULT 0 CHECK (total_pause_seconds >= 0),
  actual_work_seconds integer NOT NULL DEFAULT 0 CHECK (actual_work_seconds >= 0),
  completion_note text,
  cancellation_reason_code varchar(80),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  started_by_user_id uuid,
  completed_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,appointment_item_id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,appointment_id) REFERENCES appointments(tenant_id,id),
  FOREIGN KEY(tenant_id,appointment_item_id) REFERENCES appointment_items(tenant_id,id),
  FOREIGN KEY(started_by_user_id) REFERENCES users(id),
  FOREIGN KEY(completed_by_user_id) REFERENCES users(id),
  CHECK (scheduled_end_at > scheduled_start_at),
  CHECK (actual_ended_at IS NULL OR (actual_started_at IS NOT NULL AND actual_ended_at >= actual_started_at)),
  CHECK (status <> 'COMPLETED' OR actual_ended_at IS NOT NULL)
);
CREATE INDEX service_sessions_board_idx ON service_sessions(tenant_id,branch_id,status,scheduled_start_at);
CREATE INDEX service_sessions_appointment_idx ON service_sessions(tenant_id,appointment_id,scheduled_start_at);

CREATE TABLE service_session_staff_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  service_session_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  segment_role text NOT NULL DEFAULT 'PRIMARY' CHECK (segment_role IN ('PRIMARY','ASSISTANT')),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  ended_reason text CHECK (ended_reason IS NULL OR ended_reason IN ('PAUSED','TRANSFERRED','COMPLETED','CANCELLED')),
  contribution_weight numeric(8,4) CHECK (contribution_weight IS NULL OR contribution_weight >= 0),
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,service_session_id) REFERENCES service_sessions(tenant_id,id),
  FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id),
  FOREIGN KEY(created_by_user_id) REFERENCES users(id),
  CHECK (ended_at IS NULL OR ended_at > started_at),
  CHECK ((ended_at IS NULL) = (ended_reason IS NULL))
);
CREATE UNIQUE INDEX service_segment_one_open_per_staff ON service_session_staff_segments(tenant_id,staff_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX service_segment_one_open_primary ON service_session_staff_segments(tenant_id,service_session_id) WHERE ended_at IS NULL AND segment_role='PRIMARY';
CREATE INDEX service_segment_history_idx ON service_session_staff_segments(tenant_id,service_session_id,started_at,id);

CREATE TABLE service_session_pauses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  service_session_id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  reason_code varchar(80) NOT NULL,
  note text,
  started_by_user_id uuid NOT NULL REFERENCES users(id),
  ended_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,service_session_id) REFERENCES service_sessions(tenant_id,id),
  CHECK (ended_at IS NULL OR ended_at > started_at)
);
CREATE UNIQUE INDEX service_pause_one_open ON service_session_pauses(tenant_id,service_session_id) WHERE ended_at IS NULL;

CREATE TABLE service_session_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  service_session_id uuid NOT NULL,
  author_user_id uuid NOT NULL REFERENCES users(id),
  visibility text NOT NULL CHECK (visibility IN ('INTERNAL','TECHNICIAN')),
  note text NOT NULL CHECK (length(trim(note)) > 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,service_session_id) REFERENCES service_sessions(tenant_id,id)
);

CREATE TABLE service_session_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  service_session_id uuid NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('BEFORE','AFTER','REFERENCE')),
  storage_key varchar(1000) NOT NULL,
  mime_type varchar(120) NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  checksum varchar(128) NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_UPLOAD' CHECK (status IN ('PENDING_UPLOAD','READY','FAILED','DELETED')),
  uploaded_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  deleted_at timestamptz,
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,storage_key),
  FOREIGN KEY(tenant_id,service_session_id) REFERENCES service_sessions(tenant_id,id)
);

CREATE TABLE branch_operational_versions (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,branch_id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE FUNCTION sprint5_append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sprint 5 history is append-only' USING ERRCODE='55000';
END $$;
CREATE TRIGGER walk_in_status_history_append_only BEFORE UPDATE OR DELETE ON walk_in_status_history FOR EACH ROW EXECUTE FUNCTION sprint5_append_only_guard();
CREATE TRIGGER service_session_segments_append_only BEFORE UPDATE OR DELETE ON service_session_staff_segments FOR EACH ROW WHEN (OLD.ended_at IS NOT NULL) EXECUTE FUNCTION sprint5_append_only_guard();

CREATE FUNCTION bump_branch_operational_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_tenant uuid; target_branch uuid;
BEGIN
  target_tenant := COALESCE(NEW.tenant_id,OLD.tenant_id);
  IF TG_TABLE_NAME='walk_in_entries' OR TG_TABLE_NAME='service_sessions' OR TG_TABLE_NAME='appointment_arrivals' THEN
    target_branch := COALESCE(NEW.branch_id,OLD.branch_id);
  ELSE
    SELECT branch_id INTO target_branch FROM service_sessions WHERE tenant_id=target_tenant AND id=COALESCE(NEW.service_session_id,OLD.service_session_id);
  END IF;
  INSERT INTO branch_operational_versions(tenant_id,branch_id,version,updated_at) VALUES(target_tenant,target_branch,1,now())
  ON CONFLICT(tenant_id,branch_id) DO UPDATE SET version=branch_operational_versions.version+1,updated_at=now();
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER walk_in_operational_version AFTER INSERT OR UPDATE ON walk_in_entries FOR EACH ROW EXECUTE FUNCTION bump_branch_operational_version();
CREATE TRIGGER arrival_operational_version AFTER INSERT OR UPDATE ON appointment_arrivals FOR EACH ROW EXECUTE FUNCTION bump_branch_operational_version();
CREATE TRIGGER session_operational_version AFTER INSERT OR UPDATE ON service_sessions FOR EACH ROW EXECUTE FUNCTION bump_branch_operational_version();
CREATE TRIGGER segment_operational_version AFTER INSERT OR UPDATE ON service_session_staff_segments FOR EACH ROW EXECUTE FUNCTION bump_branch_operational_version();

INSERT INTO branch_operational_versions(tenant_id,branch_id)
SELECT tenant_id,id FROM branches ON CONFLICT DO NOTHING;

INSERT INTO permissions(code,description) VALUES
('operations.board.read','Read the branch operational board'),
('walkin.read','Read walk-in queue entries'),('walkin.create','Register a walk-in'),('walkin.update','Update a walk-in'),
('walkin.call','Change walk-in readiness/call state'),('walkin.convert','Convert a walk-in through booking'),
('walkin.cancel','Cancel or mark a walk-in left'),('walkin.priority','Override walk-in priority with reason'),
('appointment.arrive','Record customer arrival'),('appointment.check_in','Check in an appointment'),
('appointment.revert_check_in','Revert check-in with reason'),('appointment.checkout_summary','Read checkout-ready preview'),
('service_session.read_branch','Read branch service sessions'),('service_session.read_own','Read assigned service sessions'),
('service_session.start','Start assigned service'),('service_session.pause','Pause assigned service'),
('service_session.resume','Resume assigned service'),('service_session.complete','Complete assigned service'),
('service_session.cancel','Cancel a service session'),('service_session.transfer_staff','Transfer active staff'),
('service_session.add_service','Plan and commit an in-salon service'),('service_session.note','Manage authorized session notes'),
('service_session.media','Manage authorized session media')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role,permission_code)
SELECT role,code FROM (VALUES ('SALON_OWNER'),('BRANCH_MANAGER')) r(role) CROSS JOIN permissions p
WHERE p.code IN ('operations.board.read','walkin.read','walkin.create','walkin.update','walkin.call','walkin.convert','walkin.cancel','walkin.priority','appointment.arrive','appointment.check_in','appointment.revert_check_in','appointment.checkout_summary','service_session.read_branch','service_session.read_own','service_session.start','service_session.pause','service_session.resume','service_session.complete','service_session.cancel','service_session.transfer_staff','service_session.add_service','service_session.note','service_session.media')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) VALUES
('RECEPTIONIST','operations.board.read'),('RECEPTIONIST','walkin.read'),('RECEPTIONIST','walkin.create'),('RECEPTIONIST','walkin.update'),('RECEPTIONIST','walkin.call'),('RECEPTIONIST','walkin.convert'),('RECEPTIONIST','walkin.cancel'),('RECEPTIONIST','appointment.arrive'),('RECEPTIONIST','appointment.check_in'),('RECEPTIONIST','appointment.checkout_summary'),('RECEPTIONIST','service_session.read_branch'),('RECEPTIONIST','service_session.transfer_staff'),('RECEPTIONIST','service_session.add_service'),('RECEPTIONIST','service_session.note'),
('NAIL_TECHNICIAN','service_session.read_own'),('NAIL_TECHNICIAN','service_session.start'),('NAIL_TECHNICIAN','service_session.pause'),('NAIL_TECHNICIAN','service_session.resume'),('NAIL_TECHNICIAN','service_session.complete'),('NAIL_TECHNICIAN','service_session.note'),('NAIL_TECHNICIAN','service_session.media'),
('CASHIER','operations.board.read'),('CASHIER','appointment.checkout_summary')
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version) VALUES('0011_walkin_checkin_service_execution');
COMMIT;

BEGIN;

CREATE TABLE availability_versions (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, branch_id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS resources_tenant_branch_id_unique ON resources(tenant_id, branch_id, id);

INSERT INTO availability_versions(tenant_id, branch_id)
SELECT tenant_id, id FROM branches ON CONFLICT DO NOTHING;

CREATE TABLE availability_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  staff_id uuid,
  resource_id uuid,
  block_type text NOT NULL CHECK (block_type IN ('MANUAL','EXTERNAL','MAINTENANCE','SYSTEM')),
  title varchar(200) NOT NULL CHECK (length(trim(title)) > 0),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED','EXPIRED')),
  source varchar(100),
  source_reference varchar(255),
  notes text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_user_id uuid,
  updated_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, staff_id) REFERENCES staff_profiles(tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id, resource_id) REFERENCES resources(tenant_id, branch_id, id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  FOREIGN KEY (updated_by_user_id) REFERENCES users(id),
  CHECK (staff_id IS NOT NULL OR resource_id IS NOT NULL),
  CHECK (end_at > start_at),
  CHECK (block_type <> 'MAINTENANCE' OR resource_id IS NOT NULL),
  CHECK (block_type <> 'EXTERNAL' OR (source IS NOT NULL AND source_reference IS NOT NULL)),
  CHECK ((status = 'CANCELLED' AND cancelled_at IS NOT NULL) OR status <> 'CANCELLED')
);

CREATE UNIQUE INDEX availability_blocks_external_idempotency_idx
  ON availability_blocks(tenant_id, source, source_reference)
  WHERE block_type = 'EXTERNAL';
CREATE INDEX availability_blocks_branch_time_idx ON availability_blocks(tenant_id, branch_id, status, start_at, end_at);
CREATE INDEX availability_blocks_staff_time_idx ON availability_blocks(tenant_id, staff_id, status, start_at, end_at) WHERE staff_id IS NOT NULL;
CREATE INDEX availability_blocks_resource_time_idx ON availability_blocks(tenant_id, resource_id, status, start_at, end_at) WHERE resource_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS business_hours_availability_idx ON business_hours(tenant_id, branch_id, day_of_week, valid_from, valid_to);
CREATE INDEX IF NOT EXISTS staff_assignments_availability_idx ON staff_branch_assignments(tenant_id, branch_id, status, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS staff_skills_availability_idx ON staff_skills(tenant_id, staff_id, status, expires_at);
CREATE INDEX IF NOT EXISTS shifts_branch_status_time_idx ON shifts(tenant_id, branch_id, status, start_at, end_at);
CREATE INDEX IF NOT EXISTS shifts_staff_status_time_idx ON shifts(tenant_id, staff_id, status, start_at, end_at);
CREATE INDEX IF NOT EXISTS leave_branch_status_time_idx ON leave_requests(tenant_id, branch_id, status, start_at, end_at);
CREATE INDEX IF NOT EXISTS resources_availability_idx ON resources(tenant_id, branch_id, resource_type_id, status);

CREATE OR REPLACE FUNCTION validate_availability_block_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.staff_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM staff_branch_assignments a
    WHERE a.tenant_id=NEW.tenant_id AND a.staff_id=NEW.staff_id AND a.branch_id=NEW.branch_id
      AND a.status='ACTIVE' AND a.effective_from<=NEW.start_at::date
      AND (a.effective_to IS NULL OR a.effective_to>=NEW.end_at::date)
  ) THEN
    RAISE EXCEPTION 'Busy block staff target is outside branch' USING ERRCODE='23514', CONSTRAINT='availability_block_staff_branch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER availability_block_target_guard BEFORE INSERT OR UPDATE OF tenant_id,branch_id,staff_id,start_at,end_at ON availability_blocks FOR EACH ROW EXECUTE FUNCTION validate_availability_block_target();

-- PostgreSQL owns the invalidation version. A tenant-wide bump is deliberately
-- conservative: it cannot return stale availability and avoids Redis key scans.
CREATE OR REPLACE FUNCTION bump_tenant_availability_versions() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE affected_tenant uuid;
BEGIN
  affected_tenant := COALESCE(NEW.tenant_id, OLD.tenant_id);
  INSERT INTO availability_versions(tenant_id, branch_id, version, updated_at)
  SELECT b.tenant_id, b.id, 1, now() FROM branches b WHERE b.tenant_id = affected_tenant
  ON CONFLICT (tenant_id, branch_id) DO UPDATE
    SET version = availability_versions.version + 1, updated_at = now();
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER availability_bump_branches AFTER INSERT OR UPDATE OR DELETE ON branches FOR EACH ROW EXECUTE FUNCTION bump_tenant_availability_versions();
CREATE TRIGGER availability_bump_business_hours AFTER INSERT OR UPDATE OR DELETE ON business_hours FOR EACH ROW EXECUTE FUNCTION bump_tenant_availability_versions();
CREATE TRIGGER availability_bump_services AFTER INSERT OR UPDATE OR DELETE ON services FOR EACH ROW EXECUTE FUNCTION bump_tenant_availability_versions();
CREATE TRIGGER availability_bump_service_prices AFTER INSERT OR UPDATE OR DELETE ON service_prices FOR EACH ROW EXECUTE FUNCTION bump_tenant_availability_versions();
CREATE TRIGGER availability_bump_service_skills AFTER INSERT OR UPDATE OR DELETE ON service_skill_requirements FOR EACH ROW EXECUTE FUNCTION bump_tenant_availability_versions();
CREATE TRIGGER availability_bump_service_resources AFTER INSERT OR UPDATE OR DELETE ON service_resource_requirements FOR EACH ROW EXECUTE FUNCTION bump_tenant_availability_versions();
CREATE TRIGGER availability_bump_staff_assignments AFTER INSERT OR UPDATE OR DELETE ON staff_branch_assignments FOR EACH ROW EXECUTE FUNCTION bump_tenant_availability_versions();
CREATE TRIGGER availability_bump_staff_skills AFTER INSERT OR UPDATE OR DELETE ON staff_skills FOR EACH ROW EXECUTE FUNCTION bump_tenant_availability_versions();
CREATE TRIGGER availability_bump_shifts AFTER INSERT OR UPDATE OR DELETE ON shifts FOR EACH ROW EXECUTE FUNCTION bump_tenant_availability_versions();
CREATE TRIGGER availability_bump_leave AFTER INSERT OR UPDATE OR DELETE ON leave_requests FOR EACH ROW EXECUTE FUNCTION bump_tenant_availability_versions();
CREATE TRIGGER availability_bump_resources AFTER INSERT OR UPDATE OR DELETE ON resources FOR EACH ROW EXECUTE FUNCTION bump_tenant_availability_versions();
CREATE TRIGGER availability_bump_blocks AFTER INSERT OR UPDATE OR DELETE ON availability_blocks FOR EACH ROW EXECUTE FUNCTION bump_tenant_availability_versions();

INSERT INTO permissions(code, description) VALUES
('availability.read','Read calculated availability'),
('availability.explain','Explain availability decisions'),
('calendar.read_branch','Read branch calendar'),
('calendar.read_own','Read own staff calendar'),
('availability_block.read','Read availability blocks'),
('availability_block.create','Create manual or external availability blocks'),
('availability_block.update','Update availability blocks'),
('availability_block.cancel','Cancel availability blocks'),
('resource_maintenance.manage','Manage resource maintenance blocks')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role, permission_code)
SELECT role, code FROM (VALUES ('SALON_OWNER'),('BRANCH_MANAGER')) roles(role)
CROSS JOIN (VALUES ('availability.read'),('availability.explain'),('calendar.read_branch'),('availability_block.read'),('availability_block.create'),('availability_block.update'),('availability_block.cancel'),('resource_maintenance.manage')) perms(code)
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role, permission_code) VALUES
('RECEPTIONIST','availability.read'),('RECEPTIONIST','calendar.read_branch'),
('RECEPTIONIST','availability_block.read'),('RECEPTIONIST','availability_block.create'),('RECEPTIONIST','availability_block.cancel'),
('NAIL_TECHNICIAN','availability.read'),('NAIL_TECHNICIAN','calendar.read_own'),('NAIL_TECHNICIAN','availability_block.read')
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version) VALUES ('0007_availability_calendar');
COMMIT;

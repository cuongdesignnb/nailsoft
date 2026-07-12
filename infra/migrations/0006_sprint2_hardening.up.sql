BEGIN;

INSERT INTO permissions(code,description) VALUES ('leave.create_branch','Create leave for a staff member in branch scope') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) VALUES ('SALON_OWNER','leave.create_branch'),('BRANCH_MANAGER','leave.create_branch') ON CONFLICT DO NOTHING;

-- Operational staff assignments are intervals, not mere authorization links.
ALTER TABLE staff_branch_assignments
  ADD COLUMN IF NOT EXISTS effective_range daterange GENERATED ALWAYS AS
    (daterange(effective_from, COALESCE(effective_to + 1, 'infinity'::date), '[)')) STORED;
ALTER TABLE staff_branch_assignments
  DROP CONSTRAINT IF EXISTS staff_branch_assignment_no_overlap;
ALTER TABLE staff_branch_assignments
  ADD CONSTRAINT staff_branch_assignment_no_overlap EXCLUDE USING gist
    (tenant_id WITH =, staff_id WITH =, branch_id WITH =, effective_range WITH &&)
    WHERE (status = 'ACTIVE');
ALTER TABLE staff_branch_assignments
  DROP CONSTRAINT IF EXISTS staff_primary_assignment_no_overlap;
ALTER TABLE staff_branch_assignments
  ADD CONSTRAINT staff_primary_assignment_no_overlap EXCLUDE USING gist
    (tenant_id WITH =, staff_id WITH =, effective_range WITH &&)
    WHERE (status = 'ACTIVE' AND is_primary);

-- Different shift rows can be published concurrently; protect the invariant in PostgreSQL.
ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS published_range tstzrange GENERATED ALWAYS AS
    (tstzrange(start_at, end_at, '[)')) STORED;
ALTER TABLE shifts
  DROP CONSTRAINT IF EXISTS shifts_published_no_overlap;
ALTER TABLE shifts
  ADD CONSTRAINT shifts_published_no_overlap EXCLUDE USING gist
    (tenant_id WITH =, staff_id WITH =, published_range WITH &&)
    WHERE (status = 'PUBLISHED');

CREATE OR REPLACE FUNCTION prevent_service_addon_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    WITH RECURSIVE reachable(id) AS (
      SELECT NEW.addon_service_id
      UNION
      SELECT sa.addon_service_id
      FROM service_addons sa JOIN reachable r ON r.id = sa.service_id
      WHERE sa.tenant_id = NEW.tenant_id
    ) SELECT 1 FROM reachable WHERE id = NEW.service_id
  ) THEN
    RAISE EXCEPTION 'Service add-on cycle detected' USING ERRCODE = '23514', CONSTRAINT = 'service_addon_cycle';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS service_addon_cycle_guard ON service_addons;
CREATE TRIGGER service_addon_cycle_guard BEFORE INSERT OR UPDATE ON service_addons
  FOR EACH ROW EXECUTE FUNCTION prevent_service_addon_cycle();

-- Sprint 2 endpoints use granular permission codes only. Remove foundation aliases.
DELETE FROM role_permissions WHERE permission_code IN
  ('catalog.read','catalog.manage','catalog.price.manage','resource.manage','staff.manage','staff.skill.manage','shift.manage','leave.read','leave.manage');
DELETE FROM permissions WHERE code IN
  ('catalog.read','catalog.manage','catalog.price.manage','resource.manage','staff.manage','staff.skill.manage','shift.manage','leave.read','leave.manage');

INSERT INTO schema_migrations(version) VALUES('0006_sprint2_hardening');
COMMIT;

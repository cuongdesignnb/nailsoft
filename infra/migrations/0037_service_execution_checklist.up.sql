-- Service execution checklist templates are optional.  A session without a
-- matching template intentionally returns an empty checklist to the client.
CREATE TABLE service_execution_checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  service_id uuid NOT NULL,
  branch_id uuid,
  name varchar(160) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,service_id) REFERENCES services(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE INDEX service_execution_checklist_template_lookup
  ON service_execution_checklist_templates(tenant_id,service_id,branch_id,active);

CREATE TABLE service_execution_checklist_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  template_id uuid NOT NULL,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  label varchar(500) NOT NULL CHECK (length(trim(label)) > 0),
  required boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,template_id,sequence_no),
  FOREIGN KEY(tenant_id,template_id)
    REFERENCES service_execution_checklist_templates(tenant_id,id)
);

CREATE TABLE service_session_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  service_session_id uuid NOT NULL,
  template_item_id uuid NOT NULL,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  label varchar(500) NOT NULL CHECK (length(trim(label)) > 0),
  required boolean NOT NULL DEFAULT false,
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  completed_by_user_id uuid REFERENCES users(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,service_session_id,template_item_id),
  FOREIGN KEY(tenant_id,service_session_id)
    REFERENCES service_sessions(tenant_id,id),
  FOREIGN KEY(tenant_id,template_item_id)
    REFERENCES service_execution_checklist_template_items(tenant_id,id),
  CHECK ((completed = false AND completed_at IS NULL) OR completed = true)
);
CREATE INDEX service_session_checklist_lookup
  ON service_session_checklist_items(tenant_id,service_session_id,sequence_no,id);

CREATE FUNCTION clone_service_session_checklist() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_service uuid;
  target_template uuid;
BEGIN
  SELECT service_id INTO target_service
    FROM appointment_items
   WHERE tenant_id=NEW.tenant_id AND id=NEW.appointment_item_id;

  SELECT t.id INTO target_template
    FROM service_execution_checklist_templates t
   WHERE t.tenant_id=NEW.tenant_id
     AND t.service_id=target_service
     AND t.active
     AND (t.branch_id=NEW.branch_id OR t.branch_id IS NULL)
   ORDER BY CASE WHEN t.branch_id=NEW.branch_id THEN 0 ELSE 1 END, t.updated_at DESC, t.id
   LIMIT 1;

  IF target_template IS NOT NULL THEN
    INSERT INTO service_session_checklist_items(
      tenant_id,service_session_id,template_item_id,sequence_no,label,required
    )
    SELECT NEW.tenant_id,NEW.id,ti.id,ti.sequence_no,ti.label,ti.required
      FROM service_execution_checklist_template_items ti
     WHERE ti.tenant_id=NEW.tenant_id
       AND ti.template_id=target_template
       AND ti.active
     ORDER BY ti.sequence_no,ti.id
    ON CONFLICT(tenant_id,service_session_id,template_item_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER service_session_checklist_template_clone
  AFTER INSERT ON service_sessions
  FOR EACH ROW EXECUTE FUNCTION clone_service_session_checklist();

INSERT INTO permissions(code,description)
VALUES('service_session.checklist','Read and update service execution checklists')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code)
SELECT r.role,'service_session.checklist'
  FROM (VALUES ('SALON_OWNER'),('BRANCH_MANAGER'),('RECEPTIONIST'),('NAIL_TECHNICIAN')) r(role)
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version)
VALUES('0037_service_execution_checklist')
ON CONFLICT DO NOTHING;

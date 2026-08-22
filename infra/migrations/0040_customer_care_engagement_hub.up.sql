BEGIN;

CREATE TABLE customer_care_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid,
  customer_id uuid NOT NULL,
  activity_type text NOT NULL CHECK(activity_type IN('CALL','INTERNAL_NOTE','MANUAL_TOUCHPOINT')),
  outcome_code text,
  summary text NOT NULL CHECK(length(trim(summary)) BETWEEN 1 AND 2000),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  related_entity_type text,
  related_entity_id uuid,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  generation_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,generation_key),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);

CREATE TABLE customer_care_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid,
  customer_id uuid NOT NULL,
  reason_code text NOT NULL CHECK(length(trim(reason_code)) BETWEEN 1 AND 120),
  note text,
  assigned_user_id uuid REFERENCES users(id),
  due_at timestamptz NOT NULL,
  priority text NOT NULL DEFAULT 'MEDIUM' CHECK(priority IN('LOW','MEDIUM','HIGH')),
  status text NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','IN_PROGRESS','COMPLETED','CANCELLED')),
  source_activity_id uuid,
  related_entity_type text,
  related_entity_id uuid,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  completed_by_user_id uuid REFERENCES users(id),
  completed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  generation_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,generation_key),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY(tenant_id,source_activity_id) REFERENCES customer_care_activities(tenant_id,id)
);

CREATE OR REPLACE FUNCTION customer_care_activity_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CUSTOMER_CARE_ACTIVITY_APPEND_ONLY' USING ERRCODE='55000';
END $$;
CREATE TRIGGER customer_care_activities_append_only
  BEFORE UPDATE OR DELETE ON customer_care_activities
  FOR EACH ROW EXECUTE FUNCTION customer_care_activity_append_only();

CREATE INDEX customer_care_activities_scope_idx
  ON customer_care_activities(tenant_id,branch_id,occurred_at DESC);
CREATE INDEX customer_care_activities_customer_idx
  ON customer_care_activities(tenant_id,customer_id,occurred_at DESC);
CREATE INDEX customer_care_followups_board_idx
  ON customer_care_followups(tenant_id,branch_id,status,due_at);
CREATE INDEX customer_care_followups_customer_idx
  ON customer_care_followups(tenant_id,customer_id,status,due_at);
CREATE INDEX customer_care_followups_assignee_idx
  ON customer_care_followups(tenant_id,assigned_user_id,status,due_at);

INSERT INTO permissions(code,description)
SELECT code,'Customer Care engagement workspace permission'
FROM unnest(ARRAY[
  'customer.care.read',
  'customer.care.manage',
  'customer.care.followup.manage'
]) code
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role,permission_code)
SELECT r.role,p.code
FROM (VALUES
  ('SALON_OWNER','customer.care.read'),
  ('SALON_OWNER','customer.care.manage'),
  ('SALON_OWNER','customer.care.followup.manage'),
  ('BRANCH_MANAGER','customer.care.read'),
  ('BRANCH_MANAGER','customer.care.manage'),
  ('BRANCH_MANAGER','customer.care.followup.manage'),
  ('RECEPTIONIST','customer.care.read'),
  ('RECEPTIONIST','customer.care.manage'),
  ('RECEPTIONIST','customer.care.followup.manage')
) r(role,permission_code)
JOIN permissions p ON p.code=r.permission_code
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version)
VALUES('0040_customer_care_engagement_hub');

COMMIT;

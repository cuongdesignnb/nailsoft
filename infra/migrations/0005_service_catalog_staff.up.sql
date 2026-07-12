BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Extend the foundation catalog without rewriting migrations 0001-0004.
ALTER TABLE service_categories
  ADD COLUMN IF NOT EXISTS parent_id uuid,
  ADD COLUMN IF NOT EXISTS description_json jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;
UPDATE service_categories SET code = COALESCE(code, 'CAT-' || right(id::text, 8)) WHERE code IS NULL;
ALTER TABLE service_categories ALTER COLUMN code SET NOT NULL;
ALTER TABLE service_categories DROP CONSTRAINT IF EXISTS service_categories_parent_fk;
ALTER TABLE service_categories ADD CONSTRAINT service_categories_parent_fk FOREIGN KEY (tenant_id,parent_id) REFERENCES service_categories(tenant_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS service_categories_tenant_code_unique ON service_categories(tenant_id,lower(code));
CREATE INDEX IF NOT EXISTS service_categories_scope_idx ON service_categories(tenant_id,status,sort_order);
ALTER TABLE service_categories DROP CONSTRAINT IF EXISTS service_categories_status_check;
ALTER TABLE service_categories ADD CONSTRAINT service_categories_status_check CHECK (status IN ('ACTIVE','INACTIVE','ARCHIVED'));

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS description_json jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS default_duration_min integer,
  ADD COLUMN IF NOT EXISTS prep_time_min integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cleanup_time_min integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS booking_buffer_before_min integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS booking_buffer_after_min integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_type text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS deposit_value numeric(12,2),
  ADD COLUMN IF NOT EXISTS tax_code text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS online_booking_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;
UPDATE services SET default_duration_min = COALESCE(default_duration_min,duration_minutes), status = COALESCE(status,'DRAFT') WHERE default_duration_min IS NULL;
ALTER TABLE services ALTER COLUMN default_duration_min SET NOT NULL;
ALTER TABLE services DROP CONSTRAINT IF EXISTS services_duration_range;
ALTER TABLE services ADD CONSTRAINT services_duration_range CHECK (default_duration_min BETWEEN 5 AND 720);
ALTER TABLE services ADD CONSTRAINT services_time_fields_nonnegative CHECK (prep_time_min >= 0 AND cleanup_time_min >= 0 AND booking_buffer_before_min >= 0 AND booking_buffer_after_min >= 0);
ALTER TABLE services DROP CONSTRAINT IF EXISTS services_deposit_check;
ALTER TABLE services ADD CONSTRAINT services_deposit_check CHECK ((deposit_type='NONE' AND (deposit_value IS NULL OR deposit_value=0)) OR (deposit_type='FIXED' AND deposit_value IS NOT NULL AND deposit_value>=0) OR (deposit_type='PERCENT' AND deposit_value BETWEEN 0 AND 100));
ALTER TABLE services DROP CONSTRAINT IF EXISTS services_status_check;
ALTER TABLE services ADD CONSTRAINT services_status_check CHECK (status IN ('DRAFT','ACTIVE','INACTIVE','ARCHIVED'));
CREATE INDEX IF NOT EXISTS services_scope_idx ON services(tenant_id,status,category_id);
CREATE INDEX IF NOT EXISTS services_tenant_code_lower_idx ON services(tenant_id,lower(code));

CREATE TABLE IF NOT EXISTS service_addons (
  tenant_id uuid NOT NULL REFERENCES tenants(id), service_id uuid NOT NULL, addon_service_id uuid NOT NULL,
  relationship_type text NOT NULL DEFAULT 'OPTIONAL' CHECK (relationship_type IN ('OPTIONAL','RECOMMENDED','REQUIRED')),
  sort_order integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,service_id,addon_service_id),
  FOREIGN KEY (tenant_id,service_id) REFERENCES services(tenant_id,id),
  FOREIGN KEY (tenant_id,addon_service_id) REFERENCES services(tenant_id,id),
  CHECK (service_id <> addon_service_id)
);

CREATE TABLE IF NOT EXISTS skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), code text NOT NULL,
  name_json jsonb NOT NULL, description_json jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE','ARCHIVED')),
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS skills_tenant_code_unique ON skills(tenant_id,lower(code));
CREATE INDEX IF NOT EXISTS skills_scope_idx ON skills(tenant_id,status);

CREATE TABLE IF NOT EXISTS service_skill_requirements (
  tenant_id uuid NOT NULL REFERENCES tenants(id), service_id uuid NOT NULL, skill_id uuid NOT NULL,
  minimum_proficiency integer NOT NULL CHECK(minimum_proficiency BETWEEN 1 AND 5), is_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,service_id,skill_id), FOREIGN KEY (tenant_id,service_id) REFERENCES services(tenant_id,id), FOREIGN KEY (tenant_id,skill_id) REFERENCES skills(tenant_id,id)
);

CREATE TABLE IF NOT EXISTS service_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), service_id uuid NOT NULL,
  branch_id uuid, amount numeric(12,2) NOT NULL CHECK(amount>=0), currency char(3) NOT NULL,
  effective_from timestamptz NOT NULL, effective_to timestamptz, status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','EXPIRED','CANCELLED')),
  version integer NOT NULL DEFAULT 1, created_by_user_id uuid, updated_by_user_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id), FOREIGN KEY (tenant_id,service_id) REFERENCES services(tenant_id,id), FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  CHECK(effective_to IS NULL OR effective_to > effective_from)
);
ALTER TABLE service_prices ADD COLUMN IF NOT EXISTS branch_scope_id uuid GENERATED ALWAYS AS (COALESCE(branch_id,'00000000-0000-0000-0000-000000000000'::uuid)) STORED;
CREATE INDEX IF NOT EXISTS service_prices_lookup_idx ON service_prices(tenant_id,service_id,branch_id,effective_from);
ALTER TABLE service_prices DROP CONSTRAINT IF EXISTS service_prices_active_no_overlap;
ALTER TABLE service_prices ADD CONSTRAINT service_prices_active_no_overlap EXCLUDE USING gist (
  tenant_id WITH =, service_id WITH =, branch_scope_id WITH =, currency WITH =,
  tstzrange(effective_from,COALESCE(effective_to,'infinity'::timestamptz),'[)') WITH &&
) WHERE (status='ACTIVE');

CREATE TABLE IF NOT EXISTS resource_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), code text NOT NULL,
  name_json jsonb NOT NULL, status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS resource_types_tenant_code_unique ON resource_types(tenant_id,lower(code));
CREATE TABLE IF NOT EXISTS resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid NOT NULL, resource_type_id uuid NOT NULL,
  code text NOT NULL, name text NOT NULL, capacity integer NOT NULL DEFAULT 1 CHECK(capacity>=1), status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','MAINTENANCE','INACTIVE','ARCHIVED')),
  metadata_json jsonb NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,branch_id,code), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,resource_type_id) REFERENCES resource_types(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS resources_scope_idx ON resources(tenant_id,branch_id,status);
CREATE TABLE IF NOT EXISTS service_resource_requirements (
  tenant_id uuid NOT NULL REFERENCES tenants(id), service_id uuid NOT NULL, resource_type_id uuid NOT NULL, quantity integer NOT NULL DEFAULT 1 CHECK(quantity>=1), is_exclusive boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,service_id,resource_type_id), FOREIGN KEY(tenant_id,service_id) REFERENCES services(tenant_id,id), FOREIGN KEY(tenant_id,resource_type_id) REFERENCES resource_types(tenant_id,id)
);

CREATE TABLE IF NOT EXISTS staff_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), membership_id uuid, employee_code text NOT NULL, display_name text NOT NULL,
  legal_name text, preferred_name text, avatar_media_id uuid, level_code text, employment_type text NOT NULL DEFAULT 'FULL_TIME' CHECK(employment_type IN ('FULL_TIME','PART_TIME','CONTRACTOR','TEMPORARY')),
  status text NOT NULL DEFAULT 'INVITED' CHECK(status IN ('INVITED','ACTIVE','ON_LEAVE','SUSPENDED','TERMINATED','ARCHIVED')), hire_date date, termination_date date, preferred_locale text NOT NULL DEFAULT 'vi-VN' CHECK(preferred_locale IN ('vi-VN','en-US')), notes text, version integer NOT NULL DEFAULT 1,
  created_by_user_id uuid, updated_by_user_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,employee_code),
  FOREIGN KEY(tenant_id,membership_id) REFERENCES tenant_memberships(tenant_id,id), CHECK(termination_date IS NULL OR hire_date IS NULL OR termination_date>=hire_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_active_membership_unique ON staff_profiles(tenant_id,membership_id) WHERE membership_id IS NOT NULL AND status NOT IN ('TERMINATED','ARCHIVED');
CREATE INDEX IF NOT EXISTS staff_profiles_scope_idx ON staff_profiles(tenant_id,status);
CREATE TABLE IF NOT EXISTS staff_branch_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), staff_id uuid NOT NULL, branch_id uuid NOT NULL, is_primary boolean NOT NULL DEFAULT false, can_be_booked boolean NOT NULL DEFAULT false,
  effective_from date NOT NULL, effective_to date, status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), CHECK(effective_to IS NULL OR effective_to>=effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_one_primary_branch ON staff_branch_assignments(tenant_id,staff_id) WHERE is_primary AND status='ACTIVE';
CREATE INDEX IF NOT EXISTS staff_branch_scope_idx ON staff_branch_assignments(tenant_id,branch_id,status,effective_from);
CREATE TABLE IF NOT EXISTS staff_skills (
  tenant_id uuid NOT NULL REFERENCES tenants(id), staff_id uuid NOT NULL, skill_id uuid NOT NULL, proficiency_level integer NOT NULL CHECK(proficiency_level BETWEEN 1 AND 5), status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),
  certified_at date, expires_at date, notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,staff_id,skill_id), FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id), FOREIGN KEY(tenant_id,skill_id) REFERENCES skills(tenant_id,id), CHECK(expires_at IS NULL OR certified_at IS NULL OR expires_at>=certified_at)
);

CREATE TABLE IF NOT EXISTS shift_recurrence_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid NOT NULL, staff_id uuid NOT NULL, timezone text NOT NULL, rrule text NOT NULL,
  local_start_time time NOT NULL, local_end_time time NOT NULL, effective_from date NOT NULL, effective_to date, status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','PAUSED','ENDED')), version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id), CHECK(local_end_time>local_start_time), CHECK(effective_to IS NULL OR effective_to>=effective_from)
);
CREATE TABLE IF NOT EXISTS shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid NOT NULL, staff_id uuid NOT NULL, start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
  break_minutes integer NOT NULL DEFAULT 0 CHECK(break_minutes>=0), status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','CANCELLED')), source text NOT NULL DEFAULT 'MANUAL' CHECK(source IN ('MANUAL','RECURRING_RULE','IMPORT')), recurrence_rule_id uuid, version integer NOT NULL DEFAULT 1, created_by_user_id uuid, updated_by_user_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id), FOREIGN KEY(tenant_id,recurrence_rule_id) REFERENCES shift_recurrence_rules(tenant_id,id), CHECK(end_at>start_at), CHECK(break_minutes < EXTRACT(EPOCH FROM (end_at-start_at))/60)
);
CREATE INDEX IF NOT EXISTS shifts_branch_time_idx ON shifts(tenant_id,branch_id,start_at,end_at);
CREATE INDEX IF NOT EXISTS shifts_staff_time_idx ON shifts(tenant_id,staff_id,start_at,end_at);

CREATE TABLE IF NOT EXISTS leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), staff_id uuid NOT NULL, branch_id uuid, leave_type text NOT NULL DEFAULT 'OTHER', start_at timestamptz NOT NULL, end_at timestamptz NOT NULL, reason text, status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PENDING','APPROVED','REJECTED','CANCELLED')),
  review_note text, reviewed_by_user_id uuid, reviewed_at timestamptz, version integer NOT NULL DEFAULT 1, created_by_user_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), CHECK(end_at>start_at)
);
CREATE INDEX IF NOT EXISTS leave_requests_pending_idx ON leave_requests(tenant_id,status,start_at);

INSERT INTO permissions(code,description) VALUES
('catalog.read','View service catalog'),('catalog.manage','Manage categories, services, skills and add-ons'),('catalog.price.manage','Manage service prices'),('resource.read','View resource catalog'),('resource.manage','Manage resource types and branch resources'),('staff.read','View staff profiles'),('staff.manage','Manage staff profiles and assignments'),('staff.skill.manage','Manage staff skills'),('shift.read','View shifts'),('shift.manage','Manage and publish shifts'),('leave.read','View leave requests'),('leave.manage','Review and manage leave requests') ON CONFLICT DO NOTHING;
INSERT INTO permissions(code,description) VALUES
('service_category.read','Read service categories'),('service_category.create','Create service categories'),('service_category.update','Update service categories'),('service_category.archive','Archive service categories'),('service.read','Read services'),('service.create','Create services'),('service.update','Update services'),('service.activate','Activate services'),('service.archive','Archive services'),('service_price.read','Read service prices'),('service_price.create','Create service prices'),('service_price.update','Update service prices'),('service_price.cancel','Cancel service prices'),('skill.read','Read skills'),('skill.create','Create skills'),('skill.update','Update skills'),('skill.archive','Archive skills'),('resource.create','Create resources'),('resource.update','Update resources'),('resource.archive','Archive resources'),('staff.create','Create staff profiles'),('staff.update','Update staff profiles'),('staff.archive','Archive staff profiles'),('staff.assign_branch','Assign staff branches'),('staff.assign_skill','Assign staff skills'),('shift.create','Create shifts'),('shift.update','Update shifts'),('shift.publish','Publish shifts'),('shift.cancel','Cancel shifts'),('leave.read_own','Read own leave'),('leave.create_own','Create own leave'),('leave.read_branch','Read branch leave'),('leave.review_branch','Review branch leave'),('leave.cancel','Cancel leave') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) SELECT r.role,p.code FROM (VALUES ('SALON_OWNER'),('BRANCH_MANAGER')) r(role) CROSS JOIN (VALUES ('catalog.read'),('catalog.manage'),('catalog.price.manage'),('resource.read'),('resource.manage'),('staff.read'),('staff.manage'),('staff.skill.manage'),('shift.read'),('shift.manage'),('leave.read'),('leave.manage')) p(code) ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) VALUES ('RECEPTIONIST','catalog.read'),('RECEPTIONIST','resource.read'),('RECEPTIONIST','staff.read'),('RECEPTIONIST','shift.read'),('RECEPTIONIST','leave.read'),('NAIL_TECHNICIAN','catalog.read'),('NAIL_TECHNICIAN','staff.read'),('NAIL_TECHNICIAN','shift.read'),('NAIL_TECHNICIAN','leave.read'),('NAIL_TECHNICIAN','leave.manage') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) SELECT r.role,p.code FROM (VALUES ('SALON_OWNER'),('BRANCH_MANAGER')) r(role) CROSS JOIN (VALUES ('service_category.read'),('service_category.create'),('service_category.update'),('service_category.archive'),('service.read'),('service.create'),('service.update'),('service.activate'),('service.archive'),('service_price.read'),('service_price.create'),('service_price.update'),('service_price.cancel'),('skill.read'),('skill.create'),('skill.update'),('skill.archive'),('resource.create'),('resource.update'),('resource.archive'),('staff.create'),('staff.update'),('staff.archive'),('staff.assign_branch'),('staff.assign_skill'),('shift.create'),('shift.update'),('shift.publish'),('shift.cancel'),('leave.read_branch'),('leave.review_branch'),('leave.cancel')) p(code) ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) SELECT 'SALON_OWNER',code FROM permissions WHERE code IN ('resource.read','resource.create','resource.update','resource.archive','staff.read','shift.read','leave.read_own','leave.create_own') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) VALUES ('RECEPTIONIST','service_category.read'),('RECEPTIONIST','service.read'),('RECEPTIONIST','service_price.read'),('RECEPTIONIST','skill.read'),('RECEPTIONIST','resource.read'),('RECEPTIONIST','staff.read'),('RECEPTIONIST','shift.read'),('NAIL_TECHNICIAN','service_category.read'),('NAIL_TECHNICIAN','service.read'),('NAIL_TECHNICIAN','service_price.read'),('NAIL_TECHNICIAN','staff.read'),('NAIL_TECHNICIAN','shift.read'),('NAIL_TECHNICIAN','leave.read_own'),('NAIL_TECHNICIAN','leave.create_own'),('NAIL_TECHNICIAN','leave.cancel'),('SALON_OWNER','leave.read_own'),('SALON_OWNER','leave.create_own'),('BRANCH_MANAGER','leave.read_own'),('BRANCH_MANAGER','leave.create_own'),('ACCOUNTANT','service.read'),('ACCOUNTANT','service_price.read'),('MARKETING','service.read'),('MARKETING','service_category.read') ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version) VALUES('0005_service_catalog_staff');
COMMIT;

import pg from "pg";

const connectionString = process.env.DATABASE_URL ?? "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft";
export async function cleanupE2E(prefix: string) {
  const client = new pg.Client({ connectionString }); await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM service_addons WHERE tenant_id=$1 AND (service_id IN (SELECT id FROM services WHERE tenant_id=$1 AND code LIKE $2) OR addon_service_id IN (SELECT id FROM services WHERE tenant_id=$1 AND code LIKE $2))", ["10000000-0000-4000-8000-000000000001", `${prefix}%`]);
    await client.query("DELETE FROM service_prices WHERE tenant_id=$1 AND service_id IN (SELECT id FROM services WHERE tenant_id=$1 AND code LIKE $2)", ["10000000-0000-4000-8000-000000000001", `${prefix}%`]);
    await client.query("DELETE FROM service_skill_requirements WHERE tenant_id=$1 AND service_id IN (SELECT id FROM services WHERE tenant_id=$1 AND code LIKE $2)", ["10000000-0000-4000-8000-000000000001", `${prefix}%`]);
    await client.query("DELETE FROM service_resource_requirements WHERE tenant_id=$1 AND service_id IN (SELECT id FROM services WHERE tenant_id=$1 AND code LIKE $2)", ["10000000-0000-4000-8000-000000000001", `${prefix}%`]);
    await client.query("DELETE FROM services WHERE tenant_id=$1 AND code LIKE $2", ["10000000-0000-4000-8000-000000000001", `${prefix}%`]);
    await client.query("DELETE FROM service_categories WHERE tenant_id=$1 AND code LIKE $2", ["10000000-0000-4000-8000-000000000001", `${prefix}%`]);
    await client.query("DELETE FROM skills WHERE tenant_id=$1 AND code LIKE $2", ["10000000-0000-4000-8000-000000000001", `${prefix}%`]);
    await client.query("DELETE FROM resources WHERE tenant_id=$1 AND code LIKE $2", ["10000000-0000-4000-8000-000000000001", `${prefix}%`]);
    await client.query("DELETE FROM resource_types WHERE tenant_id=$1 AND code LIKE $2", ["10000000-0000-4000-8000-000000000001", `${prefix}%`]);
    await client.query("DELETE FROM shifts WHERE tenant_id=$1 AND source='IMPORT' AND id IN (SELECT id FROM shifts WHERE tenant_id=$1 AND created_by_user_id IN (SELECT id FROM users WHERE email LIKE $2))", ["10000000-0000-4000-8000-000000000001", `${prefix}%`]);
    await client.query("DELETE FROM leave_requests WHERE tenant_id=$1 AND reason LIKE $2", ["10000000-0000-4000-8000-000000000001", `${prefix}%`]);
    await client.query("DELETE FROM staff_branch_assignments WHERE tenant_id=$1 AND staff_id IN (SELECT id FROM staff_profiles WHERE tenant_id=$1 AND employee_code LIKE $2)", ["10000000-0000-4000-8000-000000000001", `${prefix}%`]);
    await client.query("DELETE FROM staff_skills WHERE tenant_id=$1 AND staff_id IN (SELECT id FROM staff_profiles WHERE tenant_id=$1 AND employee_code LIKE $2)", ["10000000-0000-4000-8000-000000000001", `${prefix}%`]);
    await client.query("DELETE FROM staff_profiles WHERE tenant_id=$1 AND employee_code LIKE $2", ["10000000-0000-4000-8000-000000000001", `${prefix}%`]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { await client.end(); }
}

import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft" });
const tenantId = "10000000-0000-4000-8000-000000000001";
const staffId = "47000000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000001";

describe("Sprint 2 hardening invariants", () => {
  beforeAll(async () => client.connect());
  afterAll(async () => client.end());

  it("uses granular leave permissions and denies legacy aliases", async () => {
    const rows = await client.query("SELECT role,permission_code FROM role_permissions WHERE role IN ('SALON_OWNER','BRANCH_MANAGER','RECEPTIONIST','NAIL_TECHNICIAN','ACCOUNTANT','MARKETING') AND permission_code LIKE 'leave.%'");
    const byRole = new Map<string, string[]>();
    for (const row of rows.rows) byRole.set(row.role, [...(byRole.get(row.role) ?? []), row.permission_code]);
    expect(byRole.get("NAIL_TECHNICIAN")).not.toContain("leave.manage");
    expect(byRole.get("NAIL_TECHNICIAN")).toEqual(expect.arrayContaining(["leave.read_own", "leave.create_own"]));
    expect(byRole.get("BRANCH_MANAGER")).toEqual(expect.arrayContaining(["leave.read_branch", "leave.review_branch"]));
    expect((await client.query("SELECT 1 FROM permissions WHERE code='leave.manage'")).rowCount).toBe(0);
  });

  it("keeps the Sprint 2 role matrix explicit", async () => {
    const expected: Record<string, string[]> = {
      SALON_OWNER: ["service.create", "staff.create", "shift.publish", "leave.review_branch"],
      BRANCH_MANAGER: ["service.read", "staff.update", "shift.publish", "leave.review_branch"],
      RECEPTIONIST: ["service.read", "staff.read", "shift.read"],
      NAIL_TECHNICIAN: ["service.read", "staff.read", "shift.read", "leave.create_own"],
      ACCOUNTANT: ["service.read", "service_price.read"],
      MARKETING: ["service.read", "service_category.read"],
    };
    const rows = await client.query("SELECT role,permission_code FROM role_permissions WHERE role = ANY($1::text[])", [Object.keys(expected)]);
    for (const [role, permissions] of Object.entries(expected)) {
      const actual = rows.rows.filter((row) => row.role === role).map((row) => row.permission_code);
      expect(actual).toEqual(expect.arrayContaining(permissions));
    }
    const platform = await client.query("SELECT permission_code FROM role_permissions WHERE role='PLATFORM_SUPER_ADMIN' AND permission_code IN ('service.read','staff.read','shift.read','leave.read_branch')");
    expect(platform.rows).toHaveLength(0);
  });

  it("rejects overlapping staff assignments and published shifts at database level", async () => {
    await client.query("BEGIN");
    try {
      await expect(client.query("INSERT INTO staff_branch_assignments(tenant_id,staff_id,branch_id,is_primary,effective_from) VALUES($1,$2,$3,false,CURRENT_DATE)", [tenantId, staffId, branchId])).rejects.toMatchObject({ code: "23P01", constraint: "staff_branch_assignment_no_overlap" });
    } finally { await client.query("ROLLBACK"); }

    await client.query("BEGIN");
    try {
      await expect(client.query("INSERT INTO shifts(tenant_id,branch_id,staff_id,start_at,end_at,status) VALUES($1,$2,$3,'2026-07-13T09:30:00Z','2026-07-13T10:30:00Z','PUBLISHED')", [tenantId, branchId, staffId])).rejects.toMatchObject({ code: "23P01", constraint: "shifts_published_no_overlap" });
    } finally { await client.query("ROLLBACK"); }
  });

  it("protects tenant foreign keys and versioned entities", async () => {
    const tables = await client.query("SELECT to_regclass('staff_branch_assignments') assignments,to_regclass('shifts') shifts,to_regclass('service_prices') prices");
    expect(tables.rows[0]).toEqual({ assignments: "staff_branch_assignments", shifts: "shifts", prices: "service_prices" });
    const constraints = await client.query("SELECT conname FROM pg_constraint WHERE conname IN ('staff_branch_assignment_no_overlap','staff_primary_assignment_no_overlap','shifts_published_no_overlap','service_prices_active_no_overlap')");
    expect(constraints.rows.map((x) => x.conname)).toEqual(expect.arrayContaining(["staff_branch_assignment_no_overlap", "staff_primary_assignment_no_overlap", "shifts_published_no_overlap", "service_prices_active_no_overlap"]));
  });

  it("allows only one concurrent price and shift publication", async () => {
    const a = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft" });
    const b = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft" });
    await Promise.all([a.connect(), b.connect()]);
    const serviceId = randomUUID();
    const priceIdA = randomUUID();
    const priceIdB = randomUUID();
    const shiftIdA = randomUUID();
    const shiftIdB = randomUUID();
    const tempStaffId = randomUUID();
    const assignmentA = randomUUID();
    const assignmentB = randomUUID();
    try {
      await a.query("INSERT INTO staff_profiles(id,tenant_id,employee_code,display_name,status) VALUES($1,$2,$3,'Concurrent staff','ACTIVE')", [tempStaffId, tenantId, `CON-${tempStaffId.slice(0, 8)}`]);
      const assignments = await Promise.allSettled([
        a.query("INSERT INTO staff_branch_assignments(id,tenant_id,staff_id,branch_id,is_primary,effective_from) VALUES($1,$2,$3,$4,false,'2035-03-01')", [assignmentA, tenantId, tempStaffId, branchId]),
        b.query("INSERT INTO staff_branch_assignments(id,tenant_id,staff_id,branch_id,is_primary,effective_from) VALUES($1,$2,$3,$4,false,'2035-03-01')", [assignmentB, tenantId, tempStaffId, branchId]),
      ]);
      expect(assignments.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(assignments.filter((x) => x.status === "rejected")[0]).toMatchObject({ reason: expect.objectContaining({ code: "23P01" }) });
      await a.query("INSERT INTO services(id,tenant_id,category_id,code,name_json,duration_minutes,base_price_minor,default_duration_min,status) VALUES($1,$2,$3,$4,$5,60,0,60,'DRAFT')", [serviceId, tenantId, "40000000-0000-4000-8000-000000000001", `CONC-${serviceId.slice(0, 8)}`, { "vi-VN": "Concurrency", "en-US": "Concurrency" }]);
      const prices = await Promise.allSettled([
        a.query("INSERT INTO service_prices(id,tenant_id,service_id,amount,currency,effective_from,status) VALUES($1,$2,$3,100,'VND','2035-01-01','ACTIVE')", [priceIdA, tenantId, serviceId]),
        b.query("INSERT INTO service_prices(id,tenant_id,service_id,amount,currency,effective_from,status) VALUES($1,$2,$3,100,'VND','2035-01-01','ACTIVE')", [priceIdB, tenantId, serviceId]),
      ]);
      expect(prices.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(["23P01", "40P01"]).toContain((prices.filter((x) => x.status === "rejected")[0] as PromiseRejectedResult).reason.code);

      await a.query("INSERT INTO shifts(id,tenant_id,branch_id,staff_id,start_at,end_at,status) VALUES($1,$2,$3,$4,'2035-02-01T09:00:00Z','2035-02-01T10:00:00Z','DRAFT'),($5,$2,$3,$4,'2035-02-01T09:00:00Z','2035-02-01T10:00:00Z','DRAFT')", [shiftIdA, tenantId, branchId, staffId, shiftIdB]);
      const shifts = await Promise.allSettled([
        a.query("UPDATE shifts SET status='PUBLISHED' WHERE id=$1", [shiftIdA]),
        b.query("UPDATE shifts SET status='PUBLISHED' WHERE id=$1", [shiftIdB]),
      ]);
      expect(shifts.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(shifts.filter((x) => x.status === "rejected")[0]).toMatchObject({ reason: expect.objectContaining({ code: "23P01" }) });
    } finally {
      await a.query("DELETE FROM service_prices WHERE service_id=$1", [serviceId]);
      await a.query("DELETE FROM services WHERE id=$1", [serviceId]);
      await a.query("DELETE FROM shifts WHERE id IN ($1,$2)", [shiftIdA, shiftIdB]);
      await a.query("DELETE FROM staff_branch_assignments WHERE id IN ($1,$2)", [assignmentA, assignmentB]);
      await a.query("DELETE FROM staff_profiles WHERE id=$1", [tempStaffId]);
      await Promise.all([a.end(), b.end()]);
    }
  });

  it("rejects transitive service add-on cycles", async () => {
    const first = randomUUID();
    const second = randomUUID();
    try {
      await client.query("INSERT INTO services(id,tenant_id,category_id,code,name_json,duration_minutes,base_price_minor,default_duration_min,status) VALUES($1,$2,$3,$4,$5,60,0,60,'DRAFT'),($6,$2,$3,$7,$8,60,0,60,'DRAFT')", [first, tenantId, "40000000-0000-4000-8000-000000000001", `CYCLE-${first.slice(0, 8)}`, { "vi-VN": "Cycle A" }, second, `CYCLE-${second.slice(0, 8)}`, { "vi-VN": "Cycle B" }]);
      await client.query("INSERT INTO service_addons(tenant_id,service_id,addon_service_id) VALUES($1,$2,$3)", [tenantId, first, second]);
      await expect(client.query("INSERT INTO service_addons(tenant_id,service_id,addon_service_id) VALUES($1,$2,$3)", [tenantId, second, first])).rejects.toMatchObject({ code: "23514", constraint: "service_addon_cycle" });
    } finally {
      await client.query("DELETE FROM service_addons WHERE tenant_id=$1 AND (service_id IN ($2,$3) OR addon_service_id IN ($2,$3))", [tenantId, first, second]);
      await client.query("DELETE FROM services WHERE id IN ($1,$2)", [first, second]);
    }
  });
});

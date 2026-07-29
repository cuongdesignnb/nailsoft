import { afterAll, describe, expect, it } from "vitest";
import { pool, tenant } from "./sprint12-closure-helpers";

const db = pool();
describe.sequential("Sprint 12 used policy and rate immutability", () => {
  afterAll(async () => db.end());
  it("rejects mutation and deletion once a version is payroll-referenced", async () => {
    await db.query(
      `INSERT INTO payroll_earning_lines(tenant_id,payroll_worker_id,earning_type,quantity_seconds,rate_minor,amount_minor,currency,pay_rate_version_id)
       VALUES($1,'f1200000-0000-4000-8000-000000000092','REGULAR_HOURS',3600,50000,50000,'VND','f1200000-0000-4000-8000-000000000070')`,
      [tenant],
    );
    await expect(
      db.query(
        "UPDATE workforce_compliance_policy_versions SET policy_json='{}' WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000011'",
        [tenant],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      db.query(
        "UPDATE staff_pay_rate_versions SET amount_minor=1 WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000070'",
        [tenant],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      db.query(
        "DELETE FROM staff_pay_rate_versions WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000070'",
        [tenant],
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });
});

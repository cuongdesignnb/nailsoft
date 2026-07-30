import { expect, test } from "@playwright/test";
import { close, login } from "./helpers/api-client";
import { database, draftRun, post, tenant } from "./helpers/sprint12-closure";
test("direct-paid cash tip is excluded from payroll", async () => {
  const db = database();
  const accountant = await login("accountant@example.test");
  try {
    await db.query(
      `UPDATE staff_pay_profiles SET profile_type='SALARY',status='ACTIVE',currency='VND',effective_from='2026-01-01' WHERE tenant_id=$1 AND staff_id='47000000-0000-4000-8000-000000000008'`,
      [tenant],
    );
    await db.query(
      `INSERT INTO staff_pay_rate_versions(tenant_id,pay_profile_id,component_type,amount_minor,currency,effective_from,version,fingerprint,created_by_user_id) SELECT $1,id,'SALARY_PERIOD_AMOUNT',400000,'VND','2026-01-01',1,'e2e-direct-tip','30000000-0000-4000-8000-000000000001' FROM staff_pay_profiles WHERE tenant_id=$1 AND staff_id='47000000-0000-4000-8000-000000000008'`,
      [tenant],
    );
    await db.query(
      `UPDATE pos_orders SET paid_at='2026-08-05' WHERE tenant_id=$1 AND id='a4000000-0000-4000-8000-000000000004'`,
      [tenant],
    );
    await post(
      accountant,
      "/v1/payroll/tips/a8000000-0000-4000-8000-000000000003/disposition",
      { disposition: "PAID_DIRECT", reason: "Cash handed to technician" },
      "direct-tip-paid",
    );
    await post(
      accountant,
      `/v1/payroll/runs/${draftRun}/calculate`,
      {},
      "direct-tip-calculate",
    );
    expect(
      (
        await db.query(
          `SELECT count(*)::int count FROM payroll_earning_lines l JOIN payroll_run_workers w ON w.tenant_id=l.tenant_id AND w.id=l.payroll_worker_id WHERE w.tenant_id=$1 AND w.payroll_run_id=$2 AND w.staff_id='47000000-0000-4000-8000-000000000008' AND l.earning_type='TIP'`,
          [tenant, draftRun],
        )
      ).rows[0].count,
    ).toBe(0);
  } finally {
    await db.end();
    await close(accountant);
  }
});

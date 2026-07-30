import { expect, test } from "@playwright/test";
import { close, login } from "./helpers/api-client";
import { database, draftRun, post, tenant } from "./helpers/sprint12-closure";
test("hourly staff receives an explicitly payroll-managed settled tip", async () => {
  const db = database();
  const accountant = await login("accountant@example.test");
  try {
    await db.query(
      `UPDATE staff_pay_profiles SET profile_type='HOURLY',status='ACTIVE',currency='VND' WHERE tenant_id=$1 AND staff_id='47000000-0000-4000-8000-000000000008'`,
      [tenant],
    );
    await db.query(
      `UPDATE pos_orders SET paid_at='2026-08-05' WHERE tenant_id=$1 AND id='a4000000-0000-4000-8000-000000000004'`,
      [tenant],
    );
    await post(
      accountant,
      "/v1/payroll/tips/a8000000-0000-4000-8000-000000000003/disposition",
      { disposition: "PAYROLL_PENDING", reason: "Payroll policy" },
      "hourly-tip-pending",
    );
    await post(
      accountant,
      `/v1/payroll/runs/${draftRun}/calculate`,
      {},
      "hourly-tip-calculate",
    );
    const line = (
      await db.query(
        `SELECT l.amount_minor::text FROM payroll_earning_lines l JOIN payroll_run_workers w ON w.tenant_id=l.tenant_id AND w.id=l.payroll_worker_id WHERE w.tenant_id=$1 AND w.payroll_run_id=$2 AND w.staff_id='47000000-0000-4000-8000-000000000008' AND l.earning_type='TIP'`,
        [tenant, draftRun],
      )
    ).rows[0];
    expect(line).toEqual({ amount_minor: "10000" });
  } finally {
    await db.end();
    await close(accountant);
  }
});

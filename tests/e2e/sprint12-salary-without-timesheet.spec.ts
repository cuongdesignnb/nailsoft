import { expect, test } from "@playwright/test";
import { close, login } from "./helpers/api-client";
import { database, draftRun, post, tenant } from "./helpers/sprint12-closure";

test("active salary staff is paid without a timesheet source", async () => {
  const db = database();
  const accountant = await login("accountant@example.test");
  try {
    await db.query(
      `UPDATE staff_pay_profiles SET profile_type='SALARY',status='ACTIVE',currency='VND',effective_from='2026-01-01',effective_to=NULL WHERE tenant_id=$1 AND staff_id='47000000-0000-4000-8000-000000000006'`,
      [tenant],
    );
    await db.query(
      `INSERT INTO staff_pay_rate_versions(tenant_id,pay_profile_id,component_type,amount_minor,currency,effective_from,version,fingerprint,created_by_user_id) SELECT $1,id,'SALARY_PERIOD_AMOUNT',700000,'VND','2026-01-01',1,'e2e-salary-no-sheet','30000000-0000-4000-8000-000000000001' FROM staff_pay_profiles WHERE tenant_id=$1 AND staff_id='47000000-0000-4000-8000-000000000006'`,
      [tenant],
    );
    await post(
      accountant,
      `/v1/payroll/runs/${draftRun}/calculate`,
      {},
      "salary-without-sheet",
    );
    const line = (
      await db.query(
        `SELECT l.amount_minor::text FROM payroll_earning_lines l JOIN payroll_run_workers w ON w.tenant_id=l.tenant_id AND w.id=l.payroll_worker_id WHERE w.tenant_id=$1 AND w.payroll_run_id=$2 AND w.staff_id='47000000-0000-4000-8000-000000000006' AND l.earning_type='SALARY'`,
        [tenant, draftRun],
      )
    ).rows[0];
    expect(line).toEqual({ amount_minor: "700000" });
  } finally {
    await db.end();
    await close(accountant);
  }
});

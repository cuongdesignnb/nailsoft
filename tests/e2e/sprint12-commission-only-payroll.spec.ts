import { expect, test } from "@playwright/test";
import { close, login } from "./helpers/api-client";
import {
  database,
  draftRun,
  get,
  post,
  prepareLockedHourlyTimesheet,
  staff5,
  tenant,
} from "./helpers/sprint12-closure";

test("commission-only profile calculates without a synthetic hourly rate", async () => {
  const accountant = await login("accountant@example.test");
  const db = database();
  try {
    await prepareLockedHourlyTimesheet(db);
    await db.query(
      `UPDATE staff_pay_profiles SET profile_type='COMMISSION_ONLY',status='ACTIVE',currency='VND',effective_from='2026-01-01'
       WHERE tenant_id=$1 AND staff_id=$2`,
      [tenant, staff5],
    );
    const result = await post(
      accountant,
      `/v1/payroll/runs/${draftRun}/calculate`,
      {},
      "s12-e2e-commission-calc",
    );
    expect(result.blockingExceptionCount).toBe(0);
    expect((await get(accountant, `/v1/payroll/runs/${draftRun}`)).state).toBe(
      "CALCULATED",
    );
    expect(
      (
        await db.query(
          `SELECT count(*)::int count FROM payroll_earning_lines l
           JOIN payroll_run_workers w ON w.tenant_id=l.tenant_id AND w.id=l.payroll_worker_id
           WHERE w.tenant_id=$1 AND w.payroll_run_id=$2 AND l.earning_type='REGULAR_HOURS'`,
          [tenant, draftRun],
        )
      ).rows[0].count,
    ).toBe(0);
  } finally {
    await db.end();
    await close(accountant);
  }
});

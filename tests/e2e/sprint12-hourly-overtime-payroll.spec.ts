import { expect, test } from "@playwright/test";
import { close, login } from "./helpers/api-client";
import {
  database,
  draftRun,
  get,
  post,
  prepareLockedHourlyTimesheet,
  tenant,
} from "./helpers/sprint12-closure";

test("hourly payroll calculates regular and rational overtime through APIs", async () => {
  const accountant = await login("accountant@example.test");
  const db = database();
  try {
    await prepareLockedHourlyTimesheet(db, {
      regularSeconds: 28800,
      overtimeSeconds: 3600,
    });
    await db.query(
      `INSERT INTO staff_pay_rate_versions(tenant_id,pay_profile_id,component_type,multiplier_numerator,multiplier_denominator,currency,effective_from,version,fingerprint,created_by_user_id)
       SELECT $1,id,'OVERTIME_MULTIPLIER',3,2,'VND','2026-01-01',2,'e2e-ot-3-2','30000000-0000-4000-8000-000000000001'
       FROM staff_pay_profiles WHERE tenant_id=$1 AND staff_id='47000000-0000-4000-8000-000000000005'`,
      [tenant],
    );
    const result = await post(
      accountant,
      `/v1/payroll/runs/${draftRun}/calculate`,
      {},
      "s12-e2e-hourly-calc",
    );
    expect(result.blockingExceptionCount).toBe(0);
    const run = await get(accountant, `/v1/payroll/runs/${draftRun}`);
    expect(BigInt(run.grossPayMinor)).toBeGreaterThan(0n);
  } finally {
    await db.end();
    await close(accountant);
  }
});

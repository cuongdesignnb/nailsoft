import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiApp,
  batch,
  command,
  login,
  pool,
  tenant,
} from "./sprint12-closure-helpers";

const db = pool();
let app: Awaited<ReturnType<typeof apiApp>>;

describe.sequential("Sprint 12 payroll exception materialization", () => {
  beforeAll(async () => {
    app = await apiApp();
  });
  afterAll(async () => {
    await app.close();
    await db.end();
  });
  it("persists worker diagnostics instead of returning a generic calculation error", async () => {
    await batch(
      db,
      `UPDATE staff_timesheets SET state='LOCKED',regular_seconds=3600,payable_seconds=3600,fingerprint='exception-sheet',
         projection_input_fingerprint='exception-input',projected_at=now(),submitted_fingerprint='exception-sheet',approved_fingerprint='exception-sheet',locked_fingerprint='exception-sheet'
       WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000061';
       DELETE FROM timesheet_day_entries WHERE tenant_id=$1 AND timesheet_id='f1200000-0000-4000-8000-000000000061';
       INSERT INTO timesheet_day_entries(tenant_id,timesheet_id,local_date,branch_id,regular_seconds,payable_seconds,fingerprint)
       VALUES($1,'f1200000-0000-4000-8000-000000000061','2026-08-05','20000000-0000-4000-8000-000000000001',3600,3600,'exception-day');
       UPDATE staff_pay_profiles SET profile_type='HOURLY' WHERE tenant_id=$1 AND staff_id='47000000-0000-4000-8000-000000000005';
       DELETE FROM staff_pay_rate_versions r USING staff_pay_profiles p WHERE r.tenant_id=$1 AND p.tenant_id=r.tenant_id AND p.id=r.pay_profile_id AND p.staff_id='47000000-0000-4000-8000-000000000005'`,
      [tenant],
    );
    const accountant = await login(app, "accountant@example.test");
    const result = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs/f1200000-0000-4000-8000-000000000091/calculate",
      headers: command(accountant, "s12-materialize-missing-rate"),
      payload: {},
    });
    expect(result.statusCode, result.body).toBe(201);
    expect(result.json().data.blockingExceptionCount).toBe(1);
    expect(
      (
        await db.query(
          "SELECT exception_type FROM payroll_exceptions WHERE tenant_id=$1 AND payroll_run_id='f1200000-0000-4000-8000-000000000091'",
          [tenant],
        )
      ).rows[0].exception_type,
    ).toBe("MISSING_PAY_RATE");
  });
});

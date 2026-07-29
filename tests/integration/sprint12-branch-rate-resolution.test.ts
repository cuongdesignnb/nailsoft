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

describe.sequential("Sprint 12 branch rate resolution", () => {
  beforeAll(async () => {
    app = await apiApp();
  });
  afterAll(async () => {
    await app.close();
    await db.end();
  });

  it("splits earning lines by work branch and falls back only to global rate", async () => {
    await batch(
      db,
      `UPDATE staff_timesheets SET state='LOCKED',regular_seconds=28800,payable_seconds=28800,fingerprint='branch-rate-sheet',
         projection_input_fingerprint='branch-rate-input',projected_at=now(),submitted_fingerprint='branch-rate-sheet',approved_fingerprint='branch-rate-sheet',locked_fingerprint='branch-rate-sheet'
       WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000061';
       DELETE FROM timesheet_day_entries WHERE tenant_id=$1 AND timesheet_id='f1200000-0000-4000-8000-000000000061';
       INSERT INTO timesheet_day_entries(tenant_id,timesheet_id,local_date,branch_id,regular_seconds,payable_seconds,fingerprint) VALUES
       ($1,'f1200000-0000-4000-8000-000000000061','2026-08-04','20000000-0000-4000-8000-000000000001',14400,14400,'branch-a'),
       ($1,'f1200000-0000-4000-8000-000000000061','2026-08-05','20000000-0000-4000-8000-000000000002',14400,14400,'branch-b');
       UPDATE staff_pay_profiles SET profile_type='HOURLY' WHERE tenant_id=$1 AND staff_id='47000000-0000-4000-8000-000000000005';
       INSERT INTO staff_pay_rate_versions(tenant_id,pay_profile_id,branch_id,component_type,amount_minor,currency,effective_from,version,fingerprint,created_by_user_id)
       SELECT $1,id,'20000000-0000-4000-8000-000000000001','REGULAR_HOURLY_RATE',60000,'VND','2026-01-01',2,'branch-a-rate','30000000-0000-4000-8000-000000000001'
       FROM staff_pay_profiles WHERE tenant_id=$1 AND staff_id='47000000-0000-4000-8000-000000000005'`,
      [tenant],
    );
    const accountant = await login(app, "accountant@example.test");
    const result = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs/f1200000-0000-4000-8000-000000000091/calculate",
      headers: command(accountant, "s12-branch-rate-calc"),
      payload: {},
    });
    expect(result.statusCode, result.body).toBe(201);
    const lines = (
      await db.query(
        `SELECT l.branch_id,l.rate_minor::text,l.amount_minor::text FROM payroll_earning_lines l
         JOIN payroll_run_workers w ON w.tenant_id=l.tenant_id AND w.id=l.payroll_worker_id
         WHERE w.tenant_id=$1 AND w.payroll_run_id='f1200000-0000-4000-8000-000000000091' AND l.earning_type='REGULAR_HOURS'
         ORDER BY l.branch_id`,
        [tenant],
      )
    ).rows;
    expect(lines).toEqual([
      {
        branch_id: "20000000-0000-4000-8000-000000000001",
        rate_minor: "60000",
        amount_minor: "240000",
      },
      {
        branch_id: "20000000-0000-4000-8000-000000000002",
        rate_minor: "45000",
        amount_minor: "180000",
      },
    ]);
  });
});

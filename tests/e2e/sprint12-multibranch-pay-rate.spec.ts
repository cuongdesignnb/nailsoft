import { expect, test } from "@playwright/test";
import { close, login } from "./helpers/api-client";
import {
  database,
  draftRun,
  post,
  prepareLockedHourlyTimesheet,
  staff5,
  statements,
  tenant,
} from "./helpers/sprint12-closure";

test("multi-branch payroll resolves exact branch rate before global fallback", async () => {
  const accountant = await login("accountant@example.test");
  const db = database();
  try {
    await prepareLockedHourlyTimesheet(db);
    await statements(
      db,
      `DELETE FROM timesheet_day_entries WHERE tenant_id=$1 AND timesheet_id='f1200000-0000-4000-8000-000000000061';
       INSERT INTO timesheet_day_entries(tenant_id,timesheet_id,local_date,branch_id,regular_seconds,payable_seconds,fingerprint) VALUES
       ($1,'f1200000-0000-4000-8000-000000000061','2026-08-04','20000000-0000-4000-8000-000000000001',14400,14400,'e2e-branch-a'),
       ($1,'f1200000-0000-4000-8000-000000000061','2026-08-05','20000000-0000-4000-8000-000000000002',14400,14400,'e2e-branch-b');
       UPDATE staff_timesheets SET regular_seconds=28800,payable_seconds=28800 WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000061';
       INSERT INTO staff_pay_rate_versions(tenant_id,pay_profile_id,branch_id,component_type,amount_minor,currency,effective_from,version,fingerprint,created_by_user_id)
       SELECT $1,id,'20000000-0000-4000-8000-000000000001','REGULAR_HOURLY_RATE',60000,'VND','2026-01-01',2,'e2e-branch-rate','30000000-0000-4000-8000-000000000001'
       FROM staff_pay_profiles WHERE tenant_id=$1 AND staff_id=$2`,
      [tenant, staff5],
    );
    await post(
      accountant,
      `/v1/payroll/runs/${draftRun}/calculate`,
      {},
      "s12-e2e-branch-calc",
    );
    const lines = (
      await db.query(
        `SELECT branch_id,rate_minor::text FROM payroll_earning_lines l
         JOIN payroll_run_workers w ON w.tenant_id=l.tenant_id AND w.id=l.payroll_worker_id
         WHERE w.tenant_id=$1 AND w.payroll_run_id=$2 AND earning_type='REGULAR_HOURS' ORDER BY branch_id`,
        [tenant, draftRun],
      )
    ).rows;
    expect(lines).toEqual([
      {
        branch_id: "20000000-0000-4000-8000-000000000001",
        rate_minor: "60000",
      },
      {
        branch_id: "20000000-0000-4000-8000-000000000002",
        rate_minor: "45000",
      },
    ]);
  } finally {
    await db.end();
    await close(accountant);
  }
});

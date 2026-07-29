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

describe.sequential("Sprint 12 pay profile calculation", () => {
  beforeAll(async () => {
    app = await apiApp();
  });
  afterAll(async () => {
    await app.close();
    await db.end();
  });

  it("calculates regular and rational overtime lines for hourly profile", async () => {
    await batch(
      db,
      `UPDATE staff_timesheets SET state='LOCKED',regular_seconds=28800,overtime_seconds=7200,payable_seconds=36000,
         fingerprint='hourly-overtime-source',projection_input_fingerprint='hourly-overtime-input',projected_at=now(),
         submitted_fingerprint='hourly-overtime-source',approved_fingerprint='hourly-overtime-source',locked_fingerprint='hourly-overtime-source'
       WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000061';
       DELETE FROM timesheet_day_entries WHERE tenant_id=$1 AND timesheet_id='f1200000-0000-4000-8000-000000000061';
       INSERT INTO timesheet_day_entries(tenant_id,timesheet_id,local_date,branch_id,regular_seconds,overtime_seconds,payable_seconds,fingerprint)
       VALUES($1,'f1200000-0000-4000-8000-000000000061','2026-08-05','20000000-0000-4000-8000-000000000001',28800,7200,36000,'hourly-day');
       UPDATE staff_pay_profiles SET profile_type='HOURLY' WHERE tenant_id=$1 AND staff_id='47000000-0000-4000-8000-000000000005';
       INSERT INTO staff_pay_rate_versions(tenant_id,pay_profile_id,component_type,multiplier_numerator,multiplier_denominator,currency,effective_from,version,fingerprint,created_by_user_id)
       SELECT $1,id,'OVERTIME_MULTIPLIER',3,2,'VND','2026-01-01',2,'ot-3-2','30000000-0000-4000-8000-000000000001'
       FROM staff_pay_profiles WHERE tenant_id=$1 AND staff_id='47000000-0000-4000-8000-000000000005'`,
      [tenant],
    );
    const accountant = await login(app, "accountant@example.test");
    const response = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs/f1200000-0000-4000-8000-000000000091/calculate",
      headers: command(accountant, "s12-hourly-ot-calc"),
      payload: {},
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json().data.blockingExceptionCount).toBe(0);
    const lines = (
      await db.query(
        `SELECT earning_type,amount_minor::text,multiplier_numerator::text,multiplier_denominator::text
         FROM payroll_earning_lines l JOIN payroll_run_workers w ON w.tenant_id=l.tenant_id AND w.id=l.payroll_worker_id
         WHERE w.tenant_id=$1 AND w.payroll_run_id='f1200000-0000-4000-8000-000000000091' ORDER BY earning_type`,
        [tenant],
      )
    ).rows;
    expect(lines).toEqual([
      {
        earning_type: "OVERTIME",
        amount_minor: "135000",
        multiplier_numerator: "3",
        multiplier_denominator: "2",
      },
      {
        earning_type: "REGULAR_HOURS",
        amount_minor: "360000",
        multiplier_numerator: "1",
        multiplier_denominator: "1",
      },
    ]);
  });

  it("does not require a fake hourly rate for commission-only profile", async () => {
    await batch(
      db,
      `UPDATE staff_pay_profiles SET profile_type='COMMISSION_ONLY',status='ACTIVE',currency='VND',effective_from='2026-01-01'
       WHERE tenant_id=$1 AND staff_id='47000000-0000-4000-8000-000000000006'`,
      [tenant],
    );
    expect(
      (
        await db.query(
          "SELECT p.profile_type,(SELECT count(*)::int FROM staff_pay_rate_versions r WHERE r.tenant_id=p.tenant_id AND r.pay_profile_id=p.id) rate_count FROM staff_pay_profiles p WHERE p.tenant_id=$1 AND p.staff_id='47000000-0000-4000-8000-000000000006'",
          [tenant],
        )
      ).rows[0],
    ).toEqual({ profile_type: "COMMISSION_ONLY", rate_count: 0 });
  });
});

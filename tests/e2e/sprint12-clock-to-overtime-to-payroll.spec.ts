import { expect, test } from "@playwright/test";
import { close, login } from "./helpers/api-client";
import {
  branch,
  database,
  draftRun,
  post,
  tenant,
} from "./helpers/sprint12-closure";
test("authenticated clock flow produces overtime classification and payroll earning", async () => {
  const db = database();
  const owner = await login("owner@example.test");
  const manager = await login("staff2@example.test");
  const accountant = await login("accountant@example.test");
  const technician = await login("staff5@example.test");
  try {
    await db.query(
      `UPDATE attendance_sessions SET state='VOIDED' WHERE tenant_id=$1 AND staff_id='47000000-0000-4000-8000-000000000005' AND state='OPEN'`,
      [tenant],
    );
    await db.query(
      `DELETE FROM timesheet_day_entries WHERE tenant_id=$1 AND timesheet_id='f1200000-0000-4000-8000-000000000061'`,
      [tenant],
    );
    await db.query(
      `UPDATE staff_timesheets SET state='DRAFT',submitted_fingerprint=NULL,approved_fingerprint=NULL,locked_fingerprint=NULL,source_locked_at=NULL,source_locked_by_payroll_run_id=NULL WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000061'`,
      [tenant],
    );
    await db.query(
      `INSERT INTO workforce_compliance_policy_versions(tenant_id,policy_id,version,effective_from,timezone_basis,daily_overtime_rules_json,weekly_overtime_rules_json,consecutive_day_rules_json,legal_review_status,policy_json,fingerprint,created_by_user_id) VALUES($1,'f1200000-0000-4000-8000-000000000010',2,current_date,'BRANCH','{"thresholdSeconds":1,"multiplierNumerator":3,"multiplierDenominator":2}','{}','{}','APPROVED','{"testOnly":true}','e2e-operational-ot-v2','30000000-0000-4000-8000-000000000001')`,
      [tenant],
    );
    await db.query(
      `UPDATE staff_pay_profiles SET profile_type='HOURLY',status='ACTIVE',currency='VND',effective_from='2026-01-01' WHERE tenant_id=$1 AND staff_id='47000000-0000-4000-8000-000000000005'`,
      [tenant],
    );
    await db.query(
      `INSERT INTO staff_pay_rate_versions(tenant_id,pay_profile_id,component_type,multiplier_numerator,multiplier_denominator,currency,effective_from,version,fingerprint,created_by_user_id) SELECT $1,id,'OVERTIME_MULTIPLIER',3,2,'VND','2026-01-01',2,'e2e-operational-multiplier','30000000-0000-4000-8000-000000000001' FROM staff_pay_profiles WHERE tenant_id=$1 AND staff_id='47000000-0000-4000-8000-000000000005'`,
      [tenant],
    );
    const input = await post(
      owner,
      "/v1/time-clock/clock-in",
      {
        staffId: "47000000-0000-4000-8000-000000000005",
        branchId: branch,
        source: "ADMIN_WEB",
      },
      "e2e-ot-clock-in",
    );
    await new Promise((resolve) => setTimeout(resolve, 2100));
    const output = await post(
      owner,
      "/v1/time-clock/clock-out",
      {
        staffId: "47000000-0000-4000-8000-000000000005",
        branchId: branch,
        source: "ADMIN_WEB",
      },
      "e2e-ot-clock-out",
    );
    expect(output.id).toBe(input.id);
    const sheet = (
      await db.query(
        `SELECT id FROM staff_timesheets WHERE tenant_id=$1 AND staff_id='47000000-0000-4000-8000-000000000005' ORDER BY created_at DESC LIMIT 1`,
        [tenant],
      )
    ).rows[0];
    await post(
      technician,
      `/v1/staff/me/timesheets/${sheet.id}/submit`,
      { reason: "Operational source complete" },
      "e2e-ot-submit",
    );
    await post(
      manager,
      `/v1/timesheets/${sheet.id}/approve`,
      { reason: "Manager review" },
      "e2e-ot-approve",
    );
    await post(
      owner,
      `/v1/timesheets/${sheet.id}/lock`,
      { reason: "Payroll lock" },
      "e2e-ot-lock",
    );
    const calculated = await post(
      accountant,
      `/v1/payroll/runs/${draftRun}/calculate`,
      {},
      "e2e-ot-payroll",
    );
    expect(calculated.blockingExceptionCount).toBe(0);
    const line = (
      await db.query(
        `SELECT quantity_seconds::text FROM payroll_earning_lines l JOIN payroll_run_workers w ON w.tenant_id=l.tenant_id AND w.id=l.payroll_worker_id WHERE w.tenant_id=$1 AND w.payroll_run_id=$2 AND w.staff_id='47000000-0000-4000-8000-000000000005' AND l.earning_type='OVERTIME'`,
        [tenant, draftRun],
      )
    ).rows[0];
    expect(BigInt(line.quantity_seconds)).toBeGreaterThan(0n);
  } finally {
    await db.end();
    await close(owner);
    await close(manager);
    await close(accountant);
    await close(technician);
  }
});

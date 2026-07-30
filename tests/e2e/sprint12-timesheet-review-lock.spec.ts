import { expect, test } from "@playwright/test";
import { close, login } from "./helpers/api-client";
import { database, post, tenant } from "./helpers/sprint12-closure";

test("review approval and lock preserve independent authenticated actors", async () => {
  const manager = await login("staff2@example.test");
  const owner = await login("owner@example.test");
  const db = database();
  try {
    await db.query(
      `UPDATE attendance_sessions SET state='VOIDED' WHERE tenant_id=$1 AND staff_id='47000000-0000-4000-8000-000000000005' AND state='OPEN'`,
      [tenant],
    );
    await db.query(
      `UPDATE attendance_exceptions
       SET state='RESOLVED',resolution_reason='E2E fixture session voided',resolved_at=now(),updated_at=now()
       WHERE tenant_id=$1 AND staff_id='47000000-0000-4000-8000-000000000005'
         AND state IN('OPEN','ACKNOWLEDGED')`,
      [tenant],
    );
    await db.query(
      `INSERT INTO timesheet_day_entries(tenant_id,timesheet_id,local_date,branch_id,regular_seconds,payable_seconds,fingerprint)
       VALUES($1,'f1200000-0000-4000-8000-000000000061','2026-08-05','20000000-0000-4000-8000-000000000001',14400,14400,'seed-timesheet-submitted')`,
      [tenant],
    );
    await db.query(
      `UPDATE staff_timesheets SET projected_at=now(),projection_input_fingerprint='review-input',submitted_fingerprint=fingerprint
       WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000061'`,
      [tenant],
    );
    const approved = await post(
      manager,
      "/v1/timesheets/f1200000-0000-4000-8000-000000000061/approve",
      { reason: "Manager review complete" },
      "s12-e2e-sheet-approve",
    );
    expect(approved.state).toBe("APPROVED");
    const locked = await post(
      owner,
      "/v1/timesheets/f1200000-0000-4000-8000-000000000061/lock",
      { reason: "Owner payroll lock" },
      "s12-e2e-sheet-lock",
    );
    expect(locked.state).toBe("LOCKED");
    expect(locked.lockedFingerprint).toBeTruthy();
  } finally {
    await db.end();
    await close(manager);
    await close(owner);
  }
});

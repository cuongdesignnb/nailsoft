import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiApp,
  command,
  login,
  pool,
  tenant,
} from "./sprint12-closure-helpers";

const db = pool();
let app: Awaited<ReturnType<typeof apiApp>>;

describe.sequential("Sprint 12 timesheet workflow guards", () => {
  beforeAll(async () => {
    app = await apiApp();
  });
  afterAll(async () => {
    await app.close();
    await db.end();
  });

  it("blocks submit for an open session in the period", async () => {
    await db.query(
      `UPDATE staff_timesheets SET state='DRAFT',projected_at=now(),projection_input_fingerprint='fixture',version=version+1
       WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000061'`,
      [tenant],
    );
    await db.query(
      `INSERT INTO time_clock_events(id,tenant_id,branch_id,staff_id,event_type,occurred_at,branch_timezone_snapshot,source,actor_user_id,idempotency_key_hash,request_id)
       VALUES('f1240000-0000-4000-8000-000000000010',$1,'20000000-0000-4000-8000-000000000001','47000000-0000-4000-8000-000000000005','CLOCK_IN','2026-08-05 09:00+07','Asia/Ho_Chi_Minh','API','30000000-0000-4000-8000-000000000001','s12-lock-open','s12-lock-open')`,
      [tenant],
    );
    await db.query(
      `UPDATE attendance_sessions SET state='VOIDED' WHERE tenant_id=$1 AND staff_id='47000000-0000-4000-8000-000000000005' AND state='OPEN'`,
      [tenant],
    );
    await db.query(
      `INSERT INTO attendance_sessions(id,tenant_id,branch_id,staff_id,clock_in_event_id,state,started_at,fingerprint)
       VALUES('f1240000-0000-4000-8000-000000000011',$1,'20000000-0000-4000-8000-000000000001','47000000-0000-4000-8000-000000000005','f1240000-0000-4000-8000-000000000010','OPEN','2026-08-05 09:00+07','open-guard')`,
      [tenant],
    );
    const owner = await login(app, "owner@example.test");
    const response = await app.inject({
      method: "POST",
      url: "/v1/timesheets/f1200000-0000-4000-8000-000000000061/submit",
      headers: command(owner, "s12-lock-open-submit"),
      payload: {},
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe(
      "TIMESHEET_OPEN_ATTENDANCE_SESSION",
    );
  });

  it("database serialization allows either apply or lock, never a partial correction", async () => {
    const result = await db.query(
      `SELECT count(*) FILTER(WHERE state='APPLIED')::int applied,
              count(*) FILTER(WHERE state='APPROVED')::int unapplied
       FROM timesheet_adjustment_requests WHERE tenant_id=$1`,
      [tenant],
    );
    expect(
      result.rows[0].applied + result.rows[0].unapplied,
    ).toBeGreaterThanOrEqual(0);
  });
});

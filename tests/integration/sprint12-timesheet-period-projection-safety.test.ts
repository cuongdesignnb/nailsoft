import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiApp,
  branch,
  command,
  login,
  pool,
  tenant,
} from "./sprint12-closure-helpers";
const db = pool();
let app: Awaited<ReturnType<typeof apiApp>>;
describe("Sprint 12 timesheet period projection safety", () => {
  beforeAll(async () => {
    app = await apiApp();
  });
  afterAll(async () => {
    await app.close();
    await db.end();
  });
  it("rejects overlapping periods and routes late attendance to an exception", async () => {
    await expect(
      db.query(
        `INSERT INTO timesheet_periods(tenant_id,code,starts_on,ends_on,state,timezone) VALUES($1,'OVERLAP-REJECTED','2026-07-30','2026-08-02','OPEN','Asia/Ho_Chi_Minh')`,
        [tenant],
      ),
    ).rejects.toThrow();
    await db.query(
      `UPDATE timesheet_periods
       SET starts_on=CURRENT_DATE-7,ends_on=CURRENT_DATE+7,state='CLOSED'
       WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000051'`,
      [tenant],
    );
    const owner = await login(app, "owner@example.test");
    const staffId = "47000000-0000-4000-8000-000000000006";
    const input = await app.inject({
      method: "POST",
      url: "/v1/time-clock/clock-in",
      headers: command(owner, "late-period-in"),
      payload: { staffId, branchId: branch, source: "ADMIN_WEB" },
    });
    expect(input.statusCode, input.body).toBe(201);
    const output = await app.inject({
      method: "POST",
      url: "/v1/time-clock/clock-out",
      headers: command(owner, "late-period-out"),
      payload: { staffId, branchId: branch, source: "ADMIN_WEB" },
    });
    expect(output.statusCode, output.body).toBe(201);
    const exception = (
      await db.query(
        `SELECT exception_type FROM attendance_exceptions WHERE tenant_id=$1 AND session_id=$2`,
        [tenant, output.json().data.id],
      )
    ).rows[0];
    expect(exception).toEqual({
      exception_type: "LATE_ATTENDANCE_AFTER_PERIOD_CLOSE",
    });
    expect(
      (
        await db.query(
          `SELECT count(*)::int count FROM timesheet_day_entries WHERE tenant_id=$1 AND source_session_ids @> ARRAY[$2::uuid]`,
          [tenant, output.json().data.id],
        )
      ).rows[0].count,
    ).toBe(0);

    await db.query(
      `UPDATE timesheet_periods SET state='LOCKED' WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000051'`,
      [tenant],
    );
    const crossInput = await app.inject({
      method: "POST",
      url: "/v1/time-clock/clock-in",
      headers: command(owner, "cross-period-in"),
      payload: {
        staffId: "47000000-0000-4000-8000-000000000007",
        branchId: branch,
        source: "ADMIN_WEB",
      },
    });
    expect(crossInput.statusCode, crossInput.body).toBe(201);
    await db.query(
      `UPDATE attendance_sessions
       SET started_at=(CURRENT_DATE-14)::date + time '23:59:00'
       WHERE tenant_id=$1 AND id=$2`,
      [tenant, crossInput.json().data.id],
    );
    const crossOutput = await app.inject({
      method: "POST",
      url: "/v1/time-clock/clock-out",
      headers: command(owner, "cross-period-out"),
      payload: {
        staffId: "47000000-0000-4000-8000-000000000007",
        branchId: branch,
        source: "ADMIN_WEB",
      },
    });
    expect(crossOutput.statusCode, crossOutput.body).toBe(201);
    expect(
      (
        await db.query(
          `SELECT exception_type FROM attendance_exceptions WHERE tenant_id=$1 AND session_id=$2`,
          [tenant, crossOutput.json().data.id],
        )
      ).rows[0],
    ).toEqual({ exception_type: "CROSS_PERIOD_ATTENDANCE" });
  });
});

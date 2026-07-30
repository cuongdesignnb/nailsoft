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

describe.sequential("Sprint 12 adjustment apply", () => {
  beforeAll(async () => {
    app = await apiApp();
  });
  afterAll(async () => {
    await app.close();
    await db.end();
  });

  it("moves approved adjustment to APPLIED through immutable correction overlay", async () => {
    const owner = await login(app, "owner@example.test");
    const manager = await login(app, "staff2@example.test");
    const ledgerBefore = (
      await db.query(
        "SELECT count(*)::int n FROM time_clock_events WHERE tenant_id=$1",
        [tenant],
      )
    ).rows[0].n;
    const created = await app.inject({
      method: "POST",
      url: "/v1/timesheets/f1200000-0000-4000-8000-000000000060/adjustments",
      headers: command(owner, "s12-adjust-create"),
      payload: {
        adjustmentType: "CHANGE_PAYABLE_TIME",
        change: {
          sessionId: "f1200000-0000-4000-8000-000000000030",
          payableSeconds: "25200",
          regularSeconds: "25200",
        },
        reason: "Verified missed unpaid time",
      },
    });
    // The fixture is payroll-locked, proving corrections cannot mutate historical payroll.
    expect(created.statusCode).toBe(409);

    await db.query(
      `INSERT INTO staff_timesheets(id,tenant_id,period_id,staff_id,state,fingerprint,projected_at,projection_input_fingerprint)
       VALUES('f1240000-0000-4000-8000-000000000002',$1,'f1200000-0000-4000-8000-000000000051','47000000-0000-4000-8000-000000000003','DRAFT','before',now(),'input')`,
      [tenant],
    );
    const request = await app.inject({
      method: "POST",
      url: "/v1/timesheets/f1240000-0000-4000-8000-000000000002/adjustments",
      headers: command(owner, "s12-adjust-create-open"),
      payload: {
        adjustmentType: "CHANGE_PAYABLE_TIME",
        change: {
          sessionId: "f1200000-0000-4000-8000-000000000030",
          payableSeconds: "25200",
          regularSeconds: "25200",
        },
        reason: "Verified correction",
      },
    });
    expect(request.statusCode, request.body).toBe(201);
    const adjustmentId = request.json().data.id;
    for (const [path, auth, key] of [
      ["submit", owner, "s12-adjust-submit"],
      ["approve", manager, "s12-adjust-approve"],
      ["apply", manager, "s12-adjust-apply"],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: `/v1/timesheet-adjustments/${adjustmentId}/${path}`,
        headers: command(auth, key),
        payload: { reason: "Closure evidence" },
      });
      expect(response.statusCode, response.body).toBe(201);
    }
    const evidence = (
      await db.query(
        `SELECT r.state,r.before_fingerprint,r.after_fingerprint,count(e.id)::int correction_count
         FROM timesheet_adjustment_requests r JOIN attendance_correction_events e
           ON e.tenant_id=r.tenant_id AND e.adjustment_id=r.id
         WHERE r.tenant_id=$1 AND r.id=$2 GROUP BY r.id`,
        [tenant, adjustmentId],
      )
    ).rows[0];
    expect(evidence.state).toBe("APPLIED");
    expect(evidence.before_fingerprint).not.toBe(evidence.after_fingerprint);
    expect(evidence.correction_count).toBe(1);
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM time_clock_events WHERE tenant_id=$1",
          [tenant],
        )
      ).rows[0].n,
    ).toBe(ledgerBefore);
    await expect(
      db.query(
        "UPDATE attendance_correction_events SET correction_json='{}' WHERE tenant_id=$1",
        [tenant],
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });
});

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

describe.sequential("Sprint 12 attendance to timesheet projection", () => {
  beforeAll(async () => {
    app = await apiApp();
  });
  afterAll(async () => {
    await app.close();
    await db.end();
  });

  it("projects clock-out atomically and replays without duplicate day entries", async () => {
    const owner = await login(app, "owner@example.test");
    const staffId = "47000000-0000-4000-8000-000000000006";
    const clockIn = await app.inject({
      method: "POST",
      url: "/v1/time-clock/clock-in",
      headers: command(owner, "s12-close-projection-in"),
      payload: { staffId, branchId: branch, source: "ADMIN_WEB" },
    });
    expect(clockIn.statusCode, clockIn.body).toBe(201);
    await db.query(
      `UPDATE attendance_sessions s
       SET started_at=(date_trunc('day', now() AT TIME ZONE b.timezone) AT TIME ZONE b.timezone)
       FROM branches b
       WHERE s.tenant_id=$1 AND s.id=$2
         AND b.tenant_id=s.tenant_id AND b.id=s.branch_id`,
      [tenant, clockIn.json().data.id],
    );
    const headers = command(owner, "s12-close-projection-out");
    const clockOut = await app.inject({
      method: "POST",
      url: "/v1/time-clock/clock-out",
      headers,
      payload: { staffId, branchId: branch, source: "ADMIN_WEB" },
    });
    expect(clockOut.statusCode, clockOut.body).toBe(201);
    const replay = await app.inject({
      method: "POST",
      url: "/v1/time-clock/clock-out",
      headers,
      payload: { staffId, branchId: branch, source: "ADMIN_WEB" },
    });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json().data.idempotencyReplayed).toBe(true);

    const evidence = (
      await db.query(
        `SELECT t.id,t.projected_at,t.projection_input_fingerprint,
                count(d.id)::int day_count,count(DISTINCT unnest_id)::int source_count
         FROM staff_timesheets t JOIN timesheet_day_entries d ON d.tenant_id=t.tenant_id AND d.timesheet_id=t.id
         CROSS JOIN LATERAL unnest(d.source_session_ids) unnest_id
         WHERE t.tenant_id=$1 AND t.staff_id=$2 AND d.source_session_ids @> ARRAY[$3::uuid]
         GROUP BY t.id`,
        [tenant, staffId, clockOut.json().data.id],
      )
    ).rows[0];
    expect(evidence.projected_at).toBeTruthy();
    expect(evidence.projection_input_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.day_count).toBe(1);
    expect(evidence.source_count).toBe(1);
  });
});

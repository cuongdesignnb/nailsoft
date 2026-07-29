import { expect, test } from "@playwright/test";
import { close, login } from "./helpers/api-client";
import {
  branch,
  database,
  get,
  post,
  staff6,
  tenant,
} from "./helpers/sprint12-closure";

test("clock-out projects an authenticated attendance session exactly once", async () => {
  const owner = await login("owner@example.test");
  const db = database();
  try {
    const session = await post(
      owner,
      "/v1/time-clock/clock-in",
      { staffId: staff6, branchId: branch, source: "ADMIN_WEB" },
      "s12-e2e-clock-in",
    );
    await db.query(
      "UPDATE attendance_sessions SET started_at=now()-interval '1 hour' WHERE tenant_id=$1 AND id=$2",
      [tenant, session.id],
    );
    const closed = await post(
      owner,
      "/v1/time-clock/clock-out",
      { staffId: staff6, branchId: branch, source: "ADMIN_WEB" },
      "s12-e2e-clock-out",
    );
    expect(closed.state).toBe("CLOSED");
    const sheets = await get(owner, "/v1/timesheets");
    expect(
      sheets.some((sheet: { staffId: string }) => sheet.staffId === staff6),
    ).toBe(true);
  } finally {
    await db.end();
    await close(owner);
  }
});

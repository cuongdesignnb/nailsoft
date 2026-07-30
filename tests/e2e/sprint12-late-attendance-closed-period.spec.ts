import { expect, test } from "@playwright/test";
import { close, login } from "./helpers/api-client";
import { branch, database, post, tenant } from "./helpers/sprint12-closure";
test("late attendance after period closure creates workflow exception without mutating timesheet", async () => {
  const db = database();
  const owner = await login("owner@example.test");
  try {
    await db.query(
      `UPDATE timesheet_periods SET state='CLOSED' WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000051'`,
      [tenant],
    );
    await post(
      owner,
      "/v1/time-clock/clock-in",
      {
        staffId: "47000000-0000-4000-8000-000000000006",
        branchId: branch,
        source: "ADMIN_WEB",
      },
      "late-closed-in",
    );
    const output = await post(
      owner,
      "/v1/time-clock/clock-out",
      {
        staffId: "47000000-0000-4000-8000-000000000006",
        branchId: branch,
        source: "ADMIN_WEB",
      },
      "late-closed-out",
    );
    const exception = (
      await db.query(
        `SELECT exception_type FROM attendance_exceptions WHERE tenant_id=$1 AND session_id=$2`,
        [tenant, output.id],
      )
    ).rows[0];
    expect(exception).toEqual({
      exception_type: "LATE_ATTENDANCE_AFTER_PERIOD_CLOSE",
    });
    expect(
      (
        await db.query(
          `SELECT count(*)::int count FROM timesheet_day_entries WHERE tenant_id=$1 AND source_session_ids @> ARRAY[$2::uuid]`,
          [tenant, output.id],
        )
      ).rows[0].count,
    ).toBe(0);
  } finally {
    await db.end();
    await close(owner);
  }
});

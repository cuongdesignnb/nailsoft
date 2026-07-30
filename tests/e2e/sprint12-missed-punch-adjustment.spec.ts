import { expect, test } from "@playwright/test";
import { close, login } from "./helpers/api-client";
import {
  database,
  post,
  staff3,
  statements,
  tenant,
} from "./helpers/sprint12-closure";

test("approved missed-punch adjustment applies as an immutable overlay", async () => {
  const owner = await login("owner@example.test");
  const manager = await login("staff2@example.test");
  const db = database();
  try {
    await statements(
      db,
      `INSERT INTO staff_timesheets(id,tenant_id,period_id,staff_id,state,fingerprint,projected_at,projection_input_fingerprint)
       VALUES('f1250000-0000-4000-8000-000000000002',$1,'f1200000-0000-4000-8000-000000000051',$2,'DRAFT','before',now(),'input')`,
      [tenant, staff3],
    );
    const adjustment = await post(
      owner,
      "/v1/timesheets/f1250000-0000-4000-8000-000000000002/adjustments",
      {
        adjustmentType: "CHANGE_PAYABLE_TIME",
        change: {
          sessionId: "f1200000-0000-4000-8000-000000000030",
          payableSeconds: "25200",
          regularSeconds: "25200",
        },
        reason: "Authenticated missed-punch correction",
      },
      "s12-e2e-adjust-create",
    );
    await post(
      owner,
      `/v1/timesheet-adjustments/${adjustment.id}/submit`,
      {},
      "s12-e2e-adjust-submit",
    );
    await post(
      manager,
      `/v1/timesheet-adjustments/${adjustment.id}/approve`,
      { reason: "Evidence reviewed" },
      "s12-e2e-adjust-approve",
    );
    const applied = await post(
      manager,
      `/v1/timesheet-adjustments/${adjustment.id}/apply`,
      { reason: "Apply approved overlay" },
      "s12-e2e-adjust-apply",
    );
    expect(applied.state).toBe("APPLIED");
    expect(applied.beforeFingerprint).not.toBe(applied.afterFingerprint);
  } finally {
    await db.end();
    await close(owner);
    await close(manager);
  }
});

import { expect, test } from "@playwright/test";
import { close, login } from "./helpers/api-client";
import {
  database,
  draftRun,
  post,
  prepareLockedHourlyTimesheet,
} from "./helpers/sprint12-closure";

test("finalization consumes each source once under independent approval", async () => {
  const db = database();
  await db.query(
    `INSERT INTO membership_roles(membership_id,role)
     VALUES('90000000-0000-4000-8000-000000000002','SALON_OWNER') ON CONFLICT DO NOTHING`,
  );
  const accountant = await login("accountant@example.test");
  const manager = await login("staff2@example.test");
  const owner = await login("owner@example.test");
  try {
    await prepareLockedHourlyTimesheet(db);
    await post(
      accountant,
      `/v1/payroll/runs/${draftRun}/calculate`,
      {},
      "s12-e2e-final-calc",
    );
    await post(
      accountant,
      `/v1/payroll/runs/${draftRun}/submit`,
      { reason: "Calculation reviewed" },
      "s12-e2e-final-submit",
    );
    await post(
      manager,
      `/v1/payroll/runs/${draftRun}/approve`,
      { reason: "Independent manager approval" },
      "s12-e2e-final-approve",
    );
    const finalized = await post(
      owner,
      `/v1/payroll/runs/${draftRun}/finalize`,
      { reason: "Immutable close" },
      "s12-e2e-finalize",
    );
    expect(finalized.state).toBe("FINALIZED");
    const allocation = (
      await db.query(
        "SELECT count(*)::int count,count(DISTINCT source_id)::int sources,bool_and(state='CONSUMED') consumed FROM payroll_source_allocations WHERE tenant_id=$1 AND payroll_run_id=$2",
        [finalized.tenantId, draftRun],
      )
    ).rows[0];
    expect(allocation.count).toBe(allocation.sources);
    expect(allocation.consumed).toBe(true);
  } finally {
    await db.end();
    await close(accountant);
    await close(manager);
    await close(owner);
  }
});

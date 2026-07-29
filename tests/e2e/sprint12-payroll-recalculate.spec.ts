import { expect, test } from "@playwright/test";
import { close, login } from "./helpers/api-client";
import {
  database,
  draftRun,
  get,
  post,
  prepareLockedHourlyTimesheet,
} from "./helpers/sprint12-closure";

test("recalculation replaces FK children and increments generation", async () => {
  const accountant = await login("accountant@example.test");
  const db = database();
  try {
    await prepareLockedHourlyTimesheet(db);
    await post(
      accountant,
      `/v1/payroll/runs/${draftRun}/calculate`,
      {},
      "s12-e2e-calc-first",
    );
    await post(
      accountant,
      `/v1/payroll/runs/${draftRun}/recalculate`,
      {},
      "s12-e2e-calc-second",
    );
    const run = await get(accountant, `/v1/payroll/runs/${draftRun}`);
    expect(run.calculationGeneration).toBe(2);
    expect(run.workerCount).toBe(1);
  } finally {
    await db.end();
    await close(accountant);
  }
});

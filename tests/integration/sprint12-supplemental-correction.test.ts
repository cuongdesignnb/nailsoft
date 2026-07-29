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

describe.sequential("Sprint 12 supplemental correction payroll", () => {
  beforeAll(async () => {
    app = await apiApp();
  });
  afterAll(async () => {
    await app.close();
    await db.end();
  });
  it("claims an approved delta without mutating the original statement", async () => {
    const accountant = await login(app, "accountant@example.test");
    const owner = await login(app, "owner@example.test");
    const original = (
      await db.query(
        "SELECT statement_json,net_pay_minor::text FROM pay_statements WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000094'",
        [tenant],
      )
    ).rows[0];
    const created = await app.inject({
      method: "POST",
      url: "/v1/payroll/corrections",
      headers: command(accountant, "s12-correction-create"),
      payload: {
        originalPayrollRunId: "f1200000-0000-4000-8000-000000000090",
        originalStatementId: "f1200000-0000-4000-8000-000000000094",
        deltaMinor: "25000",
        currency: "VND",
        reason: "Approved retro earning",
        evidence: { caseReference: "QA-RETRO-1" },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const correctionId = created.json().data.id;
    for (const [path, actor, key] of [
      ["submit", accountant, "s12-correction-submit"],
      ["approve", owner, "s12-correction-approve"],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: `/v1/payroll/corrections/${correctionId}/${path}`,
        headers: command(actor, key),
        payload: {},
      });
      expect(response.statusCode, response.body).toBe(201);
    }
    const run = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs",
      headers: command(accountant, "s12-supplemental-run"),
      payload: {
        payrollPeriodId: "f1200000-0000-4000-8000-000000000082",
        runType: "SUPPLEMENTAL",
        correctionOfPayrollRunId: "f1200000-0000-4000-8000-000000000090",
      },
    });
    expect(run.statusCode, run.body).toBe(201);
    const calculated = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${run.json().data.id}/calculate`,
      headers: command(accountant, "s12-supplemental-calc"),
      payload: {},
    });
    expect(calculated.statusCode, calculated.body).toBe(201);
    expect(calculated.json().data.netPayMinor).toBe("25000");
    const source = (
      await db.query(
        "SELECT state,claimed_by_payroll_run_id FROM payroll_correction_sources WHERE tenant_id=$1 AND id=$2",
        [tenant, correctionId],
      )
    ).rows[0];
    expect(source).toEqual({
      state: "CLAIMED",
      claimed_by_payroll_run_id: run.json().data.id,
    });
    expect(
      (
        await db.query(
          "SELECT statement_json,net_pay_minor::text FROM pay_statements WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000094'",
          [tenant],
        )
      ).rows[0],
    ).toEqual(original);
  });
});

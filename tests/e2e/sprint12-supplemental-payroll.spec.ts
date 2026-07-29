import { expect, test } from "@playwright/test";
import { close, login } from "./helpers/api-client";
import { database, post, tenant } from "./helpers/sprint12-closure";

test("approved retro correction becomes a finalized supplemental payroll", async () => {
  const db = database();
  await db.query(
    `INSERT INTO membership_roles(membership_id,role)
     VALUES('90000000-0000-4000-8000-000000000002','SALON_OWNER') ON CONFLICT DO NOTHING`,
  );
  const accountant = await login("accountant@example.test");
  const manager = await login("staff2@example.test");
  const owner = await login("owner@example.test");
  try {
    const correction = await post(
      accountant,
      "/v1/payroll/corrections",
      {
        originalPayrollRunId: "f1200000-0000-4000-8000-000000000090",
        originalStatementId: "f1200000-0000-4000-8000-000000000094",
        deltaMinor: "25000",
        currency: "VND",
        reason: "Authenticated retro earning",
        evidence: { caseReference: "E2E-RETRO-1" },
      },
      "s12-e2e-retro-create",
    );
    await post(
      accountant,
      `/v1/payroll/corrections/${correction.id}/submit`,
      {},
      "s12-e2e-retro-submit",
    );
    await post(
      owner,
      `/v1/payroll/corrections/${correction.id}/approve`,
      { reason: "Retro evidence accepted" },
      "s12-e2e-retro-approve",
    );
    const run = await post(
      accountant,
      "/v1/payroll/runs",
      {
        payrollPeriodId: "f1200000-0000-4000-8000-000000000082",
        runType: "SUPPLEMENTAL",
        correctionOfPayrollRunId: "f1200000-0000-4000-8000-000000000090",
      },
      "s12-e2e-supp-run",
    );
    const calculated = await post(
      accountant,
      `/v1/payroll/runs/${run.id}/calculate`,
      {},
      "s12-e2e-supp-calc",
    );
    expect(calculated.netPayMinor).toBe("25000");
    await post(
      accountant,
      `/v1/payroll/runs/${run.id}/submit`,
      { reason: "Supplemental reviewed" },
      "s12-e2e-supp-submit",
    );
    await post(
      manager,
      `/v1/payroll/runs/${run.id}/approve`,
      { reason: "Independent approval" },
      "s12-e2e-supp-approve",
    );
    const finalized = await post(
      owner,
      `/v1/payroll/runs/${run.id}/finalize`,
      { reason: "Finalize retro correction" },
      "s12-e2e-supp-finalize",
    );
    expect(finalized.state).toBe("FINALIZED");
    expect(
      (
        await db.query(
          "SELECT state FROM payroll_correction_sources WHERE tenant_id=$1 AND id=$2",
          [tenant, correction.id],
        )
      ).rows[0].state,
    ).toBe("CONSUMED");
  } finally {
    await db.end();
    await close(accountant);
    await close(manager);
    await close(owner);
  }
});

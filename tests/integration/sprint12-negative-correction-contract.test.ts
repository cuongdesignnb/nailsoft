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
describe("Sprint 12 positive-only supplemental correction contract", () => {
  beforeAll(async () => {
    app = await apiApp();
  });
  afterAll(async () => {
    await app.close();
    await db.end();
  });
  it("rejects a negative correction at API ingress and database boundary", async () => {
    const accountant = await login(app, "accountant@example.test");
    const response = await app.inject({
      method: "POST",
      url: "/v1/payroll/corrections",
      headers: command(accountant, "negative-correction-early"),
      payload: {
        originalPayrollRunId: "f1200000-0000-4000-8000-000000000090",
        originalStatementId: "f1200000-0000-4000-8000-000000000094",
        deltaMinor: "-1",
        currency: "VND",
        reason: "Invalid recovery",
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe(
      "PAYROLL_CORRECTION_POSITIVE_DELTA_REQUIRED",
    );
    await expect(
      db.query(
        `INSERT INTO payroll_correction_sources(tenant_id,original_payroll_run_id,original_statement_id,staff_id,delta_minor,currency,reason,fingerprint,requested_by_user_id) VALUES($1,'f1200000-0000-4000-8000-000000000090','f1200000-0000-4000-8000-000000000094','47000000-0000-4000-8000-000000000003',-1,'VND','invalid','invalid','30000000-0000-4000-8000-000000000004')`,
        [tenant],
      ),
    ).rejects.toThrow();
  });
});

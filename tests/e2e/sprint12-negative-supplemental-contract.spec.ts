import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";
test("negative supplemental correction is rejected before persistence", async () => {
  const accountant = await login("accountant@example.test");
  try {
    const response = await accountant.api.post("/v1/payroll/corrections", {
      headers: headers(accountant, "negative-supplemental-e2e"),
      data: {
        originalPayrollRunId: "f1200000-0000-4000-8000-000000000090",
        originalStatementId: "f1200000-0000-4000-8000-000000000094",
        deltaMinor: "-100",
        currency: "VND",
        reason: "Invalid recovery",
      },
    });
    expect(response.status()).toBe(409);
    expect((await response.json()).error.code).toBe(
      "PAYROLL_CORRECTION_POSITIVE_DELTA_REQUIRED",
    );
  } finally {
    await close(accountant);
  }
});

import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";

test("Technician Staff Mobile sees only authoritative own time and payroll data", async () => {
  const technician = await login("staff5@example.test");
  try {
    const status = await technician.api.get("/v1/staff/me/time-clock/status", {
      headers: headers(technician),
    });
    expect(status.status()).toBe(200);
    expect((await status.json()).data.clockedIn).toBe(true);

    const timesheets = await technician.api.get("/v1/staff/me/timesheets", {
      headers: headers(technician),
    });
    expect(timesheets.status()).toBe(200);
    expect(
      (await timesheets.json()).data.every(
        (row: { staffId: string }) =>
          row.staffId === "47000000-0000-4000-8000-000000000005",
      ),
    ).toBe(true);

    const statements = await technician.api.get("/v1/staff/me/pay-statements", {
      headers: headers(technician),
    });
    expect(statements.status()).toBe(200);
  } finally {
    await close(technician);
  }
});

test("Owner can inspect immutable payroll and payout evidence", async () => {
  const owner = await login("owner@example.test");
  try {
    const workers = await owner.api.get(
      "/v1/payroll/runs/f1200000-0000-4000-8000-000000000090/workers",
      { headers: headers(owner) },
    );
    expect(workers.status()).toBe(200);
    expect((await workers.json()).data).toHaveLength(1);

    const payout = await owner.api.get(
      "/v1/payout-items/f1200000-0000-4000-8000-000000000096",
      { headers: headers(owner) },
    );
    expect(payout.status()).toBe(200);
    expect((await payout.json()).data.providerReference).toBe("QA-MANUAL-001");
  } finally {
    await close(owner);
  }
});

test("Accountant cannot approve payroll prepared within accounting scope", async () => {
  const accountant = await login("accountant@example.test");
  try {
    const denied = await accountant.api.post(
      "/v1/payroll/runs/f1200000-0000-4000-8000-000000000091/approve",
      {
        headers: headers(accountant, "s12-e2e-accountant-approve"),
        data: { reason: "Independent approval required" },
      },
    );
    expect(denied.status()).toBe(403);
  } finally {
    await close(accountant);
  }
});

test("Platform Super Admin is denied salon workforce data without a grant", async () => {
  const platform = await login("platform-e2e@example.test");
  try {
    const denied = await platform.api.get("/v1/time-clock/sessions", {
      headers: headers(platform),
    });
    expect(denied.status()).toBe(403);
  } finally {
    await close(platform);
  }
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiApp, login, pool } from "./sprint12-closure-helpers";

const db = pool();
let app: Awaited<ReturnType<typeof apiApp>>;

describe("Sprint 19 Wave 6 accounting read projections", () => {
  beforeAll(async () => {
    app = await apiApp();
  });
  afterAll(async () => {
    await app.close();
    await db.end();
  });

  it("keeps the three read projections tenant scoped and bounded", async () => {
    const owner = await login(app, "owner@example.test");
    const bank = (
      await db.query<{ id: string }>(
        "SELECT id FROM accounting_bank_accounts WHERE tenant_id=$1 ORDER BY id LIMIT 1",
        [owner["x-tenant-id"]],
      )
    ).rows[0];
    if (!bank) return;
    const lines = await app.inject({
      method: "GET",
      url: `/v1/accounting/bank-accounts/${bank.id}/statement-lines?limit=1`,
      headers: owner,
    });
    expect(lines.statusCode, lines.body).toBe(200);
    expect(lines.json().data.length).toBeLessThanOrEqual(1);
    for (const row of lines.json().data) {
      expect(typeof row.amountMinor).toBe("string");
      expect(row).not.toHaveProperty("fileChecksum");
      expect(row).not.toHaveProperty("rawPayload");
    }

    const matches = await app.inject({
      method: "GET",
      url: "/v1/accounting/bank-matches?limit=1",
      headers: owner,
    });
    expect(matches.statusCode, matches.body).toBe(200);
    expect(matches.json().data.length).toBeLessThanOrEqual(1);

    const exceptions = await app.inject({
      method: "GET",
      url: "/v1/accounting/reconciliation-exceptions?limit=1",
      headers: owner,
    });
    expect(exceptions.statusCode, exceptions.body).toBe(200);
    expect(exceptions.json().data).toHaveProperty("adjustmentRequests");
    expect(exceptions.json().data).toHaveProperty("unreconciledReconciliations");
  });
});

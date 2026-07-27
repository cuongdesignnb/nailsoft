import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERIOD, STAFF, TENANT, harness } from "./sprint7-closure-test-utils";

describe.sequential("Sprint 7 adjustment posting", () => {
  let h: Awaited<ReturnType<typeof harness>>;
  let accountant: string;
  let owner: string;
  beforeAll(async () => {
    h = await harness("adjustment");
    accountant = await h.login("accountant@example.test");
    owner = await h.login("owner@example.test");
  });
  afterAll(async () => h?.app.close());

  it("posts exactly one invoice-free entry before approval becomes durable", async () => {
    const created = await h.app.inject({
      method: "POST",
      url: "/v1/commission-adjustments",
      headers: h.headers(accountant),
      payload: {
        staffId: STAFF,
        targetPeriodId: PERIOD,
        amountMinor: 12345,
        currency: "VND",
        reasonCode: "QUALITY_CORRECTION",
        note: "Closure adjustment evidence",
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const adjustment = created.json().data;
    const key = `approve-${crypto.randomUUID()}`;
    const [first, replay] = await Promise.all([
      h.app.inject({
        method: "POST",
        url: `/v1/commission-adjustments/${adjustment.id}/approve`,
        headers: h.headers(owner, key),
        payload: { version: adjustment.version, reason: "Owner approval" },
      }),
      h.app.inject({
        method: "POST",
        url: `/v1/commission-adjustments/${adjustment.id}/approve`,
        headers: h.headers(owner, key),
        payload: { version: adjustment.version, reason: "Owner approval" },
      }),
    ]);
    expect(first.statusCode, first.body).toBe(201);
    expect(replay.statusCode, replay.body).toBe(201);
    const rows = await h.db.query<{
      invoice_id: string | null;
      adjustment_request_id: string;
    }>(
      "SELECT invoice_id,adjustment_request_id FROM commission_entries WHERE tenant_id=$1 AND adjustment_request_id=$2",
      [TENANT, adjustment.id],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toEqual({
      invoice_id: null,
      adjustment_request_id: adjustment.id,
    });
  });
});

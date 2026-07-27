import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BRANCH, harness } from "./sprint7-closure-test-utils";

describe("Sprint 7 commission rule overlap", () => {
  let h: Awaited<ReturnType<typeof harness>>;
  let owner: string;
  beforeAll(async () => {
    h = await harness("rule-overlap");
    owner = await h.login("owner@example.test");
  });
  afterAll(async () => h?.app.close());

  it("rejects concurrent active overlap for normalized scope and priority", async () => {
    const insert = (code: string) =>
      h.app.inject({
        method: "POST",
        url: "/v1/commission-rules",
        headers: h.headers(owner),
        payload: {
          branchId: BRANCH,
          ruleCode: code,
          ruleType: "SERVICE_PERCENT",
          baseMode: "NET_SERVICE_AFTER_DISCOUNT_BEFORE_TAX",
          percentBasisPoints: 1000,
          priority: 777,
          policy: {},
          effectiveFrom: "2026-01-01T00:00:00Z",
          effectiveTo: "2027-01-01T00:00:00Z",
        },
      });
    const responses = await Promise.all([
      insert("CLOSURE-A"),
      insert("CLOSURE-B"),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      201, 409,
    ]);
    const rejected = responses.find((response) => response.statusCode === 409);
    expect(rejected?.json().error.code).toBe("COMMISSION_RULE_OVERLAP");
    const stored = await h.db.query(
      "SELECT id FROM commission_rules WHERE branch_id=$1 AND priority=777 AND status='ACTIVE'",
      [BRANCH],
    );
    expect(stored.rowCount).toBe(1);
  });
});

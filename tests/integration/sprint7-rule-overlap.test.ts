import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BRANCH, TENANT, harness } from "./sprint7-closure-test-utils";

describe("Sprint 7 commission rule overlap", () => {
  let h: Awaited<ReturnType<typeof harness>>;
  beforeAll(async () => {
    h = await harness("rule-overlap");
  });
  afterAll(async () => h?.app.close());

  it("rejects concurrent active overlap for normalized scope and priority", async () => {
    const insert = (id: string, code: string) =>
      h.db.query(
        `INSERT INTO commission_rules(id,tenant_id,branch_id,rule_code,rule_type,base_mode,percent_basis_points,priority,policy_json,effective_from,effective_to,status,created_by_user_id)
         VALUES($1,$2,$3,$4,'SERVICE_PERCENT','NET_SERVICE_AFTER_DISCOUNT_BEFORE_TAX',1000,777,'{}','2026-01-01T00:00:00Z','2027-01-01T00:00:00Z','ACTIVE','30000000-0000-4000-8000-000000000001')`,
        [id, TENANT, BRANCH, code],
      );
    const results = await Promise.allSettled([
      insert("f7500000-0000-4000-8000-000000000001", "CLOSURE-A"),
      insert("f7500000-0000-4000-8000-000000000002", "CLOSURE-B"),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason.code).toBe("23P01");
    expect(rejected?.reason.constraint).toBe(
      "commission_rules_active_scope_no_overlap",
    );
  });
});

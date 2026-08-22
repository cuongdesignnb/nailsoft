import { describe, expect, it } from "vitest";
import { cashSessionDirectoryQuerySchema } from "./index";

describe("cashSessionDirectoryQuerySchema", () => {
  it("coerces pagination and applies safe defaults", () => {
    const result = cashSessionDirectoryQuerySchema.parse({
      page: "2",
      pageSize: "50",
      sort: "VARIANCE_DESC",
    });

    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(50);
    expect(result.reconciliation).toBe("ALL");
  });

  it("rejects unsupported page sizes and reversed business dates", () => {
    expect(cashSessionDirectoryQuerySchema.safeParse({ pageSize: "15" }).success).toBe(false);
    expect(
      cashSessionDirectoryQuerySchema.safeParse({
        businessDateFrom: "2026-08-15",
        businessDateTo: "2026-08-01",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(cashSessionDirectoryQuerySchema.safeParse({ unexpected: "value" }).success).toBe(false);
  });
});

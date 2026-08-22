import { describe, expect, it } from "vitest";
import { posOrderDirectoryQuerySchema } from "./index";

describe("posOrderDirectoryQuerySchema", () => {
  it("normalizes status CSV and pagination query values", () => {
    const result = posOrderDirectoryQuerySchema.parse({
      branchId: "20000000-0000-4000-8000-000000000001",
      status: "PAID, PARTIALLY_PAID",
      page: "2",
      pageSize: "50",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-15",
    });

    expect(result.status).toEqual(["PAID", "PARTIALLY_PAID"]);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(50);
    expect(result.sort).toBe("NEWEST");
  });

  it("rejects unknown keys and an inverted date range", () => {
    expect(posOrderDirectoryQuerySchema.safeParse({ unexpected: "value" }).success).toBe(false);
    expect(posOrderDirectoryQuerySchema.safeParse({ dateFrom: "2026-08-15", dateTo: "2026-08-01" }).success).toBe(false);
  });
});

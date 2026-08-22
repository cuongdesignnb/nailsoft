import { describe, expect, it } from "vitest";
import { paymentDirectoryQuerySchema } from "./index";

describe("paymentDirectoryQuerySchema", () => {
  it("coerces pagination and keeps real payment statuses", () => {
    const result = paymentDirectoryQuerySchema.parse({
      page: "2",
      pageSize: "50",
      tenderType: "CASH",
      status: "CAPTURED",
      refund: "NO_REFUND",
    });

    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(50);
    expect(result.reconciliation).toBe("ALL");
    expect(result.status).toBe("CAPTURED");
    expect(result.refund).toBe("NO_REFUND");
  });

  it("rejects UNKNOWN and reversed dates", () => {
    expect(paymentDirectoryQuerySchema.safeParse({ status: "UNKNOWN" }).success).toBe(false);
    expect(
      paymentDirectoryQuerySchema.safeParse({
        dateFrom: "2026-08-15",
        dateTo: "2026-08-01",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(paymentDirectoryQuerySchema.safeParse({ unexpected: "value" }).success).toBe(false);
  });
});

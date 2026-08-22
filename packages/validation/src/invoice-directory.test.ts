import { describe, expect, it } from "vitest";
import { invoiceDirectoryQuerySchema } from "./index";

describe("invoiceDirectoryQuerySchema", () => {
  it("coerces pagination and applies the newest default", () => {
    const result = invoiceDirectoryQuerySchema.parse({ page: "2", pageSize: "50" });
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(50);
    expect(result.sort).toBe("NEWEST");
  });

  it("rejects unsupported page sizes and reversed issue dates", () => {
    expect(invoiceDirectoryQuerySchema.safeParse({ pageSize: "15" }).success).toBe(false);
    expect(
      invoiceDirectoryQuerySchema.safeParse({
        issuedFrom: "2026-08-15",
        issuedTo: "2026-08-01",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields and preserves business enums", () => {
    expect(invoiceDirectoryQuerySchema.safeParse({ unexpected: "value" }).success).toBe(false);
    expect(
      invoiceDirectoryQuerySchema.parse({
        paymentState: "PARTIAL",
        correction: "CREDIT_NOTE",
        source: "APPOINTMENT_POS",
      }),
    ).toMatchObject({ paymentState: "PARTIAL", correction: "CREDIT_NOTE", source: "APPOINTMENT_POS" });
  });
});

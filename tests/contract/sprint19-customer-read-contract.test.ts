import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  customerDirectoryCursorSchema,
  customerDirectoryQuerySchema,
  customerIdParamSchema,
} from "../../packages/validation/src/index.js";

describe("Sprint 19 Customer 360 read contract", () => {
  it("documents the tenant-scoped directory and detail endpoints", async () => {
    const openapi = await readFile("docs/api/openapi.yaml", "utf8");
    expect(openapi).toContain("/customers:");
    expect(openapi).toContain("/customers/{customerId}:");
    expect(openapi).toContain("Customer360Detail:");
    expect(openapi).toContain("CustomerDirectoryPagination:");
    expect(openapi).toContain("SUPPORT_CUSTOMER_PII_DENIED");
    expect(openapi).toContain("CUSTOMER_NOT_FOUND");
    expect(openapi).toContain("customer.booking_lookup");
  });

  it("accepts only bounded opaque cursor query values", () => {
    expect(
      customerDirectoryQuerySchema.parse({ limit: "2", cursor: "opaque" }),
    ).toEqual({ limit: 2, cursor: "opaque" });
    expect(
      customerDirectoryCursorSchema.parse({
        displayNameSortKey: "khách 1",
        customerId: "60000000-0000-4000-8000-000000000001",
      }),
    ).toBeTruthy();
    expect(() =>
      customerDirectoryQuerySchema.parse({
        limit: 101,
        fields: "phone,email",
      }),
    ).toThrow();
    expect(() =>
      customerDirectoryCursorSchema.parse({
        displayNameSortKey: "khách 1",
        customerId: "not-a-uuid",
      }),
    ).toThrow();
    expect(
      customerIdParamSchema.parse({
        customerId: "60000000-0000-4000-8000-000000000001",
      }).customerId,
    ).toBe("60000000-0000-4000-8000-000000000001");
  });
});

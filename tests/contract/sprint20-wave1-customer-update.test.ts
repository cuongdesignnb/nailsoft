import { describe, expect, it } from "vitest";
import { customerUpdateSchema } from "../../packages/validation/src/index.js";

describe("Sprint 20 Wave 1 customer update schema", () => {
  it("accepts the mutable fields and requires a positive version", () => {
    expect(
      customerUpdateSchema.parse({
        version: 1,
        displayName: "A customer",
        phone: null,
        email: "customer@example.test",
        preferredLocale: "en-US",
      }),
    ).toMatchObject({ version: 1, preferredLocale: "en-US" });
  });

  it("rejects immutable, unknown and empty updates", () => {
    expect(() => customerUpdateSchema.parse({ version: 1, internalNote: "no" })).toThrow();
    expect(() => customerUpdateSchema.parse({ version: 1, tenantId: "00000000-0000-4000-8000-000000000001" })).toThrow();
    expect(() => customerUpdateSchema.parse({ version: 1 })).toThrow();
    expect(() => customerUpdateSchema.parse({ version: 0, displayName: "Invalid" })).toThrow();
  });
});

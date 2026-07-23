import { describe, expect, it } from "vitest";
import { idempotencyKeySchema, publicCreateAppointmentSchema } from "./index";

describe("idempotency key", () => {
  it("rejects short keys", () =>
    expect(idempotencyKeySchema.safeParse("short").success).toBe(false));
});

describe("public appointment validation", () => {
  const valid = {
    holdId: "70000000-0000-4000-8000-000000000001",
    holdToken: "hold-capability",
    contactVerificationToken: "contact-capability",
    customer: {
      displayName: "Khách hàng",
      phone: "0901234567",
      locale: "vi-VN",
    },
    marketingConsent: false,
    acceptedPolicyVersion: 1,
    acceptedAt: "2026-07-23T10:00:00+07:00",
  };

  it("accepts the explicit public contract", () => {
    expect(publicCreateAppointmentSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects customerId, internal notes and unaccepted policy payloads", () => {
    expect(
      publicCreateAppointmentSchema.safeParse({
        ...valid,
        customer: { ...valid.customer, customerId: valid.holdId },
      }).success,
    ).toBe(false);
    expect(
      publicCreateAppointmentSchema.safeParse({
        ...valid,
        internalNote: "must not cross the public boundary",
      }).success,
    ).toBe(false);
    expect(
      publicCreateAppointmentSchema.safeParse({
        ...valid,
        acceptedPolicyVersion: undefined,
      }).success,
    ).toBe(false);
  });
});

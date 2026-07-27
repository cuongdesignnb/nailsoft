import { describe, expect, it } from "vitest";
import {
  idempotencyKeySchema,
  cashSessionOpenSchema,
  posAssignRegisterSchema,
  posPaymentSchema,
  publicCreateAppointmentSchema,
} from "./index";

describe("idempotency key", () => {
  it("rejects short keys", () =>
    expect(idempotencyKeySchema.safeParse("short").success).toBe(false));
});

describe("Sprint 6 payment boundary", () => {
  it("accepts only version and register for assignment", () => {
    const valid = {
      version: 1,
      registerId: "70000000-0000-4000-8000-000000000001",
    };
    expect(posAssignRegisterSchema.safeParse(valid).success).toBe(true);
    expect(
      posAssignRegisterSchema.safeParse({ ...valid, deviceId: "spoofed" })
        .success,
    ).toBe(false);
  });

  it("parses legacy cash-open deviceId only as ignored compatibility input", () => {
    expect(
      cashSessionOpenSchema.safeParse({
        registerId: "70000000-0000-4000-8000-000000000001",
        cashDrawerId: "70000000-0000-4000-8000-000000000002",
        openingFloatMinor: 0,
        deviceId: "not-authoritative",
      }).success,
    ).toBe(true);
  });

  it("accepts the explicit cash contract", () => {
    expect(
      posPaymentSchema.safeParse({
        tenderType: "CASH",
        amountToApplyMinor: 100_000,
        cashReceivedMinor: 200_000,
        cashSessionId: "70000000-0000-4000-8000-000000000001",
        version: 2,
      }).success,
    ).toBe(true);
  });

  it("rejects PAN, CVV and card expiry at every payment boundary", () => {
    for (const secret of [
      { pan: "4111111111111111" },
      { cardNumber: "4111111111111111" },
      { cvv: "123" },
      { expiryMonth: 12, expiryYear: 2030 },
    ]) {
      expect(
        posPaymentSchema.safeParse({
          tenderType: "EXTERNAL_TERMINAL",
          amountMinor: 100_000,
          terminalId: "terminal-1",
          version: 2,
          ...secret,
        }).success,
      ).toBe(false);
    }
  });

  it("rejects browser-provided provider capture state", () => {
    expect(
      posPaymentSchema.safeParse({
        tenderType: "PAYMENT_LINK",
        amountMinor: 100_000,
        provider: "untrusted-browser",
        status: "CAPTURED",
        providerTransactionId: "forged",
        version: 2,
      }).success,
    ).toBe(false);
  });
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

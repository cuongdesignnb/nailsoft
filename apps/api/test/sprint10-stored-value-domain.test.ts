import { describe, expect, it } from "vitest";
import {
  acceptedStoredValue,
  assertGiftCardTransition,
  cardHash,
  cumulativeProportionalRestore,
  generateCardCredentials,
  maskCard,
  pinHash,
  storedValueLiability,
  storedValueRedemptionCap,
  verifyPin,
} from "../src/modules/stored-value/stored-value-domain.js";

describe("Sprint 10 stored-value domain", () => {
  it("caps a reservation by request, available balance, and eligible order due", () => {
    expect(acceptedStoredValue(50_000n, 40_000n, 30_000n)).toBe(30_000n);
    expect(() => acceptedStoredValue(0n, 40_000n, 30_000n)).toThrow(
      "GIFT_CARD_AMOUNT_INVALID",
    );
  });

  it("caps external-first redemption by the current order due", () => {
    expect(
      storedValueRedemptionCap({
        requested: 100n,
        available: 100n,
        remainingEligible: 100n,
        currentOrderDue: 20n,
      }),
    ).toBe(20n);
    expect(
      storedValueRedemptionCap({
        requested: 100n,
        available: 100n,
        remainingEligible: 0n,
        currentOrderDue: 100n,
      }),
    ).toBe(0n);
  });

  it("uses cumulative desired-minus-prior restoration without over-restoring", () => {
    expect(
      cumulativeProportionalRestore({
        originalAllocation: 40n,
        lineNet: 100n,
        cumulativeRefund: 25n,
        previouslyRestored: 0n,
      }),
    ).toBe(10n);
    expect(
      cumulativeProportionalRestore({
        originalAllocation: 40n,
        lineNet: 100n,
        cumulativeRefund: 100n,
        previouslyRestored: 10n,
      }),
    ).toBe(30n);
  });

  it("defines liability as available plus reserved value", () => {
    expect(storedValueLiability(90_000n, 10_000n)).toBe(100_000n);
  });

  it("permits only explicit gift-card state transitions", () => {
    expect(() => assertGiftCardTransition("ACTIVE", "SUSPENDED")).not.toThrow();
    expect(() => assertGiftCardTransition("CANCELLED", "ACTIVE")).toThrow(
      "GIFT_CARD_PRODUCT_STATUS_INVALID",
    );
  });

  it("hashes card identity per tenant and never returns it from masking", () => {
    const hashA = cardHash("tenant-a", "1111 2222 3333 4444", "secret");
    const hashB = cardHash("tenant-b", "1111222233334444", "secret");
    expect(hashA).not.toBe(hashB);
    expect(hashA).toHaveLength(64);
    expect(maskCard("4444")).toBe("**** **** **** 4444");
  });

  it("uses salted PIN hashes and constant-time comparison", () => {
    const encoded = pinHash("123456", "tenant", "card", "pepper");
    expect(verifyPin("123456", encoded, "tenant", "card", "pepper")).toBe(true);
    expect(verifyPin("654321", encoded, "tenant", "card", "pepper")).toBe(
      false,
    );
  });

  it("generates display-once credentials with fixed shapes", () => {
    const credentials = generateCardCredentials();
    expect(credentials.number).toMatch(/^\d{16}$/);
    expect(credentials.pin).toMatch(/^\d{6}$/);
    expect(credentials.last4).toBe(credentials.number.slice(-4));
  });
});

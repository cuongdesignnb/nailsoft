import { describe, expect, it } from "vitest";
import {
  BENEFIT_APPLICATION_ORDER,
  branchLocalExpiry,
  fixedOrPercentDiscount,
  liability,
  loyaltyEarnPoints,
  loyaltyRedemptionMinor,
  loyaltyRedemptionPlan,
  normalizeVoucherCode,
  packageBalance,
  voucherCodeHash,
} from "../src/modules/benefits/benefit-domain.js";

describe("Sprint 8 benefit domain", () => {
  it("uses the mandated application order", () => {
    expect(BENEFIT_APPLICATION_ORDER).toEqual([
      "PACKAGE",
      "MEMBERSHIP",
      "VOUCHER",
      "LOYALTY",
    ]);
  });
  it("calculates capped fixed and percentage vouchers with integer math", () => {
    expect(
      fixedOrPercentDiscount({
        type: "FIXED",
        value: 500n,
        eligibleMinor: 300n,
      }),
    ).toBe(300n);
    expect(
      fixedOrPercentDiscount({
        type: "PERCENT",
        value: 2500n,
        eligibleMinor: 999n,
        maximumMinor: 200n,
      }),
    ).toBe(200n);
  });
  it("uses integer loyalty ratios and liability", () => {
    expect(loyaltyEarnPoints(55_000n, 10_000n)).toBe(5n);
    expect(loyaltyRedemptionMinor(550n, 100n, 10_000n)).toBe(50_000n);
    expect(
      liability({
        availablePoints: 550n,
        redemptionPoints: 100n,
        redemptionMinor: 10_000n,
        packageUnits: 3n,
        packageUnitValueMinor: 20_000n,
      }),
    ).toEqual({ loyaltyMinor: 50_000n, packageMinor: 60_000n });
  });
  it("never lets loyalty cover tip and reserves only accepted points", () => {
    expect(
      loyaltyRedemptionPlan({
        requestedPoints: 500n,
        eligibleDueMinor: 25_000n,
        redemptionPoints: 100n,
        redemptionMinor: 10_000n,
      }),
    ).toEqual({
      requestedPoints: 500n,
      acceptedPoints: 200n,
      appliedMinor: 20_000n,
      unusedPoints: 300n,
    });
    expect(
      loyaltyRedemptionPlan({
        requestedPoints: 500n,
        eligibleDueMinor: 0n,
        redemptionPoints: 100n,
        redemptionMinor: 10_000n,
      }).appliedMinor,
    ).toBe(0n);
  });
  it("keeps package units exact", () => {
    expect(
      packageBalance({ granted: 10, adjustments: 1, reserved: 2, consumed: 4 }),
    ).toBe(5);
  });
  it("normalizes and hashes voucher codes without exposing plain values", () => {
    expect(normalizeVoucherCode(" vip- 2026 ")).toBe("VIP2026");
    expect(voucherCodeHash("VIP-2026", "tenant")).toHaveLength(64);
    expect(voucherCodeHash("vip2026", "tenant")).toBe(
      voucherCodeHash("VIP-2026", "tenant"),
    );
  });
  it("maps local expiry to UTC across DST", () => {
    expect(branchLocalExpiry("2026-11-01", "America/New_York")).toBe(
      "2026-11-02T04:59:59.999Z",
    );
  });
});

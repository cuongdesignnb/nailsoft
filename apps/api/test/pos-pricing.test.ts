import { describe, expect, it } from "vitest";
import {
  PosPricingService,
  allocateProRata,
  roundRatio,
} from "../src/modules/pos/pos-pricing.service";

const service = new PosPricingService();

describe("Sprint 6 minor-unit pricing", () => {
  it("rounds HALF_UP and HALF_EVEN deterministically", () => {
    expect(roundRatio(5n, 2n, "HALF_UP")).toBe(3n);
    expect(roundRatio(5n, 2n, "HALF_EVEN")).toBe(2n);
    expect(roundRatio(7n, 2n, "HALF_EVEN")).toBe(4n);
  });

  it("calculates exclusive and inclusive tax without floating point", () => {
    const result = service.calculate(
      [
        {
          id: "a",
          grossMinor: 10000n,
          lineDiscountMinor: 0n,
          taxMode: "EXCLUSIVE",
          rateBasisPoints: 1000,
          roundingMode: "HALF_UP",
        },
        {
          id: "b",
          grossMinor: 11000n,
          lineDiscountMinor: 0n,
          taxMode: "INCLUSIVE",
          rateBasisPoints: 1000,
          roundingMode: "HALF_UP",
        },
      ],
      0n,
      1500n,
      0n,
    );
    expect(result.taxMinor).toBe(2000n);
    expect(result.totalMinor).toBe(22000n);
    expect(result.amountDueMinor).toBe(23500n);
  });

  it("allocates every remainder minor unit deterministically", () => {
    const allocation = allocateProRata(10n, [
      { id: "staff-b", amount: 1n },
      { id: "staff-a", amount: 1n },
      { id: "staff-c", amount: 1n },
    ]);
    expect([...allocation.values()].reduce((a, b) => a + b, 0n)).toBe(10n);
    expect(allocation.get("staff-a")).toBe(4n);
  });

  it("requires exact manual tip allocation", () => {
    expect(() =>
      service.allocateTip(100n, "MANUAL", [
        { staffId: "a", amountMinor: 60n },
        { staffId: "b", amountMinor: 39n },
      ]),
    ).toThrow();
  });

  it("allocates a tip independently of contribution weight units", () => {
    const allocations = service.allocateTip(100_001n, "EQUAL", [
      { staffId: "staff-b" },
      { staffId: "staff-a" },
    ]);
    expect(
      allocations.reduce((total, row) => total + row.amountMinor, 0n),
    ).toBe(100_001n);
    expect(
      allocations.find((row) => row.staffId === "staff-a")?.amountMinor,
    ).toBe(50_001n);
  });

  it("rejects negative, fractional, unsafe and excessive money changes", () => {
    expect(() => service.assertMoney(-1)).toThrow();
    expect(() => service.assertMoney(1.5)).toThrow();
    expect(() =>
      service.assertMoney(BigInt(Number.MAX_SAFE_INTEGER) + 1n),
    ).toThrow();
    expect(() => service.discountAmount("PERCENT", 10_001, 100_000n)).toThrow();
    expect(() => service.discountAmount("FIXED", 100_001, 100_000n)).toThrow();
  });

  it("derives paid and due amounts from captured minor units", () => {
    const result = service.calculate(
      [
        {
          id: "service",
          grossMinor: 350_000n,
          lineDiscountMinor: 0n,
          taxMode: "NONE",
          rateBasisPoints: 0,
          roundingMode: "HALF_UP",
        },
      ],
      50_000n,
      25_000n,
      200_000n,
    );
    expect(result.grandTotalMinor).toBe(325_000n);
    expect(result.amountDueMinor).toBe(125_000n);
  });
});

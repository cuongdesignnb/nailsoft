import { describe, expect, it } from "vitest";
import {
  calculateCommissionMinor,
  resolveCommissionRule,
} from "../src/modules/finance/commission-domain.js";
import {
  assertRefundTransition,
  canTransitionRefund,
  prorateMinor,
} from "../src/modules/finance/refund-state-machine.js";
import {
  cashRefundExecutionSchema,
  commissionRuleSchema,
  externalRefundExecutionSchema,
  refundCreateSchema,
} from "@nailsoft/validation";

describe("Sprint 7 refund domain", () => {
  it("allows only command state transitions and keeps terminal states terminal", () => {
    expect(canTransitionRefund("DRAFT", "PENDING_APPROVAL")).toBe(true);
    expect(canTransitionRefund("UNKNOWN", "PROCESSING")).toBe(true);
    expect(canTransitionRefund("COMPLETED", "PROCESSING")).toBe(false);
    expect(() => assertRefundTransition("REJECTED", "APPROVED")).toThrow(
      /cannot transition/i,
    );
  });

  it("allocates minor-unit remainder deterministically by remainder then stable key", () => {
    expect(
      prorateMinor(10, [
        { key: "b", amount: 1 },
        { key: "a", amount: 1 },
        { key: "c", amount: 1 },
      ]),
    ).toEqual([
      { key: "b", amount: 3 },
      { key: "a", amount: 4 },
      { key: "c", amount: 3 },
    ]);
    expect(prorateMinor(0, [{ key: "a", amount: 5 }])).toEqual([
      { key: "a", amount: 0 },
    ]);
  });

  it("requires strict refund execution evidence", () => {
    const id = "10000000-0000-4000-8000-000000000001";
    expect(() =>
      refundCreateSchema.parse({
        items: [{ invoiceLineId: id, amountMinor: 100 }],
        reasonCode: "QUALITY",
        reasonText: "valid evidence",
        unexpected: true,
      }),
    ).toThrow();
    expect(() =>
      cashRefundExecutionSchema.parse({
        version: 1,
        cashSessionId: id,
        registerId: id,
      }),
    ).toThrow();
    expect(
      externalRefundExecutionSchema.parse({
        version: 1,
        provider: "manual",
        providerRefundId: "safe-ref",
        processedAt: "2026-07-27T00:00:00Z",
        evidenceNote: "Terminal evidence reviewed",
      }).provider,
    ).toBe("manual");
  });
});

describe("Sprint 7 commission domain", () => {
  const input = { branchId: "b", staffId: "s", serviceId: "v" };
  it("resolves specific rules before priority and uses stable IDs", () => {
    const rule = resolveCommissionRule(
      [
        {
          id: "global",
          priority: 999,
          ruleType: "SERVICE_PERCENT",
          percentBasisPoints: 1000,
        },
        {
          id: "staff",
          staffId: "s",
          priority: 1,
          ruleType: "SERVICE_PERCENT",
          percentBasisPoints: 1200,
        },
        {
          id: "staff-service",
          staffId: "s",
          serviceId: "v",
          priority: 0,
          ruleType: "SERVICE_FIXED",
          fixedMinor: 500,
        },
      ],
      input,
    );
    expect(rule?.id).toBe("staff-service");
  });

  it("calculates percentage and fixed commission in integer minor units", () => {
    expect(
      calculateCommissionMinor(
        {
          id: "p",
          priority: 0,
          ruleType: "SERVICE_PERCENT",
          percentBasisPoints: 1250,
        },
        10_003,
      ),
    ).toBe(1_250);
    expect(
      calculateCommissionMinor(
        { id: "f", priority: 0, ruleType: "SERVICE_FIXED", fixedMinor: 777 },
        10_003,
      ),
    ).toBe(777);
  });

  it("rejects an incomplete rule schema", () => {
    expect(() =>
      commissionRuleSchema.parse({
        ruleCode: "BAD",
        ruleType: "SERVICE_PERCENT",
        baseMode: "NET_SERVICE_AFTER_DISCOUNT_BEFORE_TAX",
        priority: 0,
        policy: {},
        effectiveFrom: "2026-07-27T00:00:00Z",
      }),
    ).toThrow(/percentage rule/i);
  });
});

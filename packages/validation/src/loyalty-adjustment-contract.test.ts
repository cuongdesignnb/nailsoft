import { describe, expect, it } from "vitest";
import {
  customerCreditAdjustmentSchema,
  loyaltyAdjustmentSchema,
} from "./index";

const loyaltyAdjustment = {
  customerId: "60000000-0000-4000-8000-000000000001",
  pointsDelta: 100,
  reasonCode: "SERVICE_RECOVERY",
  note: "Manual recovery points",
};

describe("Sprint 8 loyalty adjustment contract", () => {
  it("accepts the legacy payload without branchId", () => {
    expect(loyaltyAdjustmentSchema.parse(loyaltyAdjustment)).toBeTruthy();
  });

  it.each(["customerId", "pointsDelta", "reasonCode", "note"] as const)(
    "rejects a payload missing %s",
    (field) => {
      const payload: Record<string, unknown> = { ...loyaltyAdjustment };
      delete payload[field];

      expect(loyaltyAdjustmentSchema.safeParse(payload).success).toBe(false);
    },
  );

  it("rejects a zero points delta", () => {
    expect(
      loyaltyAdjustmentSchema.safeParse({
        ...loyaltyAdjustment,
        pointsDelta: 0,
      }).success,
    ).toBe(false);
  });

  it("rejects branchId as an unknown field", () => {
    expect(
      loyaltyAdjustmentSchema.safeParse({
        ...loyaltyAdjustment,
        branchId: "20000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(false);
  });
});

describe("Sprint 10 customer credit adjustment contract", () => {
  const customerCreditAdjustment = {
    branchId: "20000000-0000-4000-8000-000000000001",
    customerId: "60000000-0000-4000-8000-000000000001",
    currency: "VND",
    adjustmentType: "SERVICE_RECOVERY_CREDIT" as const,
    amountMinor: "50000",
    reasonCode: "SERVICE_RECOVERY",
    note: "Manual recovery credit",
  };

  it("keeps branchId required for stored-value adjustments", () => {
    expect(
      customerCreditAdjustmentSchema.safeParse(customerCreditAdjustment)
        .success,
    ).toBe(true);

    const payload: Record<string, unknown> = { ...customerCreditAdjustment };
    delete payload.branchId;

    expect(customerCreditAdjustmentSchema.safeParse(payload).success).toBe(
      false,
    );
  });
});

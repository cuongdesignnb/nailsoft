import { describe, expect, it } from "vitest";
import { assertPurchaseOrderTransition, convertQuantity, formatQuantity, lineTotalMinor, movingAverage, parseQuantity } from "../src/modules/inventory/inventory-domain.js";

describe("Sprint 9 inventory domain", () => {
  it("keeps six-decimal quantities exact", () => {
    expect(formatQuantity(parseQuantity("12.345678"))).toBe("12.345678");
    expect(convertQuantity("2.5", 1000n, 1n)).toBe("2500");
  });
  it("calculates minor totals without floating point", () => {
    expect(lineTotalMinor("1.5", "199")).toBe("299");
  });
  it("computes moving average and resets cleanly outside the projection", () => {
    expect(movingAverage("10", "1000", "10", "200")).toEqual({ quantity: "20", totalCostMinor: "3000", averageUnitCostMinor: "150" });
  });
  it("enforces purchase order transitions", () => {
    expect(() => assertPurchaseOrderTransition("DRAFT", "APPROVED")).toThrow("PURCHASE_ORDER_STATUS_INVALID");
    expect(() => assertPurchaseOrderTransition("DRAFT", "SUBMITTED")).not.toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { procurementLineAmountMinor, procurementQuantityMicro } from "../src/modules/procurement/procurement.service.js";

describe("Sprint 15 procurement money and quantity invariants", () => {
  it("parses decimal quantities without floating point", () => {
    expect(procurementQuantityMicro("1.250000")).toBe(1_250_000n);
    expect(procurementQuantityMicro("0.5")).toBe(500_000n);
    expect(() => procurementQuantityMicro("0")).toThrowError(expect.objectContaining({ response: expect.objectContaining({ code: "PROCUREMENT_QUANTITY_INVALID" }) }));
  });

  it("calculates exact minor amounts from quantity and unit price", () => {
    expect(procurementLineAmountMinor({ quantity: "1.25", unitPriceMinor: "800" })).toBe(1_000n);
    expect(procurementLineAmountMinor({ quantity: "2", unitPriceMinor: "1250" })).toBe(2_500n);
    expect(procurementLineAmountMinor({ amountMinor: "999" })).toBe(999n);
  });

  it("rejects a fractional minor amount instead of rounding silently", () => {
    expect(() => procurementLineAmountMinor({ quantity: "0.333333", unitPriceMinor: "100" })).toThrowError(expect.objectContaining({ response: expect.objectContaining({ code: "PROCUREMENT_AMOUNT_PRECISION_INVALID" }) }));
  });
});

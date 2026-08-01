import { describe, expect, it } from "vitest";
import { createVendorPaymentProvider, FailClosedVendorPaymentProvider, SimulatedVendorPaymentProvider } from "./vendor-payment.provider.js";

describe("Sprint 15 vendor payment provider boundary", () => {
  it("fails closed when no provider is configured", async () => {
    const provider = new FailClosedVendorPaymentProvider();
    await expect(provider.process({ id: "p", tenant_id: "t", amount_minor: "1", currency: "VND", provider_key: "k" })).rejects.toThrow("VENDOR_PAYMENT_PROVIDER_NOT_CONFIGURED");
  });

  it("uses only an explicit simulated adapter", async () => {
    const previous = process.env.VENDOR_PAYMENT_PROVIDER;
    process.env.VENDOR_PAYMENT_PROVIDER = "SIMULATED";
    try {
      expect(createVendorPaymentProvider()).toBeInstanceOf(SimulatedVendorPaymentProvider);
    } finally {
      if (previous === undefined) delete process.env.VENDOR_PAYMENT_PROVIDER;
      else process.env.VENDOR_PAYMENT_PROVIDER = previous;
    }
  });
});

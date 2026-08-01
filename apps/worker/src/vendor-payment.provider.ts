export type VendorPaymentOutcome = { status: "SUCCEEDED" | "FAILED" | "UNKNOWN"; externalReference?: string; evidence?: Record<string, unknown> };

export type VendorPaymentIntent = {
  id: string;
  tenant_id: string;
  amount_minor: string;
  currency: string;
  provider_key: string;
};

/** Production adapters must be supplied explicitly; the default is fail-closed. */
export interface VendorPaymentProvider {
  process(intent: VendorPaymentIntent): Promise<VendorPaymentOutcome>;
}

export class FailClosedVendorPaymentProvider implements VendorPaymentProvider {
  async process(_intent: VendorPaymentIntent): Promise<VendorPaymentOutcome> {
    void _intent;
    throw new Error("VENDOR_PAYMENT_PROVIDER_NOT_CONFIGURED");
  }
}

export class SimulatedVendorPaymentProvider implements VendorPaymentProvider {
  async process(intent: VendorPaymentIntent): Promise<VendorPaymentOutcome> {
    return { status: "SUCCEEDED", externalReference: `simulated:${intent.provider_key}`, evidence: { provider: "SIMULATED" } };
  }
}

export function createVendorPaymentProvider(): VendorPaymentProvider {
  return process.env.VENDOR_PAYMENT_PROVIDER === "SIMULATED" ? new SimulatedVendorPaymentProvider() : new FailClosedVendorPaymentProvider();
}

export interface PaymentProviderCapabilities {
  authorize: boolean;
  capture: boolean;
  cancel: boolean;
  webhook: boolean;
}
export interface ProviderResult {
  status: "AUTHORIZED" | "CAPTURED" | "FAILED" | "CANCELLED";
  providerTransactionId?: string;
  safeMetadata: Record<string, string | number | boolean | null>;
  errorCode?: string;
}
export interface PaymentProvider {
  name: string;
  capabilities(): PaymentProviderCapabilities;
  authorize(input: Record<string, unknown>): Promise<ProviderResult>;
  capture(input: Record<string, unknown>): Promise<ProviderResult>;
  cancel(input: Record<string, unknown>): Promise<ProviderResult>;
  verifyWebhook(input: {
    rawBody: Buffer;
    signature?: string;
    timestamp?: string;
  }): Promise<{ eventId: string; safeMetadata: Record<string, unknown> }>;
}

export class CashProvider implements PaymentProvider {
  name = "cash";
  capabilities = () => ({
    authorize: false,
    capture: true,
    cancel: false,
    webhook: false,
  });
  authorize = async () => ({
    status: "FAILED" as const,
    safeMetadata: {},
    errorCode: "NOT_SUPPORTED",
  });
  capture = async () => ({ status: "CAPTURED" as const, safeMetadata: {} });
  cancel = async () => ({
    status: "FAILED" as const,
    safeMetadata: {},
    errorCode: "NOT_SUPPORTED",
  });
  verifyWebhook = async () => {
    throw new Error("Cash has no webhook");
  };
}

export class ManualExternalProvider implements PaymentProvider {
  name = "manual-external";
  capabilities = () => ({
    authorize: false,
    capture: true,
    cancel: false,
    webhook: false,
  });
  authorize = async () => ({
    status: "FAILED" as const,
    safeMetadata: {},
    errorCode: "NOT_SUPPORTED",
  });
  capture = async (input: Record<string, unknown>) => ({
    status: "CAPTURED" as const,
    providerTransactionId: String(input.providerTransactionId ?? ""),
    safeMetadata: {
      terminalId:
        typeof input.terminalId === "string" ? input.terminalId : null,
      cardBrand: typeof input.cardBrand === "string" ? input.cardBrand : null,
      cardLast4: typeof input.cardLast4 === "string" ? input.cardLast4 : null,
      approvalCode:
        typeof input.approvalCode === "string" ? input.approvalCode : null,
    },
  });
  cancel = async () => ({
    status: "FAILED" as const,
    safeMetadata: {},
    errorCode: "NOT_SUPPORTED",
  });
  verifyWebhook = async () => {
    throw new Error("Manual evidence has no webhook");
  };
}

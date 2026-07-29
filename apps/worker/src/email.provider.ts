import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

export interface EmailDeliveryRequest {
  messageId: string;
  recipient: string;
  subject: string;
  html: string;
  text: string;
}
export interface EmailDeliveryResult {
  providerReference: string;
  status: "SENT";
}

@Injectable()
export class EmailProvider {
  async sendEmail(
    mode: string,
    request: EmailDeliveryRequest,
  ): Promise<EmailDeliveryResult> {
    if (mode === "FAKE")
      return {
        providerReference: `fake:${request.messageId}:${randomUUID()}`,
        status: "SENT",
      };
    if (mode === "PRODUCTION")
      throw Object.assign(new Error("EMAIL_PROVIDER_NOT_CONFIGURED"), {
        code: "EMAIL_PROVIDER_NOT_CONFIGURED",
        retryable: false,
      });
    throw Object.assign(new Error("EMAIL_PROVIDER_DISABLED"), {
      code: "EMAIL_PROVIDER_DISABLED",
      retryable: false,
    });
  }
  async handleProviderEvent() {
    return { accepted: false, code: "PROVIDER_EVENT_ADAPTER_NOT_CONFIGURED" };
  }
  async getDeliveryStatus() {
    return { status: "UNKNOWN" as const };
  }
}

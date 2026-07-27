import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { DatabaseService } from "../../infrastructure/database.service.js";

@Injectable()
export class PaymentWebhookService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async receive(
    provider: string,
    input: {
      rawBody?: Buffer | undefined;
      signature?: string | undefined;
      timestamp?: string | undefined;
      eventId?: string | undefined;
    },
  ) {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (!secret)
      throw new ConflictException({
        code: "PAYMENT_PROVIDER_DISABLED",
        message: "Payment webhook provider is disabled",
      });
    if (
      !input.rawBody ||
      !input.signature ||
      !input.timestamp ||
      !input.eventId
    )
      throw new UnauthorizedException({
        code: "PAYMENT_WEBHOOK_INVALID",
        message: "Signed raw webhook headers are required",
      });
    const epoch = Number(input.timestamp);
    if (!Number.isFinite(epoch) || Math.abs(Date.now() / 1000 - epoch) > 300)
      throw new UnauthorizedException({
        code: "PAYMENT_WEBHOOK_EXPIRED",
        message: "Webhook timestamp is outside tolerance",
      });
    const expected = createHmac("sha256", secret)
      .update(`${input.timestamp}.`)
      .update(input.rawBody)
      .digest("hex");
    const supplied = input.signature.replace(/^sha256=/, "");
    if (
      expected.length !== supplied.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
    )
      throw new UnauthorizedException({
        code: "PAYMENT_WEBHOOK_SIGNATURE_INVALID",
        message: "Webhook signature is invalid",
      });
    const signatureHash = createHmac("sha256", secret)
      .update(input.signature)
      .digest("hex");
    let payload: unknown;
    try {
      payload = JSON.parse(input.rawBody.toString("utf8"));
    } catch {
      throw new UnauthorizedException({
        code: "PAYMENT_WEBHOOK_INVALID",
        message: "Webhook body must be valid JSON",
      });
    }
    const event = refundEvent(payload);
    return this.db.transaction(async (client) => {
      // Provider references are only unique inside a tenant. The signed event
      // must carry that opaque tenant scope; otherwise we deliberately ignore
      // it instead of selecting an arbitrary tenant's allocation.
      const allocation =
        event.providerRefundId && event.tenantId
          ? (
              await client.query<{
                tenant_id: string;
                refund_id: string;
                status: string;
              }>(
                `SELECT a.tenant_id,a.refund_id,a.status FROM refund_payment_allocations a
                 WHERE a.tenant_id=$1 AND a.provider=$2 AND a.provider_refund_id=$3 FOR UPDATE`,
                [event.tenantId, provider, event.providerRefundId],
              )
            ).rows[0]
          : undefined;
      const status = allocation && event.kind ? "PROCESSED" : "IGNORED";
      const result = await client.query(
        `INSERT INTO payment_provider_events(tenant_id,provider,provider_event_id,signature_hash,status,safe_metadata_json)
         VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(provider,provider_event_id) DO NOTHING RETURNING id`,
        [
          allocation?.tenant_id ?? null,
          provider,
          input.eventId,
          signatureHash,
          status,
          JSON.stringify({
            eventType: event.type,
            refundId: allocation?.refund_id ?? null,
            providerRefundReferenceSuffix: event.providerRefundId?.slice(-4),
            result: event.kind,
            reason: allocation
              ? "REFUND_EVENT_RECORDED"
              : "UNKNOWN_REFUND_OPAQUE",
          }),
        ],
      );
      return {
        received: true,
        duplicate: result.rowCount === 0,
        matchedRefund: Boolean(allocation),
      };
    });
  }
}

function refundEvent(payload: unknown) {
  if (!payload || typeof payload !== "object")
    return {
      type: "unknown",
      kind: null,
      providerRefundId: null,
      tenantId: null,
    };
  const value = payload as Record<string, unknown>;
  const data =
    value.data && typeof value.data === "object"
      ? (value.data as Record<string, unknown>)
      : {};
  const type = typeof value.type === "string" ? value.type : "unknown";
  const kind =
    type === "refund.succeeded"
      ? "SUCCESS"
      : type === "refund.failed"
        ? "FAILED"
        : type === "refund.unknown"
          ? "UNKNOWN"
          : null;
  return {
    type,
    kind,
    providerRefundId:
      typeof data.providerRefundId === "string" ? data.providerRefundId : null,
    tenantId: typeof data.tenantId === "string" ? data.tenantId : null,
  };
}

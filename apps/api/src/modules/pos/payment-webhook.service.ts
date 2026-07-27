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
    const result = await this.db.query(
      `INSERT INTO payment_provider_events(provider,provider_event_id,signature_hash,status,safe_metadata_json)
       VALUES($1,$2,$3,'IGNORED',$4) ON CONFLICT(provider,provider_event_id) DO NOTHING RETURNING id`,
      [
        provider,
        input.eventId,
        signatureHash,
        JSON.stringify({
          provider,
          eventId: input.eventId,
          reason: "NO_PRODUCTION_ADAPTER",
        }),
      ],
    );
    return { received: true, duplicate: result.rowCount === 0 };
  }
}

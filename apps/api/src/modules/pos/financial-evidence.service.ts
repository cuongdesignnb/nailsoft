import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { AccessClaims } from "../identity/auth.types.js";

@Injectable()
export class FinancialEvidenceService {
  keyHash(key: string) {
    return createHash("sha256").update(key).digest("hex");
  }

  async record(
    client: PoolClient,
    input: {
      auth: AccessClaims;
      branchId: string;
      event: string;
      aggregateType: string;
      aggregateId: string;
      aggregateVersion: number;
      requestId: string;
      currency: string;
      amountMinor?: bigint | undefined;
      reason?: string | undefined;
      registerId?: string | undefined;
      idempotencyKey?: string | undefined;
      payload?: Record<string, unknown>;
    },
  ) {
    const safePayload = {
      ...(input.payload ?? {}),
      branchId: input.branchId,
      registerId: input.registerId ?? null,
      amountMinor: input.amountMinor?.toString() ?? null,
      currency: input.currency,
      refetch: true,
    };
    await client.query(
      `INSERT INTO audit_logs(
         tenant_id,branch_id,actor_user_id,action,entity_type,entity_id,after_json,reason,device_id,request_id
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        input.auth.tenantId,
        input.branchId,
        input.auth.userId,
        input.event,
        input.aggregateType,
        input.aggregateId,
        JSON.stringify({
          ...safePayload,
          idempotencyKeyHash: input.idempotencyKey
            ? this.keyHash(input.idempotencyKey)
            : null,
        }),
        input.reason ?? null,
        input.registerId ?? null,
        input.requestId,
      ],
    );
    await client.query(
      `INSERT INTO financial_events(
         tenant_id,branch_id,event_type,aggregate_type,aggregate_id,amount_minor,currency,payload_json,actor_user_id,request_id
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        input.auth.tenantId,
        input.branchId,
        input.event,
        input.aggregateType,
        input.aggregateId,
        input.amountMinor?.toString() ?? null,
        input.currency,
        JSON.stringify(safePayload),
        input.auth.userId,
        input.requestId,
      ],
    );
    await client.query(
      `INSERT INTO outbox_events(
         tenant_id,branch_id,event_type,aggregate_type,aggregate_id,aggregate_version,payload_json,actor_json,metadata_json
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        input.auth.tenantId,
        input.branchId,
        input.event,
        input.aggregateType,
        input.aggregateId,
        input.aggregateVersion,
        JSON.stringify(safePayload),
        JSON.stringify({ type: "USER", id: input.auth.userId }),
        JSON.stringify({
          schemaVersion: 1,
          realtimeEvent:
            input.aggregateType === "cash_session"
              ? "cash_session.updated"
              : input.aggregateType === "appointment"
                ? "appointment.updated"
                : "pos.order.updated",
        }),
      ],
    );
  }
}

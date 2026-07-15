import { ConflictException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

@Injectable()
export class BookingIdempotencyService {
  hash(value: unknown) {
    return createHash("sha256").update(stable(value)).digest("hex");
  }
  subject(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  async execute<T>(
    client: PoolClient,
    input: {
      tenantId: string;
      actorScope: string;
      command: string;
      key: string;
      request: unknown;
      work: () => Promise<T>;
    },
  ): Promise<{ data: T; replayed: boolean }> {
    if (!input.key || input.key.length < 16)
      throw new ConflictException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Idempotency-Key is required",
      });
    const requestHash = this.hash(input.request);
    const storedKey = this.subject(
      `${input.actorScope}:${input.command}:${input.key}`,
    );
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `${input.tenantId}:${storedKey}`,
    ]);
    const found = (
      await client.query<{
        request_hash: string;
        state: string;
        response_body_json: T | null;
      }>(
        "SELECT request_hash,state,response_body_json FROM idempotency_keys WHERE tenant_id=$1 AND key=$2 FOR UPDATE",
        [input.tenantId, storedKey],
      )
    ).rows[0];
    if (found) {
      if (found.request_hash !== requestHash)
        throw new ConflictException({
          code: "IDEMPOTENCY_KEY_REUSED",
          message: "Idempotency key was already used for a different request",
        });
      if (found.state === "COMPLETED" && found.response_body_json !== null)
        return { data: found.response_body_json, replayed: true };
    } else {
      await client.query(
        "INSERT INTO idempotency_keys(tenant_id,key,request_hash,state,expires_at,actor_scope,command_type,idempotency_key_hash) VALUES($1,$2,$3,'PROCESSING',now()+interval '24 hours',$4,$5,$6)",
        [
          input.tenantId,
          storedKey,
          requestHash,
          input.actorScope,
          input.command,
          this.subject(input.key),
        ],
      );
    }
    const data = await input.work();
    await client.query(
      "UPDATE idempotency_keys SET state='COMPLETED',response_status=200,response_body_json=$3 WHERE tenant_id=$1 AND key=$2",
      [input.tenantId, storedKey, JSON.stringify(data)],
    );
    return { data, replayed: false };
  }
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
    .join(",")}}`;
}

import { Injectable, OnModuleDestroy } from "@nestjs/common";
import pg from "pg";
import type { OutboxEvent } from "./outbox.types.js";

@Injectable()
export class OutboxRepository implements OnModuleDestroy {
  private readonly pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
    max: Number(process.env.OUTBOX_DB_POOL_SIZE ?? 5),
  });

  async claim(input: {
    workerId: string;
    batchSize: number;
    lockTimeoutSeconds: number;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE outbox_events
         SET delivery_status='PENDING',status='PENDING',available_at=now(),locked_at=NULL,locked_by=NULL,
             last_error='Recovered expired processing lease'
         WHERE delivery_status='PROCESSING'
           AND locked_at < now()-($1::int * interval '1 second')`,
        [input.lockTimeoutSeconds],
      );
      const selected = await client.query<{ id: string }>(
        `SELECT id FROM outbox_events
         WHERE delivery_status='PENDING' AND available_at<=now()
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1`,
        [input.batchSize],
      );
      if (!selected.rowCount) {
        await client.query("COMMIT");
        return [];
      }
      const claimed = await client.query<OutboxEvent>(
        `UPDATE outbox_events
         SET delivery_status='PROCESSING',status='PROCESSING',locked_at=now(),locked_by=$2,
             attempt_count=attempt_count+1,attempts=attempts+1,last_error=NULL
         WHERE id=ANY($1::uuid[])
         RETURNING id,tenant_id,branch_id,event_type,aggregate_type,aggregate_id,
                   payload_json,metadata_json,attempt_count,created_at`,
        [selected.rows.map((row) => row.id), input.workerId],
      );
      await client.query("COMMIT");
      return claimed.rows;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async processed(id: string, workerId: string) {
    await this.pool.query(
      `UPDATE outbox_events
       SET delivery_status='PROCESSED',status='PUBLISHED',processed_at=now(),published_at=now(),
           locked_at=NULL,locked_by=NULL,last_error=NULL
       WHERE id=$1 AND delivery_status='PROCESSING' AND locked_by=$2`,
      [id, workerId],
    );
  }

  async retry(id: string, workerId: string, delaySeconds: number, error: unknown) {
    await this.pool.query(
      `UPDATE outbox_events
       SET delivery_status='PENDING',status='PENDING',available_at=now()+($3::int * interval '1 second'),
           locked_at=NULL,locked_by=NULL,last_error=$4
       WHERE id=$1 AND delivery_status='PROCESSING' AND locked_by=$2`,
      [id, workerId, delaySeconds, safeError(error)],
    );
  }

  async failed(id: string, workerId: string, error: unknown) {
    await this.pool.query(
      `UPDATE outbox_events
       SET delivery_status='FAILED',status='FAILED',failed_at=now(),locked_at=NULL,locked_by=NULL,
           last_error=$3
       WHERE id=$1 AND delivery_status='PROCESSING' AND locked_by=$2`,
      [id, workerId, safeError(error)],
    );
  }

  async manualRetry(id: string) {
    return this.pool.query(
      `UPDATE outbox_events
       SET delivery_status='PENDING',status='PENDING',available_at=now(),failed_at=NULL,
           locked_at=NULL,locked_by=NULL,last_error=NULL
       WHERE id=$1 AND delivery_status='FAILED'`,
      [id],
    );
  }

  async statistics() {
    return (
      await this.pool.query<{
        pending: number;
        processing: number;
        failed: number;
        oldest_pending_age_seconds: number;
      }>(
        `SELECT
           count(*) FILTER (WHERE delivery_status='PENDING')::int pending,
           count(*) FILTER (WHERE delivery_status='PROCESSING')::int processing,
           count(*) FILTER (WHERE delivery_status='FAILED')::int failed,
           coalesce(extract(epoch FROM now()-min(created_at) FILTER (WHERE delivery_status='PENDING')),0)::float8 oldest_pending_age_seconds
         FROM outbox_events`,
      )
    ).rows[0]!;
  }

  query<T extends pg.QueryResultRow>(text: string, values: unknown[] = []) {
    return this.pool.query<T>(text, values);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}

function safeError(error: unknown) {
  const value = error instanceof Error ? error.message : String(error);
  return value.replace(/(?:Bearer|token|cookie)\s+[^\s]+/gi, "[REDACTED]").slice(0, 500);
}

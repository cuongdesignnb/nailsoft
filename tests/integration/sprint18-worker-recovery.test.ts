import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { OutboxRepository } from "../../apps/worker/src/outbox.repository.js";

const tenant = "10000000-0000-4000-8000-000000000001";
let db: pg.Pool;
let repository: OutboxRepository;
let eventId = "";

describe("Sprint 18 durable outbox recovery", () => {
  beforeAll(async () => { db = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft" }); repository = new OutboxRepository(); });
  afterAll(async () => { if (eventId) await db.query("DELETE FROM outbox_events WHERE id=$1", [eventId]); await repository.onModuleDestroy(); await db.end(); });
  it("reclaims an expired lease without losing the authoritative event", async () => {
    const inserted = await db.query<{ id: string }>("INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload_json,metadata_json,delivery_status,status,locked_at,locked_by) VALUES($1,'sprint18.recovery','recovery_test',gen_random_uuid(),'{}','{}','PROCESSING','PROCESSING',now()-interval '10 minutes','crashed-worker') RETURNING id", [tenant]);
    eventId = inserted.rows[0].id;
    const claimed = await repository.claim({ workerId: "sprint18-recovery-worker", batchSize: 10, lockTimeoutSeconds: 60 });
    expect(claimed.some((event) => event.id === eventId)).toBe(true);
    await repository.processed(eventId, "sprint18-recovery-worker");
    const row = (await db.query("SELECT delivery_status,status,locked_by FROM outbox_events WHERE id=$1", [eventId])).rows[0];
    expect(row).toMatchObject({ delivery_status: "PROCESSED", status: "PUBLISHED", locked_by: null });
  });
});

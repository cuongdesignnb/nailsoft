import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { OutboxRepository } from "../../apps/worker/src/outbox.repository.js";
import { OutboxEventRouter } from "../../apps/worker/src/outbox-event.router.js";
import { CrossTenantEventError } from "../../apps/worker/src/outbox.types.js";

const tenantId = "10000000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000001";
const repoA = new OutboxRepository();
const repoB = new OutboxRepository();
const ids: string[] = [];

async function insert(eventType = "closure.unknown", branch: string | null = null) {
  const id = randomUUID();
  ids.push(id);
  await repoA.query(
    "INSERT INTO outbox_events(id,tenant_id,branch_id,event_type,aggregate_type,aggregate_id,payload_json,metadata_json) VALUES($1,$2,$3,$4,'closure',$5,'{}','{}')",
    [id, tenantId, branch, eventType, randomUUID()],
  );
  return id;
}

describe("Sprint 3 durable outbox delivery", () => {
  beforeAll(async () => {
    await repoA.query(
      "UPDATE outbox_events SET delivery_status='PROCESSED',status='PUBLISHED',processed_at=coalesce(processed_at,now()),published_at=coalesce(published_at,now()) WHERE delivery_status='PENDING'",
    );
  });

  afterAll(async () => {
    await repoA.query("DELETE FROM outbox_events WHERE id=ANY($1::uuid[])", [ids]);
    await repoA.onModuleDestroy();
    await repoB.onModuleDestroy();
  });

  it("uses SKIP LOCKED so two workers cannot claim one event", async () => {
    const id = await insert();
    const [a, b] = await Promise.all([
      repoA.claim({ workerId: "worker-a", batchSize: 200, lockTimeoutSeconds: 60 }),
      repoB.claim({ workerId: "worker-b", batchSize: 200, lockTimeoutSeconds: 60 }),
    ]);
    expect([...a, ...b].filter((event) => event.id === id)).toHaveLength(1);
    for (const event of a) await repoA.processed(event.id, "worker-a");
    for (const event of b) await repoB.processed(event.id, "worker-b");
    await repoA.query(
      "UPDATE outbox_events SET delivery_status='PROCESSED',status='PUBLISHED',processed_at=now(),published_at=now(),locked_at=NULL,locked_by=NULL WHERE id=$1",
      [id],
    );
  });

  it("recovers stale leases and records processed_at only after delivery", async () => {
    const id = await insert();
    await repoA.query(
      "UPDATE outbox_events SET delivery_status='PROCESSING',status='PROCESSING',locked_at=now()-interval '2 minutes',locked_by='dead-worker' WHERE id=$1",
      [id],
    );
    const claimed = await repoA.claim({
      workerId: "recovery-worker",
      batchSize: 200,
      lockTimeoutSeconds: 30,
    });
    const event = claimed.find((item) => item.id === id);
    expect(event?.id).toBe(id);
    for (const item of claimed)
      await repoA.processed(item.id, "recovery-worker");
    const row = (
      await repoA.query<{
        delivery_status: string;
        processed_at: Date | null;
      }>("SELECT delivery_status,processed_at FROM outbox_events WHERE id=$1", [id])
    ).rows[0]!;
    expect(row.delivery_status).toBe("PROCESSED");
    expect(row.processed_at).toBeInstanceOf(Date);
  });

  it("schedules retry without marking a Redis failure processed", async () => {
    const id = await insert();
    const claimed = await repoA.claim({
      workerId: "retry-worker",
      batchSize: 200,
      lockTimeoutSeconds: 60,
    });
    const retryEvent = claimed.find((item) => item.id === id);
    expect(retryEvent?.id).toBe(id);
    for (const item of claimed.filter((item) => item.id !== id))
      await repoA.processed(item.id, "retry-worker");
    await repoA.retry(id, "retry-worker", 5, new Error("Redis unavailable"));
    const row = (
      await repoA.query<{
        delivery_status: string;
        processed_at: Date | null;
        available_at: Date;
      }>(
        "SELECT delivery_status,processed_at,available_at FROM outbox_events WHERE id=$1",
        [id],
      )
    ).rows[0]!;
    expect(row.delivery_status).toBe("PENDING");
    expect(row.processed_at).toBeNull();
    expect(row.available_at.getTime()).toBeGreaterThan(Date.now());
  });

  it("ignores unknown events and rejects cross-tenant branch payloads", async () => {
    const router = new OutboxEventRouter(repoA);
    expect(
      await router.route({
        id: randomUUID(),
        tenant_id: tenantId,
        branch_id: null,
        event_type: "not.realtime",
        aggregate_type: "test",
        aggregate_id: randomUUID(),
        payload_json: {},
        metadata_json: {},
        attempt_count: 1,
        created_at: new Date(),
      }),
    ).toEqual({ kind: "ignored" });
    await expect(
      router.route({
        id: randomUUID(),
        tenant_id: tenantId,
        branch_id: randomUUID(),
        event_type: "resource.updated",
        aggregate_type: "resource",
        aggregate_id: randomUUID(),
        payload_json: {},
        metadata_json: {},
        attempt_count: 1,
        created_at: new Date(),
      }),
    ).rejects.toBeInstanceOf(CrossTenantEventError);
  });

  it("routes branch changes to branch and active staff rooms with latest data version", async () => {
    const router = new OutboxEventRouter(repoA);
    const routed = await router.route({
      id: randomUUID(),
      tenant_id: tenantId,
      branch_id: branchId,
      event_type: "business_hours.updated",
      aggregate_type: "branch",
      aggregate_id: branchId,
      payload_json: { branchId },
      metadata_json: {},
      attempt_count: 1,
      created_at: new Date(),
    });
    expect(routed.kind).toBe("invalidation");
    if (routed.kind === "invalidation") {
      expect(routed.deliveries[0]?.rooms).toContain(`branch:${branchId}`);
      expect(routed.deliveries[0]?.payload.dataVersion).toBeGreaterThan(0);
      expect(routed.deliveries[0]?.payload.eventId).toBeTruthy();
    }
  });
});

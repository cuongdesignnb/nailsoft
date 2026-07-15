import { describe, expect, it, vi } from "vitest";
import { OutboxProcessor } from "./outbox.processor.js";

describe("outbox processor", () => {
  it("uses PostgreSQL as source of truth", () => {
    const processor = new OutboxProcessor(
      {
        claim: vi.fn().mockResolvedValue([]),
        statistics: vi.fn().mockResolvedValue({
          pending: 0,
          processing: 0,
          failed: 0,
          oldest_pending_age_seconds: 0,
        }),
      } as never,
      { route: vi.fn() } as never,
      { invalidation: vi.fn(), control: vi.fn() } as never,
      { increment: vi.fn(), observe: vi.fn() } as never,
      { route: vi.fn() } as never,
    );
    expect(processor.sourceOfTruth).toBe("postgresql");
  });

  it("retries Redis failures and never marks them processed", async () => {
    const event = {
      id: "10000000-0000-4000-8000-000000000099",
      tenant_id: "10000000-0000-4000-8000-000000000001",
      branch_id: "20000000-0000-4000-8000-000000000001",
      event_type: "shift.published",
      aggregate_type: "shift",
      aggregate_id: "60000000-0000-4000-8000-000000000001",
      payload_json: {},
      metadata_json: {},
      attempt_count: 1,
      created_at: new Date(),
    };
    const repo = {
      claim: vi.fn().mockResolvedValue([event]),
      processed: vi.fn(),
      retry: vi.fn(),
      failed: vi.fn(),
      statistics: vi.fn().mockResolvedValue({
        pending: 1,
        processing: 0,
        failed: 0,
        oldest_pending_age_seconds: 1,
      }),
    };
    const processor = new OutboxProcessor(
      repo as never,
      {
        route: vi.fn().mockResolvedValue({
          kind: "invalidation",
          deliveries: [{ payload: {}, rooms: ["branch:a"] }],
        }),
      } as never,
      {
        invalidation: vi.fn().mockRejectedValue(new Error("Redis unavailable")),
      } as never,
      { increment: vi.fn(), observe: vi.fn() } as never,
      { route: vi.fn() } as never,
    );
    await processor.processBatch();
    expect(repo.retry).toHaveBeenCalledWith(
      event.id,
      processor.workerId,
      5,
      expect.any(Error),
    );
    expect(repo.processed).not.toHaveBeenCalled();
  });

  it("moves an exhausted event to FAILED and processes ignored events", async () => {
    const failedEvent = {
      id: "10000000-0000-4000-8000-000000000098",
      tenant_id: "10000000-0000-4000-8000-000000000001",
      branch_id: null,
      event_type: "service.updated",
      aggregate_type: "service",
      aggregate_id: "50000000-0000-4000-8000-000000000001",
      payload_json: {},
      metadata_json: {},
      attempt_count: 5,
      created_at: new Date(),
    };
    const repo = {
      claim: vi.fn().mockResolvedValue([failedEvent]),
      processed: vi.fn(),
      retry: vi.fn(),
      failed: vi.fn(),
      statistics: vi.fn().mockResolvedValue({
        pending: 0,
        processing: 0,
        failed: 1,
        oldest_pending_age_seconds: 0,
      }),
    };
    const router = { route: vi.fn().mockRejectedValue(new Error("down")) };
    const processor = new OutboxProcessor(
      repo as never,
      router as never,
      { invalidation: vi.fn() } as never,
      { increment: vi.fn(), observe: vi.fn() } as never,
      { route: vi.fn() } as never,
    );
    await processor.processBatch();
    expect(repo.failed).toHaveBeenCalled();
    router.route.mockResolvedValue({ kind: "ignored" } as never);
    repo.claim.mockResolvedValue([
      { ...failedEvent, id: "10000000-0000-4000-8000-000000000097" },
    ]);
    await processor.processBatch();
    expect(repo.processed).toHaveBeenCalled();
  });
});

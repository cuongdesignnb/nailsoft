import { describe, expect, it, vi } from "vitest";
import { EngagementProcessor } from "./engagement.processor.js";

describe("appointment cancellation engagement", () => {
  it("cancels pending reminders even when no cancellation email rule exists", async () => {
    const event = {
      id: "event-cancelled",
      tenant_id: "tenant-a",
      branch_id: "branch-a",
      event_type: "appointment.cancelled",
      aggregate_id: "appointment-a",
      payload_json: { sendCancellationEmail: true },
    };
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [event] })
      .mockResolvedValueOnce({ rowCount: 2, rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const pool = { query, end: vi.fn().mockResolvedValue(undefined) };
    const processor = new EngagementProcessor({} as never);
    Object.defineProperty(processor, "pool", { configurable: true, value: pool });

    await expect(processor.generateTransactional()).resolves.toBe(0);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[1]?.[0]).toContain("purpose='APPOINTMENT_REMINDER'");
    expect(query.mock.calls[1]?.[0]).toContain("status='CANCELLED'");
    await processor.onModuleDestroy();
  });

  it("does not schedule a cancellation email when the UI opts out", async () => {
    const event = {
      id: "event-cancelled-opt-out",
      tenant_id: "tenant-a",
      branch_id: "branch-a",
      event_type: "appointment.cancelled",
      aggregate_id: "appointment-a",
      payload_json: { sendCancellationEmail: false },
    };
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [event] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const processor = new EngagementProcessor({} as never);
    Object.defineProperty(processor, "pool", {
      configurable: true,
      value: { query, end: vi.fn().mockResolvedValue(undefined) },
    });

    await expect(processor.generateTransactional()).resolves.toBe(0);
    expect(query).toHaveBeenCalledTimes(2);
  });
});

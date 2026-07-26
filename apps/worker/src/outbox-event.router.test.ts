import { describe, expect, it, vi } from "vitest";
import { OutboxEventRouter } from "./outbox-event.router.js";

describe("Sprint 5 durable realtime routing", () => {
  it("routes operational invalidations to tenant, branch, staff and appointment rooms", async () => {
    const repo = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM branches")) return { rowCount: 1, rows: [{}] };
        if (sql.includes("SELECT DISTINCT asa.staff_id"))
          return { rowCount: 1, rows: [{ staff_id: "staff-a" }] };
        if (sql.includes("FROM staff_profiles"))
          return { rowCount: 1, rows: [{}] };
        if (sql.includes("branch_operational_versions"))
          return { rowCount: 1, rows: [{ version: "42" }] };
        return { rowCount: 0, rows: [] };
      }),
    };
    const router = new OutboxEventRouter(repo as never);
    const routed = await router.route({
      id: "event-a",
      tenant_id: "tenant-a",
      branch_id: "branch-a",
      event_type: "service_session.completed",
      aggregate_type: "service_session",
      aggregate_id: "session-a",
      payload_json: { appointmentId: "appointment-a" },
      metadata_json: { realtimeEvent: "service_session.updated" },
      attempt_count: 0,
      created_at: new Date("2026-07-26T00:00:00Z"),
    });
    expect(routed).toMatchObject({
      kind: "invalidation",
      deliveries: [
        {
          payload: {
            appointmentId: "appointment-a",
            dataVersion: 42,
            realtimeEvent: "service_session.updated",
            refetch: true,
          },
        },
      ],
    });
    if (routed.kind !== "invalidation") throw new Error("not routed");
    expect(routed.deliveries[0]!.rooms).toEqual(
      expect.arrayContaining([
        "tenant:tenant-a",
        "branch:branch-a",
        "staff:staff-a",
        "appointment:appointment-a",
      ]),
    );
  });

  it("fails closed when an event branch does not belong to its tenant", async () => {
    const router = new OutboxEventRouter({
      query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
    } as never);
    await expect(
      router.route({
        id: "event-b",
        tenant_id: "tenant-a",
        branch_id: "foreign-branch",
        event_type: "walkin.created",
        aggregate_type: "walk_in",
        aggregate_id: "walk-a",
        payload_json: {},
        metadata_json: {},
        attempt_count: 0,
        created_at: new Date(),
      }),
    ).rejects.toThrow("Branch does not belong");
  });
});

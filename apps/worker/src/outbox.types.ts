export type OutboxEvent = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload_json: Record<string, unknown>;
  metadata_json: Record<string, unknown>;
  attempt_count: number;
  created_at: Date;
};

export type AvailabilityInvalidatedEvent = {
  eventId: string;
  tenantId: string;
  branchId: string;
  staffId?: string;
  dataVersion: number;
  sourceEventType: string;
  refetch: true;
  occurredAt: string;
};

export type RealtimeControlMessage =
  | {
      type: "DISCONNECT_SESSION";
      tenantId: string;
      sessionId: string;
      reason: string;
    }
  | {
      type: "DISCONNECT_MEMBERSHIP";
      tenantId: string;
      membershipId: string;
      reason: string;
    }
  | { type: "DISCONNECT_USER"; userId: string; reason: string };

export type RoutedEvent =
  | { kind: "ignored" }
  | { kind: "control"; message: RealtimeControlMessage }
  | {
      kind: "invalidation";
      deliveries: Array<{
        payload: AvailabilityInvalidatedEvent;
        rooms: string[];
      }>;
    };

export class CrossTenantEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrossTenantEventError";
  }
}

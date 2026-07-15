import { Inject, Injectable } from "@nestjs/common";
import { OutboxRepository } from "./outbox.repository.js";
import {
  CrossTenantEventError,
  type OutboxEvent,
  type RealtimeControlMessage,
  type RoutedEvent,
} from "./outbox.types.js";

const tenantWide = new Set([
  "service.created",
  "service.updated",
  "service.activated",
  "service.deactivated",
  "service.archived",
  "service_skill.requirements_changed",
  "service_resource.requirements_changed",
]);
const branchWide = new Set([
  "branch.created",
  "branch.updated",
  "business_hours.updated",
  "service_price.created",
  "service_price.updated",
  "service_price.cancelled",
  "resource.created",
  "resource.updated",
  "resource.status_changed",
]);
const staffSpecific = new Set([
  "staff.created",
  "staff.updated",
  "staff.status_changed",
  "staff.branch_assigned",
  "staff.branch_assignment_ended",
  "staff.skill_changed",
  "shift.created",
  "shift.updated",
  "shift.published",
  "shift.cancelled",
  "leave.approved",
  "leave.cancelled",
]);
const blockEvents = new Set([
  "availability.block_created",
  "availability.block_updated",
  "availability.block_cancelled",
]);
const bookingEvents = new Set([
  "slot_hold.created",
  "slot_hold.consumed",
  "slot_hold.released",
  "slot_hold.expired",
  "appointment.created",
  "appointment.pending_confirmation",
  "appointment.deposit_required",
  "appointment.deposit_waived",
  "appointment.confirmed",
  "appointment.rescheduled",
  "appointment.cancelled",
  "appointment.expired",
  "appointment.assignment_changed",
  "schedule.staff_reserved",
  "schedule.resource_reserved",
  "schedule.reservation_released",
]);

@Injectable()
export class OutboxEventRouter {
  constructor(
    @Inject(OutboxRepository) private readonly repo: OutboxRepository,
  ) {}

  async route(event: OutboxEvent): Promise<RoutedEvent> {
    const control = this.control(event);
    if (control) return { kind: "control", message: control };
    if (bookingEvents.has(event.event_type)) return this.booking(event);
    if (
      !tenantWide.has(event.event_type) &&
      !branchWide.has(event.event_type) &&
      !staffSpecific.has(event.event_type) &&
      !blockEvents.has(event.event_type)
    )
      return { kind: "ignored" };

    let branches: string[] = [];
    let staffId: string | undefined;
    let ownerRoom = tenantWide.has(event.event_type);
    if (tenantWide.has(event.event_type)) {
      branches = await this.tenantBranches(event.tenant_id);
    } else if (staffSpecific.has(event.event_type)) {
      const target = await this.staffTarget(event);
      staffId = target.staffId;
      branches = target.branches;
    } else {
      const target = await this.branchTarget(event);
      if (!target && event.event_type.startsWith("service_price.")) {
        branches = await this.tenantBranches(event.tenant_id);
        ownerRoom = true;
      } else {
        branches = target ? [target] : [];
      }
      if (blockEvents.has(event.event_type))
        staffId = stringValue(
          event.payload_json.staffId ?? event.payload_json.staff_id,
        );
    }
    if (branches.length === 0) return { kind: "ignored" };

    const deliveries = [];
    for (const branchId of [...new Set(branches)]) {
      await this.assertBranch(event.tenant_id, branchId);
      const version = await this.version(event.tenant_id, branchId);
      const staffRooms = staffId
        ? [staffId]
        : await this.activeStaff(event.tenant_id, branchId);
      if (staffId) await this.assertStaff(event.tenant_id, branchId, staffId);
      const rooms = [
        ...(ownerRoom ? [`tenant:${event.tenant_id}`] : []),
        `branch:${branchId}`,
        ...staffRooms.map((id) => `staff:${id}`),
      ];
      deliveries.push({
        payload: {
          eventId: event.id,
          tenantId: event.tenant_id,
          branchId,
          ...(staffId ? { staffId } : {}),
          dataVersion: version,
          sourceEventType: event.event_type,
          refetch: true as const,
          occurredAt: event.created_at.toISOString(),
        },
        rooms: [...new Set(rooms)],
      });
    }
    return { kind: "invalidation", deliveries };
  }

  private async booking(event: OutboxEvent): Promise<RoutedEvent> {
    const branchId =
      event.branch_id ?? stringValue(event.payload_json.branchId);
    if (!branchId) return { kind: "ignored" };
    await this.assertBranch(event.tenant_id, branchId);
    let staffIds = Array.isArray(event.payload_json.staffIds)
      ? event.payload_json.staffIds.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    if (!staffIds.length && event.aggregate_type === "appointment") {
      const result = await this.repo.query<{ staff_id: string }>(
        `SELECT DISTINCT asa.staff_id FROM appointment_items ai
         JOIN appointment_item_staff_assignments asa
           ON asa.tenant_id=ai.tenant_id AND asa.appointment_item_id=ai.id
         WHERE ai.tenant_id=$1 AND ai.appointment_id=$2 AND asa.status='ACTIVE'`,
        [event.tenant_id, event.aggregate_id],
      );
      staffIds = result.rows.map((row) => row.staff_id);
    }
    for (const staffId of staffIds)
      await this.assertStaff(event.tenant_id, branchId, staffId);
    return {
      kind: "invalidation",
      deliveries: [
        {
          payload: {
            eventId: event.id,
            tenantId: event.tenant_id,
            branchId,
            dataVersion: await this.version(event.tenant_id, branchId),
            sourceEventType: event.event_type,
            refetch: true,
            occurredAt: event.created_at.toISOString(),
          },
          rooms: [
            ...new Set([
              `tenant:${event.tenant_id}`,
              `branch:${branchId}`,
              ...staffIds.map((id) => `staff:${id}`),
            ]),
          ],
        },
      ],
    };
  }

  private control(event: OutboxEvent): RealtimeControlMessage | undefined {
    const payload = event.payload_json;
    const userId = stringValue(payload.userId ?? payload.user_id);
    const membershipId = stringValue(
      payload.membershipId ?? payload.membership_id,
    );
    const sessionId = stringValue(payload.sessionId ?? payload.session_id);
    if (event.event_type === "session.revoked" && sessionId)
      return {
        type: "DISCONNECT_SESSION",
        tenantId: event.tenant_id,
        sessionId,
        reason: "SESSION_REVOKED",
      };
    if (
      ["session.logout_all", "user.suspended", "user.disabled"].includes(
        event.event_type,
      ) &&
      userId
    )
      return {
        type: "DISCONNECT_USER",
        userId,
        reason: event.event_type.toUpperCase().replaceAll(".", "_"),
      };
    if (
      [
        "membership.suspended",
        "membership.revoked",
        "authorization.changed",
        "branch_scope.removed",
        "role.changed",
      ].includes(event.event_type) &&
      membershipId
    )
      return {
        type: "DISCONNECT_MEMBERSHIP",
        tenantId: event.tenant_id,
        membershipId,
        reason:
          event.event_type === "authorization.changed"
            ? "AUTHORIZATION_CHANGED"
            : event.event_type.toUpperCase().replaceAll(".", "_"),
      };
    return undefined;
  }

  private async tenantBranches(tenantId: string) {
    const result = await this.repo.query<{ id: string }>(
      "SELECT id FROM branches WHERE tenant_id=$1 AND status='ACTIVE' ORDER BY id",
      [tenantId],
    );
    return result.rows.map((row) => row.id);
  }

  private async branchTarget(event: OutboxEvent) {
    if (event.branch_id) return event.branch_id;
    const payloadBranch = stringValue(
      event.payload_json.branchId ?? event.payload_json.branch_id,
    );
    if (payloadBranch) return payloadBranch;
    if (event.event_type === "branch.updated") return event.aggregate_id;
    const table = event.event_type.startsWith("resource.")
      ? "resources"
      : event.event_type.startsWith("service_price.")
        ? "service_prices"
        : undefined;
    if (!table) return undefined;
    const result = await this.repo.query<{ branch_id: string | null }>(
      `SELECT branch_id FROM ${table} WHERE tenant_id=$1 AND id=$2`,
      [event.tenant_id, event.aggregate_id],
    );
    const branchId = result.rows[0]?.branch_id;
    if (!branchId && event.event_type.startsWith("service_price.")) {
      return undefined;
    }
    return branchId ?? undefined;
  }

  private async staffTarget(event: OutboxEvent) {
    let staffId = stringValue(
      event.payload_json.staffId ??
        event.payload_json.staff_id ??
        event.payload_json.id,
    );
    let branchId =
      event.branch_id ??
      stringValue(event.payload_json.branchId ?? event.payload_json.branch_id);
    if (event.event_type.startsWith("shift.")) {
      const row = (
        await this.repo.query<{ staff_id: string; branch_id: string }>(
          "SELECT staff_id,branch_id FROM shifts WHERE tenant_id=$1 AND id=$2",
          [event.tenant_id, event.aggregate_id],
        )
      ).rows[0];
      staffId = staffId ?? row?.staff_id;
      branchId = branchId ?? row?.branch_id;
    } else if (event.event_type.startsWith("leave.")) {
      const row = (
        await this.repo.query<{ staff_id: string; branch_id: string | null }>(
          "SELECT staff_id,branch_id FROM leave_requests WHERE tenant_id=$1 AND id=$2",
          [event.tenant_id, event.aggregate_id],
        )
      ).rows[0];
      staffId = staffId ?? row?.staff_id;
      branchId = branchId ?? row?.branch_id ?? undefined;
    } else if (!staffId && event.event_type.startsWith("staff.")) {
      staffId = event.aggregate_id;
    }
    if (!staffId) return { staffId: undefined, branches: [] as string[] };
    if (branchId) return { staffId, branches: [branchId] };
    const rows = await this.repo.query<{ branch_id: string }>(
      `SELECT branch_id FROM staff_branch_assignments
       WHERE tenant_id=$1 AND staff_id=$2 AND status='ACTIVE'
         AND effective_from<=current_date AND (effective_to IS NULL OR effective_to>=current_date)`,
      [event.tenant_id, staffId],
    );
    return { staffId, branches: rows.rows.map((row) => row.branch_id) };
  }

  private async assertBranch(tenantId: string, branchId: string) {
    const result = await this.repo.query(
      "SELECT 1 FROM branches WHERE tenant_id=$1 AND id=$2",
      [tenantId, branchId],
    );
    if (!result.rowCount)
      throw new CrossTenantEventError("Branch does not belong to event tenant");
  }

  private async assertStaff(
    tenantId: string,
    branchId: string,
    staffId: string,
  ) {
    const result = await this.repo.query(
      `SELECT 1 FROM staff_profiles sp
       JOIN staff_branch_assignments sa ON sa.tenant_id=sp.tenant_id AND sa.staff_id=sp.id
       WHERE sp.tenant_id=$1 AND sp.id=$2 AND sa.branch_id=$3 LIMIT 1`,
      [tenantId, staffId, branchId],
    );
    if (!result.rowCount)
      throw new CrossTenantEventError(
        "Staff target does not belong to event tenant and branch",
      );
  }

  private async activeStaff(tenantId: string, branchId: string) {
    const result = await this.repo.query<{ staff_id: string }>(
      `SELECT DISTINCT sa.staff_id FROM staff_branch_assignments sa
       JOIN staff_profiles sp ON sp.tenant_id=sa.tenant_id AND sp.id=sa.staff_id
       WHERE sa.tenant_id=$1 AND sa.branch_id=$2 AND sa.status='ACTIVE'
         AND sp.status='ACTIVE' AND sa.effective_from<=current_date
         AND (sa.effective_to IS NULL OR sa.effective_to>=current_date)`,
      [tenantId, branchId],
    );
    return result.rows.map((row) => row.staff_id);
  }

  private async version(tenantId: string, branchId: string) {
    const result = await this.repo.query<{ version: string }>(
      "SELECT version FROM availability_versions WHERE tenant_id=$1 AND branch_id=$2",
      [tenantId, branchId],
    );
    return Number(result.rows[0]?.version ?? 1);
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

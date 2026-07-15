/* eslint-disable @typescript-eslint/no-explicit-any */
import { ConflictException, Injectable } from "@nestjs/common";
import type { BookingPlan } from "@nailsoft/domain-types";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

@Injectable()
export class ReservationService {
  async lockPlan(client: PoolClient, tenantId: string, plan: BookingPlan) {
    const localDate = plan.startAt.slice(0, 10);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `${tenantId}:branch:${plan.branchId}:${localDate}`,
    ]);
    for (const staffId of [...new Set(plan.items.map((x) => x.staffId))].sort())
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`${tenantId}:staff:${staffId}`],
      );
    for (const resourceId of [
      ...new Set(
        plan.items.flatMap((x) =>
          x.resourceAllocations.map((r) => r.resourceId),
        ),
      ),
    ].sort())
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`${tenantId}:resource:${resourceId}`],
      );
  }

  async expireStale(
    client: PoolClient,
    tenantId: string,
    branchId: string,
    requestId: string,
  ) {
    const expired = (
      await client.query<any>(
        "UPDATE slot_holds SET status='EXPIRED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND branch_id=$2 AND status='ACTIVE' AND expires_at<=now() RETURNING *",
        [tenantId, branchId],
      )
    ).rows;
    if (!expired.length) return;
    const ids = expired.map((x) => x.id);
    await client.query(
      "UPDATE staff_schedule_reservations SET status='EXPIRED',released_at=now() WHERE tenant_id=$1 AND status='ACTIVE' AND slot_hold_item_id IN (SELECT id FROM slot_hold_items WHERE tenant_id=$1 AND slot_hold_id=ANY($2::uuid[]))",
      [tenantId, ids],
    );
    await client.query(
      "UPDATE resource_schedule_reservations SET status='EXPIRED',released_at=now() WHERE tenant_id=$1 AND status='ACTIVE' AND slot_hold_item_id IN (SELECT id FROM slot_hold_items WHERE tenant_id=$1 AND slot_hold_id=ANY($2::uuid[]))",
      [tenantId, ids],
    );
    for (const hold of expired)
      await this.record(client, {
        tenantId,
        branchId,
        actorUserId: null,
        action: "slot_hold.expired",
        aggregateType: "slot_hold",
        aggregateId: hold.id,
        aggregateVersion: hold.version,
        requestId,
        payload: {
          holdId: hold.id,
          status: "EXPIRED",
          branchId,
          refetch: true,
        },
      });
  }

  async createForHold(
    client: PoolClient,
    tenantId: string,
    holdId: string,
    plan: BookingPlan,
    expiresAt: Date,
  ) {
    const itemIds: string[] = [];
    for (const item of plan.items) {
      const itemId = randomUUID();
      itemIds.push(itemId);
      await client.query(
        "INSERT INTO slot_hold_items(id,tenant_id,slot_hold_id,service_id,sequence_no,selected_staff_id,service_start_at,service_end_at,staff_occupancy_start_at,staff_occupancy_end_at,resource_occupancy_start_at,resource_occupancy_end_at,service_snapshot_json,price_snapshot_json,tax_snapshot_json,resource_plan_json,availability_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)",
        [
          itemId,
          tenantId,
          holdId,
          item.serviceId,
          item.sequenceNo,
          item.staffId,
          item.serviceStartAt,
          item.serviceEndAt,
          item.staffOccupancyStartAt,
          item.staffOccupancyEndAt,
          item.resourceOccupancyStartAt,
          item.resourceOccupancyEndAt,
          JSON.stringify(item.serviceSnapshot),
          JSON.stringify(item.priceSnapshot),
          JSON.stringify(item.taxSnapshot),
          JSON.stringify(item.resourceAllocations),
          item.availabilityFingerprint,
        ],
      );
      try {
        await client.query(
          "INSERT INTO staff_schedule_reservations(tenant_id,branch_id,staff_id,slot_hold_item_id,reservation_type,status,start_at,end_at,expires_at) VALUES($1,$2,$3,$4,'HOLD','ACTIVE',$5,$6,$7)",
          [
            tenantId,
            plan.branchId,
            item.staffId,
            itemId,
            item.staffOccupancyStartAt,
            item.staffOccupancyEndAt,
            expiresAt,
          ],
        );
      } catch (error) {
        if (dbCode(error) === "23P01")
          throw new ConflictException({
            code: "STAFF_RESERVED",
            message: "Technician was reserved by another request",
          });
        throw error;
      }
      for (const resource of item.resourceAllocations) {
        const current = (
          await client.query<any>(
            `SELECT r.capacity,COALESCE(sum(rr.quantity) FILTER (WHERE rr.status='ACTIVE' AND rr.start_at<$5 AND rr.end_at>$4 AND (rr.reservation_type='APPOINTMENT' OR rr.expires_at>now())),0)::int used,COALESCE(bool_or(rr.is_exclusive) FILTER (WHERE rr.status='ACTIVE' AND rr.start_at<$5 AND rr.end_at>$4 AND (rr.reservation_type='APPOINTMENT' OR rr.expires_at>now())),false) exclusive_used FROM resources r LEFT JOIN resource_schedule_reservations rr ON rr.tenant_id=r.tenant_id AND rr.resource_id=r.id WHERE r.tenant_id=$1 AND r.branch_id=$2 AND r.id=$3 AND r.status='ACTIVE' GROUP BY r.capacity`,
            [
              tenantId,
              plan.branchId,
              resource.resourceId,
              item.resourceOccupancyStartAt,
              item.resourceOccupancyEndAt,
            ],
          )
        ).rows[0];
        if (
          !current ||
          current.exclusive_used ||
          Number(current.used) + resource.quantity > Number(current.capacity) ||
          (resource.isExclusive && Number(current.used) > 0)
        )
          throw new ConflictException({
            code: "RESOURCE_CAPACITY_INSUFFICIENT",
            message: "Resource capacity was reserved by another request",
          });
        await client.query(
          "INSERT INTO resource_schedule_reservations(tenant_id,branch_id,resource_id,slot_hold_item_id,reservation_type,status,quantity,is_exclusive,start_at,end_at,expires_at) VALUES($1,$2,$3,$4,'HOLD','ACTIVE',$5,$6,$7,$8,$9)",
          [
            tenantId,
            plan.branchId,
            resource.resourceId,
            itemId,
            resource.quantity,
            resource.isExclusive,
            item.resourceOccupancyStartAt,
            item.resourceOccupancyEndAt,
            expiresAt,
          ],
        );
      }
    }
    return itemIds;
  }

  async releaseHold(
    client: PoolClient,
    tenantId: string,
    holdId: string,
    status: "RELEASED" | "EXPIRED",
  ) {
    const itemQuery =
      "SELECT id FROM slot_hold_items WHERE tenant_id=$1 AND slot_hold_id=$2";
    await client.query(
      `UPDATE staff_schedule_reservations SET status=$3,released_at=now() WHERE tenant_id=$1 AND status='ACTIVE' AND slot_hold_item_id IN (${itemQuery})`,
      [tenantId, holdId, status],
    );
    await client.query(
      `UPDATE resource_schedule_reservations SET status=$3,released_at=now() WHERE tenant_id=$1 AND status='ACTIVE' AND slot_hold_item_id IN (${itemQuery})`,
      [tenantId, holdId, status],
    );
  }

  async record(
    client: PoolClient,
    input: {
      tenantId: string;
      branchId: string;
      actorUserId: string | null;
      action: string;
      aggregateType: string;
      aggregateId: string;
      aggregateVersion: number;
      requestId: string;
      payload: Record<string, unknown>;
      reason?: string;
    },
  ) {
    await client.query(
      "INSERT INTO audit_logs(tenant_id,branch_id,actor_user_id,action,entity_type,entity_id,after_json,reason,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        input.tenantId,
        input.branchId,
        input.actorUserId,
        input.action,
        input.aggregateType,
        input.aggregateId,
        JSON.stringify(input.payload),
        input.reason ?? null,
        input.requestId,
      ],
    );
    await client.query(
      "INSERT INTO outbox_events(tenant_id,branch_id,event_type,aggregate_type,aggregate_id,aggregate_version,payload_json,actor_json,metadata_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        input.tenantId,
        input.branchId,
        input.action,
        input.aggregateType,
        input.aggregateId,
        input.aggregateVersion,
        JSON.stringify(input.payload),
        JSON.stringify({
          type: input.actorUserId ? "USER" : "SYSTEM",
          id: input.actorUserId,
        }),
        JSON.stringify({
          schemaVersion: 1,
          realtimeEvent: "availability.invalidated",
        }),
      ],
    );
  }
}

function dbCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

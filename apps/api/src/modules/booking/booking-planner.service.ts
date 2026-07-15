/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  BookingPlan,
  BookingPlanInput,
  BookingPlanItem,
} from "@nailsoft/domain-types";
import { bookingPlanSchema } from "@nailsoft/validation";
import { DateTime } from "luxon";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { AvailabilityService } from "../availability/availability.service.js";
import type { AccessClaims } from "../identity/auth.types.js";

@Injectable()
export class BookingPlannerService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AvailabilityService)
    private readonly availability: AvailabilityService,
  ) {}

  async plan(auth: AccessClaims, input: unknown): Promise<BookingPlan> {
    const body = bookingPlanSchema.parse(input) as BookingPlanInput;
    const branch = (
      await this.db.query<any>(
        "SELECT b.id,b.timezone,b.status,bs.booking_policy_json,t.currency FROM branches b JOIN tenants t ON t.id=b.tenant_id LEFT JOIN branch_settings bs ON bs.tenant_id=b.tenant_id AND bs.branch_id=b.id WHERE b.tenant_id=$1 AND b.id=$2",
        [auth.tenantId, body.branchId],
      )
    ).rows[0];
    if (!branch)
      throw new NotFoundException({
        code: "BOOKING_BRANCH_INACTIVE",
        message: "Branch not found",
      });
    if (branch.status !== "ACTIVE")
      throw new ConflictException({
        code: "BOOKING_BRANCH_INACTIVE",
        message: "Branch is not available for booking",
      });
    const maxItems = Number(branch.booking_policy_json?.maxItems ?? 5);
    if (body.items.length > maxItems)
      throw new BadRequestException({
        code: "BOOKING_POLICY_CHANGED",
        message: `A booking may contain at most ${maxItems} services`,
      });
    let cursor = DateTime.fromISO(body.desiredStartAt, { setZone: true });
    if (!cursor.isValid)
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "desiredStartAt is invalid",
      });
    const planned: BookingPlanItem[] = [];
    let dataVersion: number | undefined;
    let currency: string | undefined;
    let totalMinor = 0;
    for (let index = 0; index < body.items.length; index += 1) {
      const request = body.items[index]!;
      const service = (
        await this.db.query<any>(
          "SELECT id,code,name_json,default_duration_min,prep_time_min,cleanup_time_min,booking_buffer_before_min,booking_buffer_after_min,online_booking_enabled,deposit_type,deposit_value,tax_code,version,status FROM services WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, request.serviceId],
        )
      ).rows[0];
      if (!service || service.status !== "ACTIVE")
        throw changed("Service configuration changed");
      // The previous cursor is the end of all prior occupancy. Move the next
      // service start far enough forward that its prep/buffer also starts after it.
      if (index > 0)
        cursor = cursor.plus({
          minutes: service.prep_time_min + service.booking_buffer_before_min,
        });
      const localDate = cursor.setZone(branch.timezone).toISODate()!;
      const result = await this.availability.search(auth, {
        branchId: body.branchId,
        serviceId: request.serviceId,
        dateFrom: localDate,
        dateTo: localDate,
        ...(request.staffPreference.type === "SPECIFIC"
          ? { staffId: request.staffPreference.staffId }
          : {}),
        slotIntervalMin: 5,
      });
      if (
        dataVersion !== undefined &&
        dataVersion !== Number(result.dataVersion)
      )
        throw changed("Availability changed while the plan was being built");
      dataVersion = Number(result.dataVersion);
      const wanted = cursor.toUTC().toISO();
      const slot = result.days
        .flatMap((day: any) => day.slots)
        .find((candidate: any) => candidate.startAt === wanted);
      if (!slot)
        throw new ConflictException({
          code: "SLOT_UNAVAILABLE",
          message: "The selected time is no longer available",
          details: {
            reasonCodes:
              result.days[0]?.unavailableReasons?.map((x: any) => x.code) ?? [],
          },
        });
      if (
        request.availabilityFingerprint &&
        request.availabilityFingerprint !== slot.fingerprint
      )
        throw changed("Availability fingerprint is stale");
      const staffId = await this.selectStaff(
        auth.tenantId,
        body.branchId,
        slot.staffCandidates,
        request.staffPreference,
        cursor,
        branch.timezone,
      );
      const serviceEnd = cursor.plus({ minutes: service.default_duration_min });
      const staffStart = cursor.minus({
        minutes: service.booking_buffer_before_min,
      });
      const staffEnd = serviceEnd.plus({
        minutes: service.cleanup_time_min + service.booking_buffer_after_min,
      });
      const resourceStart = cursor.minus({
        minutes: service.prep_time_min + service.booking_buffer_before_min,
      });
      const resourceEnd = staffEnd;
      const allocations = await this.allocateResources(
        auth.tenantId,
        body.branchId,
        service.id,
        resourceStart.toUTC().toISO()!,
        resourceEnd.toUTC().toISO()!,
      );
      const fractionDigits = ["VND", "JPY", "KRW"].includes(
        slot.priceReference.currency,
      )
        ? 0
        : 2;
      const amountMinor = Math.round(
        Number(slot.priceReference.amount) * 10 ** fractionDigits,
      );
      if (currency && currency !== slot.priceReference.currency)
        throw new BadRequestException({
          code: "BOOKING_POLICY_CHANGED",
          message: "All service prices must use the same currency",
        });
      currency = slot.priceReference.currency;
      totalMinor += amountMinor;
      planned.push({
        sequenceNo: index + 1,
        serviceId: service.id,
        staffId,
        serviceStartAt: cursor.toUTC().toISO()!,
        serviceEndAt: serviceEnd.toUTC().toISO()!,
        staffOccupancyStartAt: staffStart.toUTC().toISO()!,
        staffOccupancyEndAt: staffEnd.toUTC().toISO()!,
        resourceOccupancyStartAt: resourceStart.toUTC().toISO()!,
        resourceOccupancyEndAt: resourceEnd.toUTC().toISO()!,
        serviceSnapshot: {
          serviceId: service.id,
          code: service.code,
          name: service.name_json,
          durationMin: service.default_duration_min,
          prepTimeMin: service.prep_time_min,
          cleanupTimeMin: service.cleanup_time_min,
          bufferBeforeMin: service.booking_buffer_before_min,
          bufferAfterMin: service.booking_buffer_after_min,
          onlineBookingEnabled: service.online_booking_enabled,
          depositType: service.deposit_type,
          depositValue: service.deposit_value,
          version: service.version,
        },
        priceSnapshot: {
          priceId: slot.priceReference.priceId,
          amount: slot.priceReference.amount,
          amountMinor,
          currency: slot.priceReference.currency,
          source: slot.priceReference.source,
          version: 1,
        },
        taxSnapshot: { taxCode: service.tax_code },
        resourceAllocations: allocations,
        availabilityFingerprint: slot.fingerprint,
      });
      cursor = staffEnd;
    }
    return {
      branchId: body.branchId,
      timezone: branch.timezone,
      startAt: planned[0]!.serviceStartAt,
      endAt: planned.at(-1)!.staffOccupancyEndAt,
      availabilityDataVersion: dataVersion ?? 1,
      items: planned,
      total: {
        amountMinor: totalMinor,
        amount: String(totalMinor),
        currency: currency ?? branch.currency,
      },
    };
  }

  private async selectStaff(
    tenantId: string,
    branchId: string,
    candidates: any[],
    preference: BookingPlanInput["items"][number]["staffPreference"],
    start: DateTime,
    timezone: string,
  ) {
    if (!candidates.length)
      throw new ConflictException({
        code: "STAFF_RESERVED",
        message: "No qualified technician is available",
      });
    if (preference.type === "SPECIFIC") {
      if (!candidates.some((x) => x.staffId === preference.staffId))
        throw new ConflictException({
          code: "APPOINTMENT_ASSIGNMENT_INVALID",
          message: "Selected technician is not available or qualified",
        });
      return preference.staffId;
    }
    const dayStart = start.setZone(timezone).startOf("day").toUTC().toISO();
    const dayEnd = start
      .setZone(timezone)
      .plus({ days: 1 })
      .startOf("day")
      .toUTC()
      .toISO();
    const ids = candidates.map((x) => x.staffId);
    const counts = await this.db.query<{ staff_id: string; count: number }>(
      "SELECT staff_id,count(*)::int count FROM staff_schedule_reservations WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=ANY($3::uuid[]) AND status='ACTIVE' AND start_at<$5 AND end_at>$4 AND (reservation_type='APPOINTMENT' OR expires_at>now()) GROUP BY staff_id",
      [tenantId, branchId, ids, dayStart, dayEnd],
    );
    const map = new Map(counts.rows.map((x) => [x.staff_id, x.count]));
    return [...candidates].sort(
      (a, b) =>
        Number(b.qualificationScore) - Number(a.qualificationScore) ||
        (map.get(a.staffId) ?? 0) - (map.get(b.staffId) ?? 0) ||
        String(a.staffId).localeCompare(String(b.staffId)),
    )[0]!.staffId;
  }

  private async allocateResources(
    tenantId: string,
    branchId: string,
    serviceId: string,
    startAt: string,
    endAt: string,
  ) {
    const requirements = (
      await this.db.query<any>(
        "SELECT resource_type_id,quantity,is_exclusive FROM service_resource_requirements WHERE tenant_id=$1 AND service_id=$2 ORDER BY resource_type_id",
        [tenantId, serviceId],
      )
    ).rows;
    const allocations: Array<{
      resourceId: string;
      quantity: number;
      isExclusive: boolean;
    }> = [];
    for (const requirement of requirements) {
      const candidates = (
        await this.db.query<any>(
          `SELECT r.id,r.capacity,COALESCE(sum(rr.quantity) FILTER (WHERE rr.status='ACTIVE' AND rr.start_at<$5 AND rr.end_at>$4 AND (rr.reservation_type='APPOINTMENT' OR rr.expires_at>now())),0)::int used,COALESCE(bool_or(rr.is_exclusive) FILTER (WHERE rr.status='ACTIVE' AND rr.start_at<$5 AND rr.end_at>$4 AND (rr.reservation_type='APPOINTMENT' OR rr.expires_at>now())),false) exclusive_used FROM resources r LEFT JOIN resource_schedule_reservations rr ON rr.tenant_id=r.tenant_id AND rr.resource_id=r.id WHERE r.tenant_id=$1 AND r.branch_id=$2 AND r.resource_type_id=$3 AND r.status='ACTIVE' AND NOT EXISTS(SELECT 1 FROM availability_blocks b WHERE b.tenant_id=r.tenant_id AND b.branch_id=r.branch_id AND b.resource_id=r.id AND b.status='ACTIVE' AND b.start_at<$5 AND b.end_at>$4) GROUP BY r.id,r.capacity ORDER BY (r.capacity-COALESCE(sum(rr.quantity) FILTER (WHERE rr.status='ACTIVE' AND rr.start_at<$5 AND rr.end_at>$4 AND (rr.reservation_type='APPOINTMENT' OR rr.expires_at>now())),0)) DESC,r.id`,
          [tenantId, branchId, requirement.resource_type_id, startAt, endAt],
        )
      ).rows;
      let needed = Number(requirement.quantity);
      for (const resource of candidates) {
        const available = resource.exclusive_used
          ? 0
          : Number(resource.capacity) - Number(resource.used);
        if (available <= 0) continue;
        const quantity = requirement.is_exclusive
          ? 1
          : Math.min(needed, available);
        allocations.push({
          resourceId: resource.id,
          quantity,
          isExclusive: requirement.is_exclusive,
        });
        needed -= quantity;
        if (needed === 0) break;
      }
      if (needed > 0)
        throw new ConflictException({
          code: "RESOURCE_CAPACITY_INSUFFICIENT",
          message: "Required resource capacity is no longer available",
        });
    }
    return allocations;
  }
}

function changed(message: string) {
  return new ConflictException({
    code: "AVAILABILITY_CHANGED",
    message,
    details: { reasonCodes: ["AVAILABILITY_CHANGED"] },
  });
}

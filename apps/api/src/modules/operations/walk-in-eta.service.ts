/* eslint-disable @typescript-eslint/no-explicit-any */
import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { DateTime } from "luxon";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { AvailabilityService } from "../availability/availability.service.js";
import { BookingService } from "../booking/booking.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import { branchLocalDate, roundUpBranchTime } from "./operational-time.js";

type EtaItem = {
  serviceId: string;
  staffPreference: { type: "ANY" } | { type: "SPECIFIC"; staffId: string };
};

@Injectable()
export class WalkInEtaService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AvailabilityService)
    private readonly availability: AvailabilityService,
    @Inject(BookingService) private readonly booking: BookingService,
  ) {}

  async estimate(
    auth: AccessClaims,
    input: {
      branchId: string;
      items: EtaItem[];
      now?: Date;
      currentWalkInId?: string;
      priority?: "NORMAL" | "RECOVERY" | "MANAGER_OVERRIDE";
    },
  ) {
    const now = input.now ?? new Date(),
      branch = (
        await this.db.query<any>(
          "SELECT id,timezone,status FROM branches WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, input.branchId],
        )
      ).rows[0];
    if (!branch || branch.status !== "ACTIVE")
      throw new ConflictException({
        code: "BRANCH_INACTIVE",
        message: "Branch is not active",
      });

    const localDate = branchLocalDate(now, branch.timezone),
      queue = (
        await this.db.query<any>(
          `SELECT w.id,w.priority,w.status,w.created_at,w.queue_number,
             COALESCE(sum(s.default_duration_min+s.cleanup_time_min+s.booking_buffer_after_min),0)::int workload_minutes
           FROM walk_in_entries w
           LEFT JOIN walk_in_items wi ON wi.tenant_id=w.tenant_id AND wi.walk_in_entry_id=w.id
           LEFT JOIN services s ON s.tenant_id=wi.tenant_id AND s.id=wi.service_id
           WHERE w.tenant_id=$1 AND w.branch_id=$2 AND w.local_queue_date=$3
             AND w.status IN ('WAITING','READY','CALLED')
           GROUP BY w.id
           ORDER BY CASE w.priority WHEN 'MANAGER_OVERRIDE' THEN 0 WHEN 'RECOVERY' THEN 1 ELSE 2 END,
             CASE w.status WHEN 'READY' THEN 0 WHEN 'CALLED' THEN 1 ELSE 2 END,w.created_at,w.queue_number`,
          [auth.tenantId, input.branchId, localDate],
        )
      ).rows;
    const currentIndex = input.currentWalkInId
        ? queue.findIndex((row) => row.id === input.currentWalkInId)
        : -1,
      ahead = currentIndex >= 0 ? queue.slice(0, currentIndex) : queue,
      serviceIds = input.items.map((item) => item.serviceId),
      specificStaffId = input.items.find(
        (item) => item.staffPreference.type === "SPECIFIC",
      )?.staffPreference as { type: "SPECIFIC"; staffId: string } | undefined,
      eligible = Number(
        (
          await this.db.query<any>(
            `SELECT count(DISTINCT sp.id)::int count
             FROM staff_profiles sp
             JOIN staff_branch_assignments sba ON sba.tenant_id=sp.tenant_id AND sba.staff_id=sp.id
             WHERE sp.tenant_id=$1 AND sba.branch_id=$2 AND sp.status='ACTIVE'
               AND sba.status='ACTIVE' AND sba.can_be_booked
               AND sba.effective_from<=$3::date AND (sba.effective_to IS NULL OR sba.effective_to>=$3::date)
               AND ($4::uuid IS NULL OR sp.id=$4)
               AND NOT EXISTS (
                 SELECT 1 FROM service_skill_requirements req
                 WHERE req.tenant_id=sp.tenant_id AND req.service_id=ANY($5::uuid[]) AND req.is_required
                   AND NOT EXISTS (
                     SELECT 1 FROM staff_skills ss
                     WHERE ss.tenant_id=req.tenant_id AND ss.staff_id=sp.id AND ss.skill_id=req.skill_id
                       AND ss.status='ACTIVE' AND ss.proficiency_level>=req.minimum_proficiency
                       AND (ss.expires_at IS NULL OR ss.expires_at>=$3::date)
                   )
               )`,
            [
              auth.tenantId,
              input.branchId,
              localDate,
              specificStaffId?.staffId ?? null,
              serviceIds,
            ],
          )
        ).rows[0]?.count ?? 0,
      );
    const generatedAt = now.toISOString();
    if (eligible < 1)
      return {
        estimateGeneratedAt: generatedAt,
        estimateDisclaimer: "ESTIMATED_NOT_GUARANTEED" as const,
        estimateConfidence: "LOW" as const,
        estimateReasonCodes: ["NO_ELIGIBLE_STAFF"],
      };

    const queueWorkMinutes = Math.ceil(
        ahead.reduce(
          (total, row) => total + Number(row.workload_minutes ?? 0),
          0,
        ) / eligible,
      ),
      roundedNow = roundUpBranchTime(now, branch.timezone, 5),
      from = roundedNow.setZone(branch.timezone).toISODate()!,
      to = roundedNow.setZone(branch.timezone).plus({ days: 6 }).toISODate()!,
      first = input.items[0]!;
    const availability = await this.availability.search(auth, {
      branchId: input.branchId,
      serviceId: first.serviceId,
      dateFrom: from,
      dateTo: to,
      ...(first.staffPreference.type === "SPECIFIC"
        ? { staffId: first.staffPreference.staffId }
        : {}),
      slotIntervalMin: 5,
    });
    const availableSlots = availability.days
      .flatMap((day: any) => day.slots)
      .filter(
        (slot: any) =>
          DateTime.fromISO(slot.startAt, { setZone: true }).toMillis() >=
          roundedNow.toMillis(),
      );
    const baseStart = availableSlots[0]
        ? DateTime.fromISO(availableSlots[0].startAt, { setZone: true })
        : roundedNow,
      earliest = baseStart.plus({ minutes: queueWorkMinutes }),
      candidates = availableSlots
        .filter(
          (slot: any) =>
            DateTime.fromISO(slot.startAt, { setZone: true }).toMillis() >=
            earliest.toMillis(),
        )
        .slice(0, 40);
    for (const slot of candidates) {
      try {
        const plan = await this.booking.plan(auth, {
          branchId: input.branchId,
          desiredStartAt: slot.startAt,
          items: input.items,
        });
        const wait = Math.max(
          0,
          Math.ceil((new Date(plan.startAt).getTime() - now.getTime()) / 60000),
        );
        return {
          estimatedStartAt: plan.startAt,
          estimatedWaitMinutes: wait,
          estimateGeneratedAt: generatedAt,
          estimateDisclaimer: "ESTIMATED_NOT_GUARANTEED" as const,
          estimateConfidence:
            ahead.length === 0 && eligible > 1
              ? ("HIGH" as const)
              : eligible > 1
                ? ("MEDIUM" as const)
                : ("LOW" as const),
          estimateReasonCodes: [
            "SLOT_INTERVAL_ROUNDED",
            ...(ahead.length ? ["QUEUE_WORKLOAD_INCLUDED"] : []),
            ...(eligible > 1 ? ["MULTI_STAFF_CAPACITY"] : []),
          ],
          eligibleStaffCount: eligible,
          queueAheadCount: ahead.length,
          queuedWorkMinutes: queueWorkMinutes,
        };
      } catch {
        // The first service can fit while a later sequential item cannot; try
        // the next concrete Availability Engine slot.
      }
    }
    const reasons = [
      ...new Set(
        availability.days.flatMap(
          (day: any) =>
            day.unavailableReasons?.map((reason: any) => reason.code) ?? [],
        ),
      ),
    ];
    return {
      estimateGeneratedAt: generatedAt,
      estimateDisclaimer: "ESTIMATED_NOT_GUARANTEED" as const,
      estimateConfidence: "LOW" as const,
      estimateReasonCodes: reasons.length ? reasons : ["NO_SEQUENTIAL_SLOT"],
      eligibleStaffCount: eligible,
      queueAheadCount: ahead.length,
      queuedWorkMinutes: queueWorkMinutes,
    };
  }

  async refreshBranch(auth: AccessClaims, branchId: string) {
    const rows = (
      await this.db.query<any>(
        `SELECT w.id,jsonb_agg(jsonb_build_object('serviceId',wi.service_id,'staffPreference',wi.staff_preference_json) ORDER BY wi.sequence_no) items
         FROM walk_in_entries w JOIN walk_in_items wi ON wi.tenant_id=w.tenant_id AND wi.walk_in_entry_id=w.id
         WHERE w.tenant_id=$1 AND w.branch_id=$2 AND w.status IN ('WAITING','READY','CALLED')
         GROUP BY w.id,w.priority,w.status,w.created_at,w.queue_number
         ORDER BY CASE w.priority WHEN 'MANAGER_OVERRIDE' THEN 0 WHEN 'RECOVERY' THEN 1 ELSE 2 END,
           CASE w.status WHEN 'READY' THEN 0 WHEN 'CALLED' THEN 1 ELSE 2 END,w.created_at,w.queue_number`,
        [auth.tenantId, branchId],
      )
    ).rows;
    for (const row of rows) {
      const eta = await this.estimate(auth, {
        branchId,
        items: row.items,
        currentWalkInId: row.id,
      });
      await this.db.query(
        `UPDATE walk_in_entries SET estimated_start_at=$3,estimated_wait_minutes=$4,
           estimate_generated_at=$5,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [
          auth.tenantId,
          row.id,
          eta.estimatedStartAt ?? null,
          eta.estimatedWaitMinutes ?? null,
          eta.estimateGeneratedAt,
        ],
      );
    }
  }
}

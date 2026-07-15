/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import { z } from "zod";
import { DatabaseService } from "../../infrastructure/database.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import type {
  AvailabilityInput,
  AvailabilityReasonCode,
  AvailabilitySlot,
  Reason,
} from "./availability.types.js";
import {
  AvailabilityCacheService,
  availabilityCacheKey,
} from "./availability-cache.service.js";

const querySchema = z.object({
  branchId: z.string().uuid(),
  serviceId: z.string().uuid(),
  dateFrom: z.string().date(),
  dateTo: z.string().date(),
  staffId: z.string().uuid().optional(),
  slotIntervalMin: z.coerce
    .number()
    .int()
    .refine((v) => [5, 10, 15, 30].includes(v), "Invalid slot interval")
    .default(15),
});
const explainSchema = z.object({
  branchId: z.string().uuid(),
  serviceId: z.string().uuid(),
  startAt: z.string().datetime({ offset: true }),
  staffId: z.string().uuid().optional(),
});

@Injectable()
export class AvailabilityService {
  static readonly calculationVersion = 1;
  private readonly logger = new Logger(AvailabilityService.name);
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AvailabilityCacheService)
    private readonly cache: AvailabilityCacheService,
  ) {}

  private owner(a: AccessClaims) {
    return a.roles.includes("SALON_OWNER");
  }
  private guard(a: AccessClaims, branchId: string) {
    if (a.roles.includes("PLATFORM_SUPER_ADMIN"))
      throw new ForbiddenException({
        code: "TENANT_ACCESS_DENIED",
        message: "Platform support grant is required",
      });
    if (!this.owner(a) && !a.branchIds.includes(branchId))
      throw new ForbiddenException({
        code: "AVAILABILITY_BRANCH_NOT_FOUND",
        message: "Branch is outside membership scope",
      });
  }
  parse(input: unknown): AvailabilityInput {
    const r = querySchema.safeParse(input);
    if (!r.success) {
      const interval = (input as any)?.slotIntervalMin;
      if (interval != null && ![5, 10, 15, 30].includes(Number(interval)))
        throw new BadRequestException({
          code: "AVAILABILITY_INVALID_INTERVAL",
          message: "slotIntervalMin must be 5, 10, 15 or 30",
        });
      throw new BadRequestException({
        code: "AVAILABILITY_INVALID_RANGE",
        message: "Invalid availability query",
      });
    }
    const from = DateTime.fromISO(r.data.dateFrom),
      to = DateTime.fromISO(r.data.dateTo);
    const days = Math.floor(to.diff(from, "days").days);
    if (!from.isValid || !to.isValid || days < 0)
      throw new BadRequestException({
        code: "AVAILABILITY_INVALID_RANGE",
        message: "dateTo must be on or after dateFrom",
      });
    if (days > 30)
      throw new BadRequestException({
        code: "AVAILABILITY_RANGE_TOO_LARGE",
        message: "Maximum range is 31 days",
      });
    return r.data as AvailabilityInput;
  }
  private overlap(aStart: number, aEnd: number, bStart: any, bEnd: any) {
    return (
      new Date(bStart).getTime() < aEnd && new Date(bEnd).getTime() > aStart
    );
  }
  private dateOnly(value: any) {
    return value instanceof Date
      ? value.toISOString().slice(0, 10)
      : String(value).slice(0, 10);
  }
  private fingerprint(parts: unknown) {
    return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  }
  private reason(
    map: Map<AvailabilityReasonCode, number>,
    code: AvailabilityReasonCode,
  ) {
    map.set(code, (map.get(code) ?? 0) + 1);
  }
  private localInstants(date: string, time: string, zone: string) {
    const [hour, minute] = time.split(":").map(Number);
    const base = DateTime.fromISO(date, { zone }).set({
      hour,
      minute,
      second: 0,
      millisecond: 0,
    });
    if (!base.isValid || base.hour !== hour || base.minute !== minute)
      return { values: [] as DateTime[], gap: true, ambiguous: false };
    const possible = base.getPossibleOffsets();
    return {
      values: possible.length ? possible : [base],
      gap: false,
      ambiguous: possible.length > 1,
    };
  }
  private async sources(auth: AccessClaims, q: AvailabilityInput) {
    this.guard(auth, q.branchId);
    const branch = (
      await this.db.query<any>(
        "SELECT id,timezone,status FROM branches WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, q.branchId],
      )
    ).rows[0];
    if (!branch)
      throw new NotFoundException({
        code: "AVAILABILITY_BRANCH_NOT_FOUND",
        message: "Branch not found",
      });
    if (branch.status !== "ACTIVE")
      throw new ConflictException({
        code: "AVAILABILITY_BRANCH_INACTIVE",
        message: "The branch is not available for scheduling.",
      });
    if (!DateTime.local().setZone(branch.timezone).isValid)
      throw new BadRequestException({
        code: "AVAILABILITY_TIMEZONE_INVALID",
        message: "Branch timezone is invalid",
      });
    const service = (
      await this.db.query<any>(
        "SELECT id,name_json,default_duration_min,prep_time_min,cleanup_time_min,booking_buffer_before_min,booking_buffer_after_min,status,version FROM services WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, q.serviceId],
      )
    ).rows[0];
    if (!service)
      throw new NotFoundException({
        code: "AVAILABILITY_SERVICE_NOT_FOUND",
        message: "Service not found",
      });
    if (service.status !== "ACTIVE")
      throw new BadRequestException({
        code: "AVAILABILITY_SERVICE_NOT_ACTIVE",
        message: "Service is not active",
      });
    const padFrom = DateTime.fromISO(q.dateFrom, { zone: branch.timezone })
      .minus({ days: 1 })
      .toUTC()
      .toISO();
    const padTo = DateTime.fromISO(q.dateTo, { zone: branch.timezone })
      .plus({ days: 2 })
      .toUTC()
      .toISO();
    const results = await Promise.all([
      this.db.query<any>(
        "SELECT * FROM business_hours WHERE tenant_id=$1 AND branch_id=$2 AND valid_from<=$4::date AND (valid_to IS NULL OR valid_to>=$3::date) ORDER BY valid_from DESC",
        [auth.tenantId, q.branchId, q.dateFrom, q.dateTo],
      ),
      this.db.query<any>(
        "SELECT sp.id,sp.display_name,sp.version,a.effective_from,a.effective_to,a.can_be_booked FROM staff_profiles sp JOIN staff_branch_assignments a ON a.tenant_id=sp.tenant_id AND a.staff_id=sp.id WHERE sp.tenant_id=$1 AND a.branch_id=$2 AND sp.status='ACTIVE' AND a.status='ACTIVE' AND a.effective_from<=$4::date AND (a.effective_to IS NULL OR a.effective_to>=$3::date) AND ($5::uuid IS NULL OR sp.id=$5)",
        [auth.tenantId, q.branchId, q.dateFrom, q.dateTo, q.staffId ?? null],
      ),
      this.db.query<any>(
        "SELECT * FROM service_skill_requirements WHERE tenant_id=$1 AND service_id=$2 AND is_required",
        [auth.tenantId, q.serviceId],
      ),
      this.db.query<any>(
        "SELECT * FROM staff_skills WHERE tenant_id=$1 AND status='ACTIVE'",
        [auth.tenantId],
      ),
      this.db.query<any>(
        "SELECT * FROM shifts WHERE tenant_id=$1 AND branch_id=$2 AND status='PUBLISHED' AND start_at<$4 AND end_at>$3",
        [auth.tenantId, q.branchId, padFrom, padTo],
      ),
      this.db.query<any>(
        "SELECT * FROM leave_requests WHERE tenant_id=$1 AND (branch_id=$2 OR branch_id IS NULL) AND status='APPROVED' AND start_at<$4 AND end_at>$3",
        [auth.tenantId, q.branchId, padFrom, padTo],
      ),
      this.db.query<any>(
        "SELECT * FROM availability_blocks WHERE tenant_id=$1 AND branch_id=$2 AND status='ACTIVE' AND start_at<$4 AND end_at>$3",
        [auth.tenantId, q.branchId, padFrom, padTo],
      ),
      this.db.query<any>(
        "SELECT * FROM service_resource_requirements WHERE tenant_id=$1 AND service_id=$2",
        [auth.tenantId, q.serviceId],
      ),
      this.db.query<any>(
        "SELECT * FROM resources WHERE tenant_id=$1 AND branch_id=$2",
        [auth.tenantId, q.branchId],
      ),
      this.db.query<any>(
        "SELECT * FROM service_prices WHERE tenant_id=$1 AND service_id=$2 AND status='ACTIVE' AND (branch_id=$3 OR branch_id IS NULL) ORDER BY (branch_id IS NOT NULL) DESC,effective_from DESC",
        [auth.tenantId, q.serviceId, q.branchId],
      ),
      this.db.query<any>(
        "SELECT version FROM availability_versions WHERE tenant_id=$1 AND branch_id=$2",
        [auth.tenantId, q.branchId],
      ),
    ]);
    if (q.staffId && !results[1].rows.length) {
      const exists = (
        await this.db.query<any>(
          "SELECT 1 FROM staff_profiles WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, q.staffId],
        )
      ).rowCount;
      if (!exists)
        throw new NotFoundException({
          code: "AVAILABILITY_STAFF_NOT_FOUND",
          message: "Staff not found",
        });
      throw new ForbiddenException({
        code: "AVAILABILITY_STAFF_OUT_OF_SCOPE",
        message: "Staff is not active and bookable in branch scope",
      });
    }
    return {
      branch,
      service,
      hours: results[0].rows,
      staff: results[1].rows,
      skillReq: results[2].rows,
      staffSkills: results[3].rows,
      shifts: results[4].rows,
      leaves: results[5].rows,
      blocks: results[6].rows,
      resourceReq: results[7].rows,
      resources: results[8].rows,
      prices: results[9].rows,
      dataVersion: Number(results[10].rows[0]?.version ?? 1),
    };
  }
  private evaluate(
    s: any,
    date: string,
    start: DateTime,
    reasons: Map<AvailabilityReasonCode, number>,
  ) {
    const duration = s.service.default_duration_min,
      prep = s.service.prep_time_min,
      cleanup = s.service.cleanup_time_min,
      before = s.service.booking_buffer_before_min,
      after = s.service.booking_buffer_after_min;
    const startMs = start.toMillis(),
      end = start.plus({ minutes: duration }).toMillis(),
      staffStart = start.minus({ minutes: before }).toMillis(),
      staffEnd = start.plus({ minutes: duration + cleanup + after }).toMillis(),
      resourceStart = start.minus({ minutes: prep + before }).toMillis(),
      resourceEnd = staffEnd;
    const eligible: any[] = [];
    const staffReasons = new Map<AvailabilityReasonCode, number>();
    for (const person of s.staff) {
      if (!person.can_be_booked) {
        this.reason(staffReasons, "STAFF_NOT_BOOKABLE");
        continue;
      }
      if (
        date < this.dateOnly(person.effective_from) ||
        (person.effective_to && date > this.dateOnly(person.effective_to))
      ) {
        this.reason(staffReasons, "STAFF_NOT_ASSIGNED");
        continue;
      }
      let skillFail = false,
        score = 0;
      for (const req of s.skillReq) {
        const skill = s.staffSkills.find(
          (x: any) => x.staff_id === person.id && x.skill_id === req.skill_id,
        );
        if (!skill) {
          this.reason(staffReasons, "STAFF_SKILL_MISSING");
          skillFail = true;
          break;
        }
        if (skill.proficiency_level < req.minimum_proficiency) {
          this.reason(staffReasons, "STAFF_PROFICIENCY_TOO_LOW");
          skillFail = true;
          break;
        }
        if (skill.expires_at && this.dateOnly(skill.expires_at) < date) {
          this.reason(staffReasons, "STAFF_SKILL_EXPIRED");
          skillFail = true;
          break;
        }
        score += skill.proficiency_level;
      }
      if (skillFail) continue;
      const shift = s.shifts.find(
        (x: any) =>
          x.staff_id === person.id &&
          new Date(x.start_at).getTime() <= staffStart &&
          new Date(x.end_at).getTime() >= staffEnd,
      );
      if (!shift) {
        this.reason(staffReasons, "NO_PUBLISHED_SHIFT");
        continue;
      }
      const leave = s.leaves.find(
        (x: any) =>
          x.staff_id === person.id &&
          this.overlap(staffStart, staffEnd, x.start_at, x.end_at),
      );
      if (leave) {
        this.reason(staffReasons, "STAFF_ON_APPROVED_LEAVE");
        continue;
      }
      const block = s.blocks.find(
        (x: any) =>
          x.staff_id === person.id &&
          this.overlap(staffStart, staffEnd, x.start_at, x.end_at),
      );
      if (block) {
        this.reason(staffReasons, "STAFF_BUSY");
        continue;
      }
      eligible.push({
        staffId: person.id,
        displayName: person.display_name,
        qualificationScore: s.skillReq.length
          ? Number((score / s.skillReq.length).toFixed(2))
          : 5,
        sourceVersions: [person.version, shift.version],
      });
    }
    if (!eligible.length) {
      for (const [code, count] of staffReasons)
        reasons.set(code, (reasons.get(code) ?? 0) + count);
      this.reason(reasons, "NO_ELIGIBLE_STAFF");
    }
    const resourceSummary: any[] = [];
    let resourceOk = true;
    let resourceMaintenance = false;
    let resourceMaintenanceBlocking = false;
    for (const req of s.resourceReq) {
      const matching = s.resources.filter(
        (r: any) => r.resource_type_id === req.resource_type_id,
      );
      const active = matching.filter(
        (r: any) =>
          r.status === "ACTIVE" &&
          !s.blocks.some(
            (b: any) =>
              b.resource_id === r.id &&
              this.overlap(resourceStart, resourceEnd, b.start_at, b.end_at),
          ),
      );
      const available = active.reduce(
        (n: number, r: any) => n + (req.is_exclusive ? 1 : r.capacity),
        0,
      );
      const hasMaintenance = matching.some(
        (r: any) => r.status === "MAINTENANCE",
      );
      resourceMaintenance ||= hasMaintenance;
      if (available < req.quantity) {
        this.reason(reasons, "RESOURCE_CAPACITY_INSUFFICIENT");
        resourceOk = false;
        resourceMaintenanceBlocking ||= hasMaintenance;
      }
      resourceSummary.push({
        resourceTypeId: req.resource_type_id,
        required: req.quantity,
        available,
      });
    }
    const price = s.prices.find(
      (p: any) =>
        new Date(p.effective_from).getTime() <= startMs &&
        (!p.effective_to || new Date(p.effective_to).getTime() > startMs),
    );
    if (!price) this.reason(reasons, "NO_ACTIVE_PRICE");
    return {
      ok: eligible.length > 0 && resourceOk && !!price,
      endMs: end,
      end: start.plus({ minutes: duration }),
      eligible,
      resourceSummary,
      resourceMaintenance,
      resourceMaintenanceBlocking,
      price,
      versions: [
        ...eligible.flatMap((x: any) => x.sourceVersions),
        ...s.resources.map((x: any) => x.version),
        ...s.blocks.map((x: any) => x.version),
        ...s.leaves.map((x: any) => x.version),
      ],
    };
  }
  async search(auth: AccessClaims, input: unknown) {
    const started = performance.now();
    const q = this.parse(input);
    this.guard(auth, q.branchId);
    const version = Number(
      (
        await this.db.query<any>(
          "SELECT version FROM availability_versions WHERE tenant_id=$1 AND branch_id=$2",
          [auth.tenantId, q.branchId],
        )
      ).rows[0]?.version ?? 1,
    );
    const key = availabilityCacheKey(auth.tenantId, q, version);
    const cached = await this.cache.get(key);
    if (cached) {
      const result = JSON.parse(cached);
      result.cache = { hit: true, ttlSeconds: 45 };
      this.logQuery(auth, q, result, "hit", started);
      return result;
    }
    const result = await this.calculate(auth, q);
    await this.cache.set(key, result);
    this.logQuery(auth, q, result, "miss", started);
    return result;
  }
  private logQuery(
    auth: AccessClaims,
    q: AvailabilityInput,
    result: any,
    cache: "hit" | "miss",
    started: number,
  ) {
    this.logger.log({
      event: "availability.query",
      tenantId: auth.tenantId,
      branchId: q.branchId,
      serviceId: q.serviceId,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      cache,
      durationMs: Number((performance.now() - started).toFixed(2)),
      slotCount: result.days.reduce(
        (n: number, d: any) => n + d.slots.length,
        0,
      ),
    });
  }
  private async calculate(auth: AccessClaims, q: AvailabilityInput) {
    const s = await this.sources(auth, q),
      days: any[] = [];
    let date = DateTime.fromISO(q.dateFrom);
    while (date <= DateTime.fromISO(q.dateTo)) {
      const localDate = date.toISODate()!;
      const reasons = new Map<AvailabilityReasonCode, number>();
      const dayHours = s.hours.find(
        (h: any) =>
          h.day_of_week === date.weekday % 7 &&
          this.dateOnly(h.valid_from) <= localDate &&
          (!h.valid_to || this.dateOnly(h.valid_to) >= localDate),
      );
      const slots: AvailabilitySlot[] = [];
      const seenStarts = new Set<string>();
      if (!dayHours || dayHours.is_closed) {
        this.reason(reasons, "BRANCH_CLOSED");
      } else {
        const opened = this.localInstants(
            localDate,
            String(dayHours.open_time),
            s.branch.timezone,
          ),
          closed = this.localInstants(
            localDate,
            String(dayHours.close_time),
            s.branch.timezone,
          );
        if (opened.gap || closed.gap) this.reason(reasons, "DST_GAP");
        const open = opened.values[0],
          close = closed.values.at(-1);
        if (open && close) {
          for (
            let cursor = open;
            cursor < close;
            cursor = cursor.plus({ minutes: q.slotIntervalMin })
          ) {
            const local = this.localInstants(
              localDate,
              cursor.toFormat("HH:mm"),
              s.branch.timezone,
            );
            if (local.gap) {
              this.reason(reasons, "DST_GAP");
              continue;
            }
            if (local.ambiguous) this.reason(reasons, "DST_AMBIGUOUS");
            for (const instant of local.values) {
              const resourceStart = instant.minus({
                minutes:
                  s.service.prep_time_min + s.service.booking_buffer_before_min,
              });
              const occupancyEnd = instant.plus({
                minutes:
                  s.service.default_duration_min +
                  s.service.cleanup_time_min +
                  s.service.booking_buffer_after_min,
              });
              if (resourceStart < open || occupancyEnd > close) {
                this.reason(reasons, "OUTSIDE_BUSINESS_HOURS");
                continue;
              }
              const evaluated = this.evaluate(s, localDate, instant, reasons);
              if (!evaluated.ok) continue;
              slots.push({
                startAt: instant.toUTC().toISO()!,
                endAt: evaluated.end.toUTC().toISO()!,
                localStart: instant.toISO()!,
                localEnd: evaluated.end.toISO()!,
                staffCandidates: evaluated.eligible.map((candidate: any) => ({
                  staffId: candidate.staffId,
                  displayName: candidate.displayName,
                  qualificationScore: candidate.qualificationScore,
                })),
                resourceSummary: evaluated.resourceSummary,
                priceReference: {
                  priceId: evaluated.price.id,
                  amount: String(evaluated.price.amount),
                  currency: evaluated.price.currency,
                  source: evaluated.price.branch_id
                    ? "BRANCH_PRICE"
                    : "TENANT_DEFAULT",
                },
                fingerprint: this.fingerprint([
                  auth.tenantId,
                  q.branchId,
                  q.serviceId,
                  instant.toUTC().toISO(),
                  evaluated.end.toUTC().toISO(),
                  evaluated.eligible.map((x: any) => x.staffId).sort(),
                  s.service.version,
                  evaluated.price.version,
                  evaluated.versions.sort(),
                  s.dataVersion,
                  AvailabilityService.calculationVersion,
                ]),
              });
            }
          }
        }
      }
      for (let i = slots.length - 1; i >= 0; i--) {
        if (seenStarts.has(slots[i]!.startAt)) slots.splice(i, 1);
        else seenStarts.add(slots[i]!.startAt);
      }
      days.push({
        localDate,
        slots,
        ...(!slots.length
          ? {
              unavailableReasons: [...reasons].map(([code, count]) => ({
                code,
                count,
              })),
            }
          : {}),
      });
      date = date.plus({ days: 1 });
    }
    const generatedAt = new Date();
    return {
      branchId: q.branchId,
      serviceId: q.serviceId,
      timezone: s.branch.timezone,
      generatedAt: generatedAt.toISOString(),
      validUntil: new Date(generatedAt.getTime() + 45_000).toISOString(),
      calculationVersion: AvailabilityService.calculationVersion,
      dataVersion: s.dataVersion,
      cache: { hit: false, ttlSeconds: 45 },
      days,
    };
  }
  async explain(auth: AccessClaims, input: unknown) {
    const b = explainSchema.parse(input);
    const at = DateTime.fromISO(b.startAt, { setZone: true });
    const zone=(await this.db.query<any>("SELECT timezone FROM branches WHERE tenant_id=$1 AND id=$2",[auth.tenantId,b.branchId])).rows[0]?.timezone??"UTC";
    const localAt=at.setZone(zone),localDate=localAt.toISODate()!;
    const q=this.parse({
      branchId: b.branchId,
      serviceId: b.serviceId,
      dateFrom: localDate,
      dateTo: localDate,
      staffId: b.staffId,
      slotIntervalMin: 5,
    });
    const s=await this.sources(auth,q),reasonCounts=new Map<AvailabilityReasonCode,number>();
    const day=DateTime.fromISO(localDate),hours=s.hours.find((h:any)=>h.day_of_week===day.weekday%7&&this.dateOnly(h.valid_from)<=localDate&&(!h.valid_to||this.dateOnly(h.valid_to)>=localDate));
    let businessHours=false;
    if(!hours||hours.is_closed)this.reason(reasonCounts,"BRANCH_CLOSED");else{const opened=this.localInstants(localDate,String(hours.open_time),zone),closed=this.localInstants(localDate,String(hours.close_time),zone);if(opened.gap||closed.gap)this.reason(reasonCounts,"DST_GAP");const open=opened.values[0],close=closed.values.at(-1),resourceStart=localAt.minus({minutes:s.service.prep_time_min+s.service.booking_buffer_before_min}),occupancyEnd=localAt.plus({minutes:s.service.default_duration_min+s.service.cleanup_time_min+s.service.booking_buffer_after_min});businessHours=!!open&&!!close&&resourceStart>=open&&occupancyEnd<=close;if(!businessHours)this.reason(reasonCounts,"OUTSIDE_BUSINESS_HOURS");}
    const localCandidates=this.localInstants(localDate,localAt.toFormat("HH:mm"),zone);if(localCandidates.gap)this.reason(reasonCounts,"DST_GAP");if(localCandidates.ambiguous)this.reason(reasonCounts,"DST_AMBIGUOUS");
    const evaluated=this.evaluate(s,localDate,localAt,reasonCounts),available=businessHours&&evaluated.ok;
    const blockingReasons:Reason[]=[...reasonCounts]
      .filter(([code])=>code!=="DST_AMBIGUOUS")
      .map(([code,count])=>({code,count}));
    if(evaluated.resourceMaintenanceBlocking)
      blockingReasons.push({code:"RESOURCE_MAINTENANCE",count:1});
    const warnings:Reason[]=[];
    if(reasonCounts.has("DST_AMBIGUOUS"))warnings.push({code:"DST_AMBIGUOUS",count:reasonCounts.get("DST_AMBIGUOUS")!});
    if(evaluated.resourceMaintenance&&!evaluated.resourceMaintenanceBlocking)
      warnings.push({code:"RESOURCE_MAINTENANCE",count:1});
    const reasons=blockingReasons;
    return {
      available,
      startAt: at.toUTC().toISO(),
      timezone:zone,
      reasons,
      blockingReasons,
      warnings,
      rules: {
        businessHours,
        staff: !reasons.some(
          (x) =>
            x.code.includes("STAFF") ||
            x.code === "NO_ELIGIBLE_STAFF" ||
            x.code === "NO_PUBLISHED_SHIFT",
        ),
        resources: !blockingReasons.some((x) => x.code.startsWith("RESOURCE")),
        price: !reasons.some((x) => x.code === "NO_ACTIVE_PRICE"),
        timezone:!reasons.some((x)=>["TIMEZONE_INVALID","DST_GAP"].includes(x.code)),
      },
      resourceSummary:evaluated.resourceSummary,
      staffCandidates:evaluated.eligible.map((x:any)=>({staffId:x.staffId,displayName:x.displayName,qualificationScore:x.qualificationScore})),
    };
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  createCipheriv,
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
} from "node:crypto";
import {
  createSlotHoldSchema,
  publicCreateAppointmentSchema,
} from "@nailsoft/validation";
import { DateTime } from "luxon";
import { z } from "zod";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { AvailabilityService } from "../availability/availability.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import { BookingService } from "./booking.service.js";
import { BookingTokenService } from "./booking-token.service.js";

const contactSchema = z.object({
  contact: z.string().trim().min(3).max(254),
  channel: z.enum(["SMS", "EMAIL"]).default("SMS"),
});
const accessRequestSchema = contactSchema.extend({
  bookingReference: z.string().trim().min(4).max(20),
});
const verifySchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
});

@Injectable()
export class PublicBookingService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AvailabilityService)
    private readonly availability: AvailabilityService,
    @Inject(BookingService) private readonly booking: BookingService,
    @Inject(BookingTokenService) private readonly tokens: BookingTokenService,
  ) {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.PUBLIC_BOOKING_ENABLED === "true" &&
      (!process.env.OTP_PEPPER ||
        process.env.OTP_PROVIDER !== "webhook" ||
        !process.env.OTP_PROVIDER_URL)
    )
      throw new Error(
        "OTP_PEPPER, OTP_PROVIDER=webhook and OTP_PROVIDER_URL are required when public booking is enabled",
      );
  }

  async salon(slug: string) {
    this.assertEnabled();
    const row = await this.tenant(slug);
    return {
      slug: row.slug,
      name: row.name,
      locale: row.default_locale,
      currency: row.currency,
      timezone: row.timezone,
    };
  }
  async branches(slug: string) {
    this.assertEnabled();
    const t = await this.tenant(slug);
    return (
      await this.db.query<any>(
        "SELECT b.id,b.name,b.code,b.timezone,ts.booking_policy_json tenant_policy_json,bs.booking_policy_json branch_policy_json FROM branches b JOIN tenant_settings ts ON ts.tenant_id=b.tenant_id LEFT JOIN branch_settings bs ON bs.tenant_id=b.tenant_id AND bs.branch_id=b.id WHERE b.tenant_id=$1 AND b.status='ACTIVE' ORDER BY b.name",
        [t.id],
      )
    ).rows.map((x) => {
      const policy = {
        ...(x.tenant_policy_json ?? {}),
        ...(x.branch_policy_json ?? {}),
      };
      const now = DateTime.now().setZone(x.timezone);
      const earliest = now.plus({
        minutes: Number(policy.minimumAdvanceMinutes ?? 60),
      });
      const latest = now.plus({
        days: Number(policy.maximumAdvanceDays ?? 90),
      });
      return {
        id: x.id,
        name: x.name,
        code: x.code,
        timezone: x.timezone,
        policy: {
          allowAnyTechnician: policy.allowAnyTechnician !== false,
          allowCustomerSelectStaff: policy.allowCustomerSelectStaff !== false,
          hideStaffNames: policy.hideStaffNamesOnPublicBooking === true,
          maxItems: Number(policy.maxItems ?? 5),
          minimumAdvanceMinutes: Number(policy.minimumAdvanceMinutes ?? 60),
          maximumAdvanceDays: Number(policy.maximumAdvanceDays ?? 90),
          version: Number(policy.version ?? 1),
          summary: policy.policySummary ?? "Booking and cancellation policy",
          documentUrl: policy.policyDocumentUrl ?? null,
        },
        bookingWindow: {
          earliestDate: earliest.toISODate(),
          latestDate: latest.toISODate(),
          timezone: x.timezone,
        },
      };
    });
  }
  async services(slug: string, branchId?: string) {
    this.assertEnabled();
    const t = await this.tenant(slug);
    if (branchId) await this.branchPolicy(t.id, branchId);
    return (
      await this.db.query<any>(
        `SELECT s.id,s.code,s.name_json,s.description_json,s.default_duration_min,s.prep_time_min,s.cleanup_time_min,s.booking_buffer_before_min,s.booking_buffer_after_min,s.version,p.amount,p.currency,p.id price_id FROM services s JOIN LATERAL(SELECT sp.* FROM service_prices sp WHERE sp.tenant_id=s.tenant_id AND sp.service_id=s.id AND sp.status='ACTIVE' AND (sp.branch_id=$2::uuid OR sp.branch_id IS NULL) AND sp.effective_from<=now() AND (sp.effective_to IS NULL OR sp.effective_to>now()) ORDER BY (sp.branch_id IS NOT NULL) DESC LIMIT 1)p ON true WHERE s.tenant_id=$1 AND s.status='ACTIVE' AND s.online_booking_enabled ORDER BY s.code`,
        [t.id, branchId ?? null],
      )
    ).rows.map((x) => ({
      id: x.id,
      code: x.code,
      name: x.name_json,
      description: x.description_json,
      durationMin: x.default_duration_min,
      prepTimeMin: x.prep_time_min,
      cleanupTimeMin: x.cleanup_time_min,
      bufferBeforeMin: x.booking_buffer_before_min,
      bufferAfterMin: x.booking_buffer_after_min,
      price: { amount: String(x.amount), currency: x.currency },
      version: x.version,
    }));
  }
  async staff(slug: string, branchId: string) {
    this.assertEnabled();
    const tenant = await this.tenant(slug);
    const policy = await this.branchPolicy(tenant.id, branchId);
    if (
      policy.allowCustomerSelectStaff === false ||
      policy.hideStaffNamesOnPublicBooking === true
    )
      return [];
    return (
      await this.db.query<{ id: string; display_name: string }>(
        "SELECT DISTINCT sp.id,sp.display_name FROM staff_profiles sp JOIN staff_branch_assignments assignment ON assignment.tenant_id=sp.tenant_id AND assignment.staff_id=sp.id WHERE sp.tenant_id=$1 AND assignment.branch_id=$2 AND sp.status='ACTIVE' AND assignment.status='ACTIVE' AND assignment.can_be_booked=true AND assignment.effective_from<=current_date AND (assignment.effective_to IS NULL OR assignment.effective_to>=current_date) ORDER BY sp.display_name,sp.id",
        [tenant.id, branchId],
      )
    ).rows.map((row) => ({ id: row.id, displayName: row.display_name }));
  }
  async search(slug: string, input: any, ip: string) {
    this.assertEnabled();
    const t = await this.tenant(slug);
    await this.rate(`availability:${t.id}:${ip}`, 120);
    const branch = await this.branchPolicy(t.id, input.branchId);
    if (
      input.staffId &&
      (branch.allowCustomerSelectStaff === false ||
        branch.hideStaffNamesOnPublicBooking === true)
    )
      throw new ForbiddenException({
        code: "PUBLIC_STAFF_SELECTION_NOT_ALLOWED",
        message: "Customers cannot select a technician for this branch",
      });
    if (!input.staffId && branch.allowAnyTechnician === false)
      throw new ForbiddenException({
        code: "PUBLIC_ANY_TECHNICIAN_NOT_ALLOWED",
        message: "A technician must be selected for this branch",
      });
    await this.assertPublicServices(
      t.id,
      input.serviceId ? [input.serviceId] : [],
    );
    const result = await this.availability.search(
      this.auth(t.id, input.branchId),
      input,
    );
    if (branch.hideStaffNamesOnPublicBooking === true)
      return {
        ...result,
        days: result.days.map((day: any) => ({
          ...day,
          slots: day.slots.map((slot: any) => ({
            ...slot,
            staffCandidates: [],
          })),
        })),
      };
    if (branch.allowCustomerSelectStaff === false)
      return {
        ...result,
        days: result.days.map((day: any) => ({
          ...day,
          slots: day.slots.map((slot: any) => ({
            ...slot,
            staffCandidates: [],
          })),
        })),
      };
    return result;
  }
  async createHold(
    slug: string,
    input: any,
    key: string,
    requestId: string,
    ip: string,
  ) {
    this.assertEnabled();
    const t = await this.tenant(slug);
    const body = createSlotHoldSchema.parse({
      ...input,
      source: "CUSTOMER_WEB",
    });
    await this.assertPublicPlan(t.id, body);
    const clientKey = String(input.clientKey ?? ip);
    await this.rate(`hold:${t.id}:${this.booking.contactHash(clientKey)}`, 20);
    return this.booking.createHold(
      this.auth(t.id, body.branchId),
      { ...input, source: "CUSTOMER_WEB", clientKey },
      key,
      requestId,
      `public-hold:${t.id}:${this.booking.contactHash(clientKey)}`,
      true,
    );
  }
  async verifyHoldToken(tenantId: string, holdId: string, token: string) {
    const hold = (
      await this.db.query<any>(
        "SELECT public_token_version FROM slot_holds WHERE tenant_id=$1 AND id=$2",
        [tenantId, holdId],
      )
    ).rows[0];
    if (!hold)
      throw new NotFoundException({
        code: "SLOT_HOLD_NOT_FOUND",
        message: "Slot hold not found",
      });
    await this.tokens.verifyHold(token, {
      tenantId,
      holdId,
      tokenVersion: hold.public_token_version,
    });
  }
  async createBooking(
    slug: string,
    input: any,
    key: string,
    requestId: string,
    ip: string,
  ) {
    this.assertEnabled();
    const t = await this.tenant(slug);
    const body = publicCreateAppointmentSchema.parse(input);
    await this.rate(`booking:${t.id}:${ip}`, 20);
    const hold = (
      await this.db.query<any>(
        "SELECT branch_id FROM slot_holds WHERE tenant_id=$1 AND id=$2",
        [t.id, body.holdId],
      )
    ).rows[0];
    if (!hold)
      throw new NotFoundException({
        code: "SLOT_HOLD_NOT_FOUND",
        message: "Slot hold not found",
      });
    return this.booking.createAppointment(
      this.auth(t.id, hold.branch_id),
      body,
      key,
      requestId,
      { public: true },
    );
  }

  async requestContact(slug: string, input: unknown, ip: string) {
    this.assertEnabled();
    const t = await this.tenant(slug),
      body = contactSchema.parse(input),
      normalized = this.booking.normalizeContact(body.contact),
      hash = this.booking.contactHash(normalized);
    await this.rate(`contact:${t.id}:${hash}:${ip}`, 5);
    const id = randomUUID(),
      code = this.code();
    await this.db.transaction(async (client) => {
      await client.query(
        "INSERT INTO booking_access_challenges(id,tenant_id,booking_reference,contact_hash,channel,purpose,code_hash,expires_at,request_ip) VALUES($1,$2,'PREBOOK',$3,$4,'BOOKING_CONFIRMATION',$5,now()+interval '5 minutes',$6)",
        [id, t.id, hash, body.channel, this.codeHash(id, code), ip],
      );
      await this.queueOtp(client, {
        tenantId: t.id,
        challengeId: id,
        purpose: "BOOKING_CONFIRMATION",
        channel: body.channel,
        destination: normalized,
        code,
      });
    });
    return {
      challengeId: id,
      expiresIn: 300,
      resendAfter: 60,
      ...(process.env.NODE_ENV !== "production" ? { testCode: code } : {}),
    };
  }
  async verifyContact(slug: string, input: unknown, ip: string) {
    this.assertEnabled();
    const tenant = await this.tenant(slug);
    const body = verifySchema.parse(input);
    await this.rate(`contact-verify:${tenant.id}:${ip}`, 10);
    const challenge = await this.consumeChallenge(
      tenant.id,
      body.challengeId,
      body.code,
      "BOOKING_CONFIRMATION",
    );
    if (challenge.tenant_id !== tenant.id)
      throw new UnauthorizedException({
        code: "BOOKING_ACCESS_DENIED",
        message: "Booking verification failed",
      });
    return {
      verificationToken: await this.tokens.contact({
        tenantId: challenge.tenant_id,
        contactHash: challenge.contact_hash,
        challengeId: challenge.id,
      }),
      expiresIn: 600,
    };
  }

  async requestAccess(slug: string, input: unknown, ip: string) {
    this.assertEnabled();
    const tenant = await this.tenant(slug);
    const body = accessRequestSchema.parse(input),
      reference = body.bookingReference.toUpperCase(),
      normalized = this.booking.normalizeContact(body.contact),
      hash = this.booking.contactHash(normalized);
    await this.rate(`booking-access:${tenant.id}:${hash}:${ip}`, 5);
    const match = (
      await this.db.query<any>(
        "SELECT a.tenant_id,a.id,a.branch_id FROM appointments a WHERE a.tenant_id=$1 AND lower(a.booking_reference)=lower($2) AND (a.contact_snapshot_json->>'phone'=$3 OR lower(COALESCE(a.contact_snapshot_json->>'email',''))=lower($3)) ORDER BY a.created_at DESC LIMIT 1",
        [tenant.id, reference, normalized],
      )
    ).rows[0];
    const challengeId = randomUUID(),
      code = this.code();
    if (match)
      await this.db.transaction(async (client) => {
        await client.query(
          "INSERT INTO booking_access_challenges(id,tenant_id,appointment_id,booking_reference,contact_hash,channel,purpose,code_hash,expires_at,request_ip) VALUES($1,$2,$3,$4,$5,$6,'BOOKING_ACCESS',$7,now()+interval '5 minutes',$8)",
          [
            challengeId,
            match.tenant_id,
            match.id,
            reference,
            hash,
            body.channel,
            this.codeHash(challengeId, code),
            ip,
          ],
        );
        await this.queueOtp(client, {
          tenantId: match.tenant_id,
          challengeId,
          purpose: "BOOKING_ACCESS",
          channel: body.channel,
          destination: normalized,
          code,
        });
      });
    return {
      challengeId,
      expiresIn: 300,
      resendAfter: 60,
      message:
        "If the booking details match, a verification code has been sent.",
      ...(process.env.NODE_ENV !== "production" && match
        ? { testCode: code }
        : {}),
    };
  }
  async verifyAccess(slug: string, input: unknown, ip: string) {
    this.assertEnabled();
    const tenant = await this.tenant(slug);
    const body = verifySchema.parse(input);
    await this.rate(`booking-access-verify:${tenant.id}:${ip}`, 10);
    const challenge = await this.consumeChallenge(
      tenant.id,
      body.challengeId,
      body.code,
      "BOOKING_ACCESS",
    );
    if (challenge.tenant_id !== tenant.id)
      throw new UnauthorizedException({
        code: "BOOKING_ACCESS_DENIED",
        message: "Booking verification failed",
      });
    if (!challenge.appointment_id)
      throw new UnauthorizedException({
        code: "BOOKING_ACCESS_DENIED",
        message: "Booking verification failed",
      });
    const appointment = (
      await this.db.query<any>(
        "SELECT id,tenant_id,booking_reference,contact_verification_version FROM appointments WHERE tenant_id=$1 AND id=$2",
        [challenge.tenant_id, challenge.appointment_id],
      )
    ).rows[0];
    if (!appointment)
      throw new UnauthorizedException({
        code: "BOOKING_ACCESS_DENIED",
        message: "Booking verification failed",
      });
    return {
      bookingReference: appointment.booking_reference,
      managementToken: await this.tokens.management({
        tenantId: appointment.tenant_id,
        appointmentId: appointment.id,
        bookingReference: appointment.booking_reference,
        contactVerificationVersion: appointment.contact_verification_version,
      }),
      expiresIn: 900,
    };
  }

  async getManaged(slug: string, reference: string, token: string, ip: string) {
    const context = await this.management(slug, reference, token, ip, "detail");
    await this.commandRate("detail", context, ip, 120);
    const safe = {
      ...(await this.booking.detail(
        this.auth(context.root.tenant_id, context.root.branch_id),
        context.root.id,
      )),
    } as any;
    delete safe.internalNote;
    delete safe.customerId;
    for (const item of safe.items ?? []) {
      delete item.resources;
      if (
        context.root.policy_snapshot_json?.hideStaffNamesOnPublicBooking ===
        true
      )
        delete item.staff;
    }
    return safe;
  }
  async rescheduleHold(
    slug: string,
    reference: string,
    token: string,
    input: any,
    key: string,
    requestId: string,
    ip: string,
  ) {
    const context = await this.management(
      slug,
      reference,
      token,
      ip,
      "reschedule-hold",
    );
    await this.commandRate("reschedule-hold", context, ip, 20);
    return this.booking.createHold(
      this.auth(context.root.tenant_id, context.root.branch_id),
      {
        ...input,
        branchId: context.root.branch_id,
        source: "CUSTOMER_WEB",
        clientKey: context.claims.appointmentId,
      },
      key,
      requestId,
      this.managementScope(context),
      true,
    );
  }
  async reschedule(
    slug: string,
    reference: string,
    token: string,
    input: any,
    key: string,
    requestId: string,
    ip: string,
  ) {
    const context = await this.management(
      slug,
      reference,
      token,
      ip,
      "reschedule",
    );
    await this.commandRate("reschedule", context, ip, 20);
    if (!input.replacementHoldToken)
      throw new ForbiddenException({
        code: "SLOT_HOLD_TOKEN_INVALID",
        message: "Replacement hold token is required",
      });
    await this.verifyHoldToken(
      context.root.tenant_id,
      input.replacementHoldId,
      input.replacementHoldToken,
    );
    return this.booking.reschedule(
      this.auth(context.root.tenant_id, context.root.branch_id),
      context.root.id,
      { ...input, actorType: "CUSTOMER" },
      key,
      requestId,
      {
        public: true,
        customerId: context.root.customer_id,
        actorScope: this.managementScope(context),
      },
    );
  }
  async cancel(
    slug: string,
    reference: string,
    token: string,
    input: any,
    key: string,
    requestId: string,
    ip: string,
  ) {
    const context = await this.management(slug, reference, token, ip, "cancel");
    await this.commandRate("cancel", context, ip, 20);
    return this.booking.cancel(
      this.auth(context.root.tenant_id, context.root.branch_id),
      context.root.id,
      { ...input, actorType: "CUSTOMER" },
      key,
      requestId,
      {
        public: true,
        actorScope: this.managementScope(context),
      },
    );
  }

  private async management(
    slug: string,
    reference: string,
    token: string,
    ip: string,
    command: string,
  ) {
    this.assertEnabled();
    const tenant = await this.tenant(slug);
    await this.rate(`management-entry:${command}:${tenant.id}:ip:${ip}`, 60);
    const claims = await this.tokens.verifyManagement(token);
    if (
      claims.tenantId !== tenant.id ||
      claims.bookingReference !== reference.toUpperCase()
    )
      throw new ForbiddenException({
        code: "BOOKING_ACCESS_DENIED",
        message: "Token does not authorize this booking",
      });
    const root = (
      await this.db.query<any>(
        "SELECT * FROM appointments WHERE tenant_id=$1 AND id=$2 AND lower(booking_reference)=lower($3)",
        [tenant.id, claims.appointmentId, reference],
      )
    ).rows[0];
    if (
      !root ||
      root.contact_verification_version !== claims.contactVerificationVersion
    )
      throw new ForbiddenException({
        code: "BOOKING_ACCESS_DENIED",
        message: "Booking access has been revoked",
      });
    return { claims, root };
  }
  private async consumeChallenge(
    tenantId: string,
    id: string,
    code: string,
    purpose: string,
  ) {
    return this.db.transaction(async (client) => {
      const row = (
        await client.query<any>(
          "SELECT * FROM booking_access_challenges WHERE tenant_id=$1 AND id=$2 AND purpose=$3 FOR UPDATE",
          [tenantId, id, purpose],
        )
      ).rows[0];
      if (
        !row ||
        row.consumed_at ||
        new Date(row.expires_at) <= new Date() ||
        row.attempt_count >= 5 ||
        (row.blocked_until && new Date(row.blocked_until) > new Date())
      )
        throw new UnauthorizedException({
          code: "BOOKING_ACCESS_DENIED",
          message: "Verification code is invalid or expired",
        });
      if (row.code_hash !== this.codeHash(id, code)) {
        await client.query(
          "UPDATE booking_access_challenges SET attempt_count=least(attempt_count+1,5),blocked_until=CASE WHEN attempt_count+1>=5 THEN now()+interval '15 minutes' ELSE blocked_until END WHERE tenant_id=$1 AND id=$2",
          [tenantId, id],
        );
        throw new UnauthorizedException({
          code: "BOOKING_ACCESS_DENIED",
          message: "Verification code is invalid or expired",
        });
      }
      await client.query(
        "UPDATE booking_access_challenges SET consumed_at=now() WHERE tenant_id=$1 AND id=$2",
        [tenantId, id],
      );
      return row;
    });
  }
  private async tenant(slug: string) {
    const row = (
      await this.db.query<any>(
        "SELECT * FROM tenants WHERE lower(slug)=lower($1) AND status='ACTIVE'",
        [slug],
      )
    ).rows[0];
    if (!row)
      throw new NotFoundException({
        code: "BOOKING_NOT_FOUND",
        message: "Salon not found",
      });
    return row;
  }
  private auth(tenantId: string, branchId?: string): AccessClaims {
    return {
      userId: "00000000-0000-4000-8000-000000000000",
      tenantId,
      membershipId: "00000000-0000-4000-8000-000000000000",
      authorizationVersion: 1,
      sessionId: "public",
      roles: ["CUSTOMER"],
      branchIds: branchId ? [branchId] : [],
    };
  }
  private code() {
    return process.env.NODE_ENV === "production"
      ? String(randomInt(0, 1_000_000)).padStart(6, "0")
      : "123456";
  }
  private codeHash(id: string, code: string) {
    const pepper = process.env.OTP_PEPPER;
    if (process.env.NODE_ENV === "production" && !pepper)
      throw new Error("OTP_PEPPER is required when public booking is enabled");
    return createHash("sha256")
      .update(`${id}:${code}:${pepper ?? "development-otp-pepper"}`)
      .digest("hex");
  }
  private async rate(bucket: string, limit: number) {
    const result = await this.db.query<any>(
      `INSERT INTO auth_rate_limits(bucket_key,attempt_count,window_started_at,updated_at) VALUES($1,1,now(),now()) ON CONFLICT(bucket_key) DO UPDATE SET attempt_count=CASE WHEN auth_rate_limits.window_started_at<now()-interval '10 minutes' THEN 1 ELSE auth_rate_limits.attempt_count+1 END,window_started_at=CASE WHEN auth_rate_limits.window_started_at<now()-interval '10 minutes' THEN now() ELSE auth_rate_limits.window_started_at END,updated_at=now() RETURNING attempt_count,blocked_until`,
      [bucket],
    );
    if (
      (result.rows[0].blocked_until &&
        new Date(result.rows[0].blocked_until) > new Date()) ||
      Number(result.rows[0].attempt_count) > limit
    ) {
      await this.db.query(
        "UPDATE auth_rate_limits SET blocked_until=now()+interval '10 minutes' WHERE bucket_key=$1",
        [bucket],
      );
      throw new HttpException(
        {
          code: "PUBLIC_RATE_LIMITED",
          message: "Too many public booking requests",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
  private assertEnabled() {
    const enabled =
      process.env.PUBLIC_BOOKING_ENABLED !== "false" &&
      (process.env.NODE_ENV !== "production" ||
        process.env.PUBLIC_BOOKING_ENABLED === "true");
    if (!enabled)
      throw new ServiceUnavailableException({
        code: "PUBLIC_BOOKING_DISABLED",
        message: "Public booking is not available",
      });
    if (
      process.env.NODE_ENV === "production" &&
      (!process.env.OTP_PEPPER ||
        process.env.OTP_PROVIDER !== "webhook" ||
        !process.env.OTP_PROVIDER_URL)
    )
      throw new Error(
        "OTP_PEPPER, OTP_PROVIDER=webhook and OTP_PROVIDER_URL are required when public booking is enabled",
      );
  }
  private async branchPolicy(tenantId: string, branchId: string) {
    const row = (
      await this.db.query<any>(
        "SELECT ts.booking_policy_json tenant_policy_json,bs.booking_policy_json branch_policy_json FROM branches b JOIN tenant_settings ts ON ts.tenant_id=b.tenant_id JOIN branch_settings bs ON bs.tenant_id=b.tenant_id AND bs.branch_id=b.id WHERE b.tenant_id=$1 AND b.id=$2 AND b.status='ACTIVE'",
        [tenantId, branchId],
      )
    ).rows[0];
    if (!row)
      throw new NotFoundException({
        code: "BOOKING_BRANCH_INACTIVE",
        message: "Branch is not available",
      });
    return {
      ...(row.tenant_policy_json ?? {}),
      ...(row.branch_policy_json ?? {}),
    };
  }
  private async assertPublicPlan(
    tenantId: string,
    body: z.infer<typeof createSlotHoldSchema>,
  ) {
    const policy = await this.branchPolicy(tenantId, body.branchId);
    for (const item of body.items) {
      if (
        item.staffPreference.type === "ANY" &&
        policy.allowAnyTechnician === false
      )
        throw new ForbiddenException({
          code: "PUBLIC_ANY_TECHNICIAN_NOT_ALLOWED",
          message: "A technician must be selected",
        });
      if (
        item.staffPreference.type === "SPECIFIC" &&
        policy.allowCustomerSelectStaff === false
      )
        throw new ForbiddenException({
          code: "PUBLIC_STAFF_SELECTION_NOT_ALLOWED",
          message: "Customers cannot select a technician",
        });
      await this.assertPublicServices(tenantId, [item.serviceId]);
    }
  }
  private async assertPublicServices(tenantId: string, serviceIds: string[]) {
    if (!serviceIds.length) return;
    const services = await this.db.query<{ id: string }>(
      "SELECT id FROM services WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND status='ACTIVE' AND online_booking_enabled=true",
      [tenantId, serviceIds],
    );
    if (
      new Set(services.rows.map((row) => row.id)).size !==
      new Set(serviceIds).size
    )
      throw new ForbiddenException({
        code: "PUBLIC_SERVICE_NOT_BOOKABLE",
        message: "Service is not available for public booking",
      });
  }
  private managementScope(context: any) {
    return `public-booking:${context.root.tenant_id}:${context.root.id}:${context.claims.contactVerificationVersion}`;
  }
  private async commandRate(
    command: string,
    context: any,
    ip: string,
    limit: number,
  ) {
    const subject = this.booking.contactHash(this.managementScope(context));
    await this.rate(
      `${command}:${context.root.tenant_id}:${context.root.id}:${subject}`,
      limit,
    );
    await this.rate(`${command}:${context.root.tenant_id}:ip:${ip}`, limit * 2);
  }
  private async queueOtp(
    client: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
    job: {
      tenantId: string;
      challengeId: string;
      purpose: string;
      channel: "SMS" | "EMAIL";
      destination: string;
      code: string;
    },
  ) {
    await client.query(
      "INSERT INTO booking_otp_delivery_jobs(tenant_id,challenge_id,purpose,channel,destination,code_ciphertext) VALUES($1,$2,$3,$4,$5,$6)",
      [
        job.tenantId,
        job.challengeId,
        job.purpose,
        job.channel,
        job.destination,
        this.encryptOtp(job.code),
      ],
    );
  }
  private encryptOtp(code: string) {
    const key = createHash("sha256")
      .update(process.env.OTP_PEPPER ?? "development-otp-pepper")
      .digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([
      cipher.update(code, "utf8"),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), encrypted]
      .map((part) => part.toString("base64url"))
      .join(".");
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomInt, randomUUID } from "node:crypto";
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
  ) {}

  async salon(slug: string) {
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
    const t = await this.tenant(slug);
    return (
      await this.db.query<any>(
        "SELECT b.id,b.name,b.code,b.timezone,bs.booking_policy_json FROM branches b LEFT JOIN branch_settings bs ON bs.tenant_id=b.tenant_id AND bs.branch_id=b.id WHERE b.tenant_id=$1 AND b.status='ACTIVE' ORDER BY b.name",
        [t.id],
      )
    ).rows.map((x) => ({
      id: x.id,
      name: x.name,
      code: x.code,
      timezone: x.timezone,
      policy: {
        allowAnyTechnician: x.booking_policy_json?.allowAnyTechnician !== false,
        allowCustomerSelectStaff:
          x.booking_policy_json?.allowCustomerSelectStaff !== false,
        hideStaffNames:
          x.booking_policy_json?.hideStaffNamesOnPublicBooking === true,
      },
    }));
  }
  async services(slug: string, branchId?: string) {
    const t = await this.tenant(slug);
    return (
      await this.db.query<any>(
        `SELECT s.id,s.code,s.name_json,s.description_json,s.default_duration_min,s.version,p.amount,p.currency,p.id price_id FROM services s JOIN LATERAL(SELECT sp.* FROM service_prices sp WHERE sp.tenant_id=s.tenant_id AND sp.service_id=s.id AND sp.status='ACTIVE' AND (sp.branch_id=$2::uuid OR sp.branch_id IS NULL) AND sp.effective_from<=now() AND (sp.effective_to IS NULL OR sp.effective_to>now()) ORDER BY (sp.branch_id IS NOT NULL) DESC LIMIT 1)p ON true WHERE s.tenant_id=$1 AND s.status='ACTIVE' AND s.online_booking_enabled ORDER BY s.code`,
        [t.id, branchId ?? null],
      )
    ).rows.map((x) => ({
      id: x.id,
      code: x.code,
      name: x.name_json,
      description: x.description_json,
      durationMin: x.default_duration_min,
      price: { amount: String(x.amount), currency: x.currency },
      version: x.version,
    }));
  }
  async search(slug: string, input: any, ip: string) {
    const t = await this.tenant(slug);
    await this.rate(`availability:${t.id}:${ip}`, 120);
    return this.availability.search(this.auth(t.id), input);
  }
  async createHold(
    slug: string,
    input: any,
    key: string,
    requestId: string,
    ip: string,
  ) {
    const t = await this.tenant(slug);
    const clientKey = String(input.clientKey ?? ip);
    await this.rate(`hold:${t.id}:${this.booking.contactHash(clientKey)}`, 20);
    return this.booking.createHold(
      this.auth(t.id),
      { ...input, source: "CUSTOMER_WEB", clientKey },
      key,
      requestId,
      `public:${this.booking.contactHash(clientKey)}`,
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
    const t = await this.tenant(slug);
    await this.rate(`booking:${t.id}:${ip}`, 20);
    return this.booking.createAppointment(
      this.auth(t.id),
      input,
      key,
      requestId,
      { public: true, actorScope: `public:${ip}` },
    );
  }

  async requestContact(slug: string, input: unknown, ip: string) {
    const t = await this.tenant(slug),
      body = contactSchema.parse(input),
      hash = this.booking.contactHash(body.contact);
    await this.rate(`contact:${t.id}:${hash}:${ip}`, 5);
    const id = randomUUID(),
      code = this.code();
    await this.db.query(
      "INSERT INTO booking_access_challenges(id,tenant_id,booking_reference,contact_hash,channel,purpose,code_hash,expires_at,request_ip) VALUES($1,$2,'PREBOOK',$3,$4,'BOOKING_CONFIRMATION',$5,now()+interval '5 minutes',$6)",
      [id, t.id, hash, body.channel, this.codeHash(id, code), ip],
    );
    return {
      challengeId: id,
      expiresIn: 300,
      resendAfter: 60,
      ...(process.env.NODE_ENV !== "production" ? { testCode: code } : {}),
    };
  }
  async verifyContact(input: unknown) {
    const body = verifySchema.parse(input);
    const challenge = await this.consumeChallenge(
      body.challengeId,
      body.code,
      "BOOKING_CONFIRMATION",
    );
    return {
      verificationToken: await this.tokens.contact({
        tenantId: challenge.tenant_id,
        contactHash: challenge.contact_hash,
        challengeId: challenge.id,
      }),
      expiresIn: 600,
    };
  }

  async requestAccess(input: unknown, ip: string) {
    const body = accessRequestSchema.parse(input),
      reference = body.bookingReference.toUpperCase(),
      hash = this.booking.contactHash(body.contact);
    await this.rate(`booking-access:${hash}:${ip}`, 5);
    const match = (
      await this.db.query<any>(
        "SELECT a.tenant_id,a.id FROM appointments a WHERE lower(a.booking_reference)=lower($1) AND (lower(COALESCE(a.contact_snapshot_json->>'phone',''))=lower($2) OR lower(COALESCE(a.contact_snapshot_json->>'email',''))=lower($2)) ORDER BY a.created_at DESC LIMIT 1",
        [reference, body.contact.trim()],
      )
    ).rows[0];
    const challengeId = randomUUID(),
      code = this.code();
    if (match)
      await this.db.query(
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
  async verifyAccess(input: unknown) {
    const body = verifySchema.parse(input),
      challenge = await this.consumeChallenge(
        body.challengeId,
        body.code,
        "BOOKING_ACCESS",
      );
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

  async getManaged(reference: string, token: string) {
    const context = await this.management(reference, token),
      safe = {
        ...(await this.booking.detail(
          this.auth(context.root.tenant_id),
          context.root.id,
        )),
      } as any;
    delete safe.internalNote;
    return safe;
  }
  async rescheduleHold(
    reference: string,
    token: string,
    input: any,
    key: string,
    requestId: string,
  ) {
    const context = await this.management(reference, token);
    return this.booking.createHold(
      this.auth(context.root.tenant_id),
      {
        ...input,
        branchId: context.root.branch_id,
        source: "CUSTOMER_WEB",
        clientKey: context.claims.appointmentId,
      },
      key,
      requestId,
      `customer:${context.root.customer_id}`,
      true,
    );
  }
  async reschedule(
    reference: string,
    token: string,
    input: any,
    key: string,
    requestId: string,
  ) {
    const context = await this.management(reference, token);
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
      this.auth(context.root.tenant_id),
      context.root.id,
      { ...input, actorType: "CUSTOMER" },
      key,
      requestId,
      {
        public: true,
        customerId: context.root.customer_id,
        actorScope: `customer:${context.root.customer_id}`,
      },
    );
  }
  async cancel(
    reference: string,
    token: string,
    input: any,
    key: string,
    requestId: string,
  ) {
    const context = await this.management(reference, token);
    return this.booking.cancel(
      this.auth(context.root.tenant_id),
      context.root.id,
      { ...input, actorType: "CUSTOMER" },
      `${context.root.customer_id}:${key}`,
      requestId,
    );
  }

  private async management(reference: string, token: string) {
    const claims = await this.tokens.verifyManagement(token);
    if (claims.bookingReference !== reference.toUpperCase())
      throw new ForbiddenException({
        code: "BOOKING_ACCESS_DENIED",
        message: "Token does not authorize this booking",
      });
    const root = (
      await this.db.query<any>(
        "SELECT * FROM appointments WHERE tenant_id=$1 AND id=$2 AND lower(booking_reference)=lower($3)",
        [claims.tenantId, claims.appointmentId, reference],
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
  private async consumeChallenge(id: string, code: string, purpose: string) {
    return this.db.transaction(async (client) => {
      const row = (
        await client.query<any>(
          "SELECT * FROM booking_access_challenges WHERE id=$1 AND purpose=$2 FOR UPDATE",
          [id, purpose],
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
          "UPDATE booking_access_challenges SET attempt_count=least(attempt_count+1,5),blocked_until=CASE WHEN attempt_count+1>=5 THEN now()+interval '15 minutes' ELSE blocked_until END WHERE id=$1",
          [id],
        );
        throw new UnauthorizedException({
          code: "BOOKING_ACCESS_DENIED",
          message: "Verification code is invalid or expired",
        });
      }
      await client.query(
        "UPDATE booking_access_challenges SET consumed_at=now() WHERE id=$1",
        [id],
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
  private auth(tenantId: string): AccessClaims {
    return {
      userId: "00000000-0000-4000-8000-000000000000",
      tenantId,
      membershipId: "00000000-0000-4000-8000-000000000000",
      authorizationVersion: 1,
      sessionId: "public",
      roles: ["SALON_OWNER"],
      branchIds: [],
    };
  }
  private code() {
    return process.env.NODE_ENV === "production"
      ? String(randomInt(0, 1_000_000)).padStart(6, "0")
      : "123456";
  }
  private codeHash(id: string, code: string) {
    return createHash("sha256")
      .update(
        `${id}:${code}:${process.env.OTP_PEPPER ?? "development-otp-pepper"}`,
      )
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
}

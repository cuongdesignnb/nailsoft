/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { currencyMinorUnit, type BookingPlan } from "@nailsoft/domain-types";
import {
  appointmentCancelSchema,
  appointmentRescheduleSchema,
  appointmentVersionSchema,
  bookingCustomerCreateSchema,
  bookingCustomerSearchSchema,
  createAppointmentSchema,
  createSlotHoldSchema,
  depositWaiverSchema,
  publicCreateAppointmentSchema,
} from "@nailsoft/validation";
import type { PoolClient } from "pg";
import { DatabaseService } from "../../infrastructure/database.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import { BookingIdempotencyService } from "./booking-idempotency.service.js";
import { BookingPlannerService } from "./booking-planner.service.js";
import {
  assertAppointmentTransition,
  assertHoldTransition,
  cancellationStatus,
} from "./booking-state-machine.js";
import { BookingTokenService } from "./booking-token.service.js";
import { ReservationService } from "./reservation.service.js";

@Injectable()
export class BookingService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(BookingPlannerService)
    private readonly planner: BookingPlannerService,
    @Inject(BookingIdempotencyService)
    private readonly idempotency: BookingIdempotencyService,
    @Inject(BookingTokenService) private readonly tokens: BookingTokenService,
    @Inject(ReservationService)
    private readonly reservations: ReservationService,
  ) {}

  plan(auth: AccessClaims, input: unknown) {
    this.denyPlatform(auth);
    return this.planner.plan(auth, input);
  }

  async listBookingCustomers(auth: AccessClaims, input: unknown) {
    this.denyPlatform(auth);
    const query = bookingCustomerSearchSchema.parse(input),
      search = query.search || null,
      normalizedEmail = search?.includes("@")
        ? this.normalizeEmail(search)
        : null,
      normalizedPhone =
        search && search.replace(/\D/g, "").length >= 6
          ? this.normalizePhone(search)
          : null;
    const rows = await this.db.query<any>(
      `SELECT id,display_name,phone_normalized,email_normalized,preferred_locale,status,is_guest,created_at
       FROM customers
       WHERE tenant_id=$1 AND status='ACTIVE'
         AND ($2::text IS NULL OR lower(display_name) LIKE '%'||lower($2)||'%'
           OR ($3::text IS NOT NULL AND phone_normalized LIKE '%'||$3)
           OR ($4::text IS NOT NULL AND lower(email_normalized)=lower($4)))
       ORDER BY display_name,id LIMIT $5`,
      [auth.tenantId, search, normalizedPhone, normalizedEmail, query.limit],
    );
    return rows.rows.map((row) => this.customerView(row));
  }

  async createBookingCustomer(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    this.denyPlatform(auth);
    const body = bookingCustomerCreateSchema.parse(input),
      phone = body.phone ? this.normalizePhone(body.phone) : null,
      email = body.email ? this.normalizeEmail(body.email) : null;
    const result = await this.db.transaction((client) =>
      this.idempotency.execute(client, {
        tenantId: auth.tenantId,
        actorScope: `user:${auth.userId}`,
        command: "customer.booking_create",
        key,
        request: { ...body, phone, email },
        work: async () => {
          const existing = (
            await client.query<any>(
              `SELECT * FROM customers WHERE tenant_id=$1 AND status='ACTIVE'
               AND (($2::text IS NOT NULL AND phone_normalized=$2)
                 OR ($3::text IS NOT NULL AND lower(email_normalized)=lower($3)))
               ORDER BY created_at LIMIT 1`,
              [auth.tenantId, phone, email],
            )
          ).rows[0];
          if (existing) return this.customerView(existing);
          const created = (
            await client.query<any>(
              `INSERT INTO customers(tenant_id,display_name,phone_normalized,email_normalized,preferred_locale,is_guest)
               VALUES($1,$2,$3,$4,$5,false) RETURNING *`,
              [auth.tenantId, body.displayName, phone, email, body.locale],
            )
          ).rows[0];
          await client.query(
            `INSERT INTO audit_logs(tenant_id,actor_user_id,action,entity_type,entity_id,after_json,request_id)
             VALUES($1,$2,'customer.booking_created','customer',$3,$4,$5)`,
            [
              auth.tenantId,
              auth.userId,
              created.id,
              JSON.stringify({
                displayName: created.display_name,
                phone: created.phone_normalized,
                email: created.email_normalized,
                locale: created.preferred_locale,
              }),
              requestId,
            ],
          );
          return this.customerView(created);
        },
      }),
    );
    return { ...result.data, idempotencyReplayed: result.replayed };
  }

  async createHold(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
    actorScope = `user:${auth.userId}`,
    publicActor = false,
  ) {
    this.denyPlatform(auth);
    const body = createSlotHoldSchema.parse(input);
    this.guardBranch(auth, body.branchId);
    const executed = await this.db.transaction((client) =>
      this.idempotency.execute(client, {
        tenantId: auth.tenantId,
        actorScope,
        command: "slot-hold.create",
        key,
        request: body,
        work: async () => {
          const plan = await this.planner.plan(auth, body, {
            channel: publicActor ? "PUBLIC" : "INTERNAL",
          });
          await this.reservations.lockPlan(client, auth.tenantId, plan);
          await this.reservations.expireStale(
            client,
            auth.tenantId,
            body.branchId,
            requestId,
          );
          const policy = await this.policy(
            client,
            auth.tenantId,
            body.branchId,
          );
          const currentVersion = Number(
            (
              await client.query<any>(
                "SELECT version FROM availability_versions WHERE tenant_id=$1 AND branch_id=$2 FOR UPDATE",
                [auth.tenantId, body.branchId],
              )
            ).rows[0]?.version ?? 1,
          );
          if (
            body.availabilityDataVersion &&
            body.availabilityDataVersion !== currentVersion
          )
            throw changed();
          if (plan.availabilityDataVersion !== currentVersion) throw changed();
          const clientHash = body.clientKey
            ? this.idempotency.subject(`${auth.tenantId}:${body.clientKey}`)
            : this.idempotency.subject(actorScope);
          const active = Number(
            (
              await client.query<{ count: number }>(
                "SELECT count(*)::int count FROM slot_holds WHERE tenant_id=$1 AND client_key_hash=$2 AND status='ACTIVE' AND expires_at>now()",
                [auth.tenantId, clientHash],
              )
            ).rows[0]?.count ?? 0,
          );
          if (active >= policy.activeHoldLimit)
            throw new ConflictException({
              code: "SLOT_HOLD_LIMIT_REACHED",
              message: "Active slot hold limit reached",
            });
          const holdId = randomUUID();
          const expiresAt = new Date(
            Date.now() + policy.holdTtlMinutes * 60_000,
          );
          await client.query(
            "INSERT INTO slot_holds(id,tenant_id,branch_id,source,status,client_key_hash,request_fingerprint,availability_data_version,expires_at,created_by_user_id) VALUES($1,$2,$3,$4,'ACTIVE',$5,$6,$7,$8,$9)",
            [
              holdId,
              auth.tenantId,
              body.branchId,
              body.source,
              clientHash,
              this.idempotency.hash(body),
              currentVersion,
              expiresAt,
              publicActor ? null : auth.userId,
            ],
          );
          await this.reservations.createForHold(
            client,
            auth.tenantId,
            holdId,
            plan,
            expiresAt,
          );
          await this.reservations.record(client, {
            tenantId: auth.tenantId,
            branchId: body.branchId,
            actorUserId: publicActor ? null : auth.userId,
            action: "slot_hold.created",
            aggregateType: "slot_hold",
            aggregateId: holdId,
            aggregateVersion: 1,
            requestId,
            payload: {
              holdId,
              branchId: body.branchId,
              status: "ACTIVE",
              expiresAt: expiresAt.toISOString(),
              staffIds: plan.items.map((x) => x.staffId),
              refetch: true,
            },
          });
          return {
            holdId,
            status: "ACTIVE" as const,
            expiresAt: expiresAt.toISOString(),
            version: 1,
            plan,
          };
        },
      }),
    );
    return {
      ...executed.data,
      holdToken: await this.tokens.hold({
        tenantId: auth.tenantId,
        holdId: executed.data.holdId,
        tokenVersion: executed.data.version,
        expiresAt: executed.data.expiresAt,
      }),
      idempotencyReplayed: executed.replayed,
    };
  }

  async getHold(auth: AccessClaims, holdId: string) {
    this.denyPlatform(auth);
    const row = await this.loadHold(this.db as any, auth.tenantId, holdId);
    this.guardBranch(auth, row.branch_id);
    return this.holdView(row);
  }

  async releaseHold(
    auth: AccessClaims,
    holdId: string,
    key: string,
    requestId: string,
  ) {
    this.denyPlatform(auth);
    return (
      await this.db.transaction((client) =>
        this.idempotency.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "slot-hold.release",
          key,
          request: { holdId },
          work: async () => {
            await client.query(
              "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
              [`${auth.tenantId}:hold:${holdId}`],
            );
            const hold = await this.loadHold(
              client,
              auth.tenantId,
              holdId,
              true,
            );
            this.guardBranch(auth, hold.branch_id);
            if (hold.status === "RELEASED") return this.holdView(hold);
            if (hold.status !== "ACTIVE")
              throw new ConflictException({
                code: `SLOT_HOLD_${hold.status}`,
                message: "Slot hold cannot be released",
              });
            assertHoldTransition(hold.status, "RELEASED");
            await this.reservations.releaseHold(
              client,
              auth.tenantId,
              holdId,
              "RELEASED",
            );
            const updated = (
              await client.query<any>(
                "UPDATE slot_holds SET status='RELEASED',released_at=now(),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
                [auth.tenantId, holdId],
              )
            ).rows[0];
            await this.reservations.record(client, {
              tenantId: auth.tenantId,
              branchId: hold.branch_id,
              actorUserId: auth.userId,
              action: "slot_hold.released",
              aggregateType: "slot_hold",
              aggregateId: holdId,
              aggregateVersion: updated.version,
              requestId,
              payload: {
                holdId,
                branchId: hold.branch_id,
                status: "RELEASED",
                refetch: true,
              },
            });
            return this.holdView(updated);
          },
        }),
      )
    ).data;
  }

  async createAppointment(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
    options: { public?: boolean; actorScope?: string } = {},
  ) {
    this.denyPlatform(auth);
    const body: any = options.public
      ? publicCreateAppointmentSchema.parse(input)
      : createAppointmentSchema.parse(input);
    if (options.public && "customerId" in body.customer)
      throw new ForbiddenException({
        code: "PUBLIC_CUSTOMER_ID_NOT_ALLOWED",
        message: "Public booking cannot select an existing customer by ID",
      });
    let verifiedActorScope = options.actorScope ?? `user:${auth.userId}`;
    if (options.public) {
      const hold = (
        await this.db.query<any>(
          "SELECT id,tenant_id,public_token_version,status,expires_at,client_key_hash FROM slot_holds WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, body.holdId],
        )
      ).rows[0];
      if (!hold)
        throw new NotFoundException({
          code: "SLOT_HOLD_NOT_FOUND",
          message: "Slot hold not found",
        });
      await this.tokens.verifyHold(body.holdToken, {
        tenantId: auth.tenantId,
        holdId: hold.id,
        tokenVersion: hold.public_token_version,
      });
      const verified = await this.tokens.verifyContact(
        body.contactVerificationToken,
      );
      const normalized = this.normalizeContact(
        body.customer.phone ?? body.customer.email ?? "",
      );
      const contactHash = this.contactHash(normalized);
      if (
        verified.tenantId !== auth.tenantId ||
        verified.contactHash !== contactHash
      )
        throw new ForbiddenException({
          code: "BOOKING_CONTACT_NOT_VERIFIED",
          message: "Verified contact does not match booking contact",
        });
      verifiedActorScope = `public-contact:${auth.tenantId}:${contactHash}:${hold.id}`;
    }
    const result = await this.db.transaction((client) =>
      this.idempotency.execute(client, {
        tenantId: auth.tenantId,
        actorScope: verifiedActorScope,
        command: options.public
          ? "public.appointment.create"
          : "appointment.create",
        key,
        request: {
          ...body,
          holdTokenDigest: body.holdToken
            ? this.idempotency.subject(body.holdToken)
            : undefined,
          contactVerificationTokenDigest: body.contactVerificationToken
            ? this.idempotency.subject(body.contactVerificationToken)
            : undefined,
          holdToken: undefined,
          contactVerificationToken: undefined,
        },
        work: async () => {
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [`${auth.tenantId}:hold:${body.holdId}`],
          );
          const hold = await this.loadHold(
            client,
            auth.tenantId,
            body.holdId,
            true,
          );
          this.guardBranch(auth, hold.branch_id);
          if (hold.status === "CONSUMED")
            throw new ConflictException({
              code: "SLOT_HOLD_ALREADY_CONSUMED",
              message: "Slot hold has already been consumed",
            });
          if (
            hold.status !== "ACTIVE" ||
            new Date(hold.expires_at) <= new Date()
          )
            throw new ConflictException({
              code: "SLOT_HOLD_EXPIRED",
              message: "Slot hold has expired",
            });
          if (options.public) {
            if (!body.holdToken)
              throw new ForbiddenException({
                code: "SLOT_HOLD_TOKEN_INVALID",
                message: "Slot hold token is required",
              });
            await this.tokens.verifyHold(body.holdToken, {
              tenantId: auth.tenantId,
              holdId: hold.id,
              tokenVersion: hold.public_token_version,
            });
          }
          const customer = await this.resolveCustomer(
            client,
            auth.tenantId,
            body.customer,
            options.public,
            body.contactVerificationToken,
          );
          const plan = await this.loadHoldPlan(client, hold);
          if (options.public) {
            const bookable = await client.query(
              "SELECT id FROM services WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND status='ACTIVE' AND online_booking_enabled=true",
              [auth.tenantId, plan.items.map((item) => item.serviceId)],
            );
            if (
              bookable.rowCount !==
              new Set(plan.items.map((item) => item.serviceId)).size
            )
              throw new ConflictException({
                code: "PUBLIC_SERVICE_NOT_BOOKABLE",
                message:
                  "A selected service is no longer available for public booking",
              });
          }
          const policy = await this.policy(
            client,
            auth.tenantId,
            hold.branch_id,
          );
          if (
            options.public &&
            body.acceptedPolicyVersion !== Number(policy.snapshot.version)
          )
            throw new ConflictException({
              code: "BOOKING_POLICY_CHANGED",
              message: "Booking policy changed and must be accepted again",
              details: { policy: policy.snapshot },
            });
          const depositRequired = this.deposit(plan);
          const status =
            depositRequired > 0
              ? "PENDING_DEPOSIT"
              : options.public &&
                  policy.confirmationPolicy === "PUBLIC_MANUAL_CONFIRM"
                ? "PENDING_CONFIRMATION"
                : "CONFIRMED";
          const appointmentId = randomUUID(),
            reference = await this.reference(client, auth.tenantId);
          const expiresAt =
            status === "CONFIRMED"
              ? null
              : new Date(Date.now() + policy.pendingExpiryMinutes * 60_000);
          const acceptedAt = options.public
            ? new Date(body.acceptedAt).toISOString()
            : null;
          const contact = {
            displayName: customer.display_name,
            phone: customer.phone_normalized,
            email: customer.email_normalized,
            locale: customer.preferred_locale,
            verified: options.public,
            bookingPolicyAccepted: options.public,
            acceptedPolicyVersion: options.public
              ? body.acceptedPolicyVersion
              : null,
            acceptedAt,
            marketingConsent: options.public ? body.marketingConsent : false,
            marketingConsentAt:
              options.public && body.marketingConsent ? acceptedAt : null,
            source: options.public ? "CUSTOMER_WEB" : "RECEPTION",
          };
          const root = (
            await client.query<any>(
              "INSERT INTO appointments(id,tenant_id,branch_id,customer_id,booking_reference,source,status,locale,timezone,start_at,end_at,schedule_version,contact_snapshot_json,policy_snapshot_json,pricing_summary_json,deposit_required_minor,deposit_status,customer_note,internal_note,expires_at,confirmed_at,confirmed_by_user_id,created_by_user_id,updated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$22) RETURNING *",
              [
                appointmentId,
                auth.tenantId,
                hold.branch_id,
                customer.id,
                reference,
                options.public ? "CUSTOMER_WEB" : "RECEPTION",
                status,
                customer.preferred_locale,
                plan.timezone,
                plan.startAt,
                plan.endAt,
                JSON.stringify(contact),
                JSON.stringify(policy.snapshot),
                JSON.stringify(plan.total),
                depositRequired,
                depositRequired > 0 ? "PENDING" : "NOT_REQUIRED",
                body.customerNote ?? null,
                options.public ? null : (body.internalNote ?? null),
                expiresAt,
                status === "CONFIRMED" ? new Date() : null,
                status === "CONFIRMED" && !options.public ? auth.userId : null,
                options.public ? null : auth.userId,
              ],
            )
          ).rows[0];
          const participant = (
            await client.query<any>(
              "INSERT INTO appointment_participants(tenant_id,appointment_id,customer_id,display_name,participant_order,is_booking_owner) VALUES($1,$2,$3,$4,1,true) RETURNING id",
              [
                auth.tenantId,
                appointmentId,
                customer.id,
                customer.display_name,
              ],
            )
          ).rows[0];
          if (options.public && body.marketingConsent)
            await client.query(
              "INSERT INTO audit_logs(tenant_id,action,entity_type,entity_id,after_json,reason) VALUES($1,'customer.marketing_consent_granted','customer',$2,$3,$4)",
              [
                auth.tenantId,
                customer.id,
                JSON.stringify({
                  granted: true,
                  grantedAt: acceptedAt,
                  source: "CUSTOMER_WEB",
                }),
                `request:${requestId}`,
              ],
            );
          const holdItems = (
            await client.query<any>(
              "SELECT * FROM slot_hold_items WHERE tenant_id=$1 AND slot_hold_id=$2 ORDER BY sequence_no",
              [auth.tenantId, hold.id],
            )
          ).rows;
          for (const source of holdItems) {
            const itemId = randomUUID();
            await client.query(
              "INSERT INTO appointment_items(id,tenant_id,appointment_id,participant_id,service_id,sequence_no,status,service_start_at,service_end_at,staff_occupancy_start_at,staff_occupancy_end_at,resource_occupancy_start_at,resource_occupancy_end_at,duration_min,prep_time_min,cleanup_time_min,buffer_before_min,buffer_after_min,service_snapshot_json,price_snapshot_json,tax_snapshot_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)",
              [
                itemId,
                auth.tenantId,
                appointmentId,
                participant.id,
                source.service_id,
                source.sequence_no,
                status === "CONFIRMED" ? "CONFIRMED" : "PLANNED",
                source.service_start_at,
                source.service_end_at,
                source.staff_occupancy_start_at,
                source.staff_occupancy_end_at,
                source.resource_occupancy_start_at,
                source.resource_occupancy_end_at,
                Number(source.service_snapshot_json.durationMin),
                Number(source.service_snapshot_json.prepTimeMin),
                Number(source.service_snapshot_json.cleanupTimeMin),
                Number(source.service_snapshot_json.bufferBeforeMin),
                Number(source.service_snapshot_json.bufferAfterMin),
                JSON.stringify(source.service_snapshot_json),
                JSON.stringify(source.price_snapshot_json),
                JSON.stringify(source.tax_snapshot_json),
              ],
            );
            await client.query(
              "INSERT INTO appointment_item_staff_assignments(tenant_id,appointment_item_id,staff_id,assignment_role,status) VALUES($1,$2,$3,'PRIMARY','ACTIVE')",
              [auth.tenantId, itemId, source.selected_staff_id],
            );
            for (const allocation of source.resource_plan_json)
              await client.query(
                "INSERT INTO appointment_item_resource_allocations(tenant_id,appointment_item_id,resource_id,quantity,is_exclusive,status) VALUES($1,$2,$3,$4,$5,'ACTIVE')",
                [
                  auth.tenantId,
                  itemId,
                  allocation.resourceId,
                  allocation.quantity,
                  allocation.isExclusive,
                ],
              );
            await client.query(
              "UPDATE staff_schedule_reservations SET appointment_item_id=$3,slot_hold_item_id=NULL,reservation_type='APPOINTMENT',expires_at=NULL WHERE tenant_id=$1 AND slot_hold_item_id=$2 AND status='ACTIVE'",
              [auth.tenantId, source.id, itemId],
            );
            await client.query(
              "UPDATE resource_schedule_reservations SET appointment_item_id=$3,slot_hold_item_id=NULL,reservation_type='APPOINTMENT',expires_at=NULL WHERE tenant_id=$1 AND slot_hold_item_id=$2 AND status='ACTIVE'",
              [auth.tenantId, source.id, itemId],
            );
          }
          await client.query(
            "UPDATE slot_holds SET status='CONSUMED',consumed_by_appointment_id=$3,consumed_at=now(),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
            [auth.tenantId, hold.id, appointmentId],
          );
          await this.history(
            client,
            root,
            null,
            status,
            options.public ? "CUSTOMER" : "USER",
            options.public ? null : auth.userId,
            customer.id,
            "CREATED",
            requestId,
          );
          await this.reservations.record(client, {
            tenantId: auth.tenantId,
            branchId: hold.branch_id,
            actorUserId: options.public ? null : auth.userId,
            action: "slot_hold.consumed",
            aggregateType: "slot_hold",
            aggregateId: hold.id,
            aggregateVersion: hold.version + 1,
            requestId,
            payload: {
              holdId: hold.id,
              appointmentId,
              branchId: hold.branch_id,
              status: "CONSUMED",
              refetch: true,
            },
          });
          await this.reservations.record(client, {
            tenantId: auth.tenantId,
            branchId: hold.branch_id,
            actorUserId: options.public ? null : auth.userId,
            action: "appointment.created",
            aggregateType: "appointment",
            aggregateId: appointmentId,
            aggregateVersion: 1,
            requestId,
            payload: {
              appointmentId,
              bookingReference: reference,
              branchId: hold.branch_id,
              status,
              staffIds: plan.items.map((x) => x.staffId),
              startAt: plan.startAt,
              endAt: plan.endAt,
              refetch: true,
            },
          });
          const eventActor = options.public ? null : auth.userId;
          if (status === "PENDING_CONFIRMATION")
            await this.outboxOnly(
              client,
              root,
              "appointment.pending_confirmation",
              eventActor,
            );
          if (status === "PENDING_DEPOSIT")
            await this.outboxOnly(
              client,
              root,
              "appointment.deposit_required",
              eventActor,
            );
          if (status === "CONFIRMED")
            await this.outboxOnly(
              client,
              root,
              "appointment.confirmed",
              eventActor,
            );
          return this.summary(root);
        },
      }),
    );
    return { ...result.data, idempotencyReplayed: result.replayed };
  }

  async list(auth: AccessClaims, q: any) {
    this.denyPlatform(auth);
    const own = auth.roles.includes("NAIL_TECHNICIAN")
      ? await this.ownStaff(auth)
      : null;
    const branches = this.owner(auth) ? null : auth.branchIds;
    const rows = await this.db.query<any>(
      `SELECT DISTINCT a.* FROM appointments a LEFT JOIN appointment_items ai ON ai.tenant_id=a.tenant_id AND ai.appointment_id=a.id LEFT JOIN appointment_item_staff_assignments asa ON asa.tenant_id=ai.tenant_id AND asa.appointment_item_id=ai.id AND asa.status='ACTIVE' WHERE a.tenant_id=$1 AND ($2::uuid[] IS NULL OR a.branch_id=ANY($2)) AND ($3::uuid IS NULL OR asa.staff_id=$3) AND ($4::uuid IS NULL OR a.branch_id=$4) AND ($5::text IS NULL OR a.status=$5) AND ($6::timestamptz IS NULL OR a.end_at>$6) AND ($7::timestamptz IS NULL OR a.start_at<$7) AND ($8::text IS NULL OR lower(a.booking_reference)=lower($8) OR lower(a.contact_snapshot_json->>'displayName') LIKE '%'||lower($8)||'%') ORDER BY a.start_at LIMIT $9 OFFSET $10`,
      [
        auth.tenantId,
        branches,
        own,
        q.branchId ?? null,
        q.status ?? null,
        q.from ?? null,
        q.to ?? null,
        q.search ?? null,
        Math.min(Number(q.limit ?? 50), 100),
        Number(q.offset ?? 0),
      ],
    );
    return rows.rows.map((x) => this.summary(x));
  }

  async detail(auth: AccessClaims, id: string) {
    this.denyPlatform(auth);
    const root = (
      await this.db.query<any>(
        "SELECT * FROM appointments WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!root)
      throw new NotFoundException({
        code: "BOOKING_NOT_FOUND",
        message: "Appointment not found",
      });
    this.guardBranch(auth, root.branch_id);
    const own = auth.roles.includes("NAIL_TECHNICIAN")
      ? await this.ownStaff(auth)
      : null;
    const items = (
      await this.db.query<any>(
        "SELECT ai.*,asa.staff_id,sp.display_name staff_name,COALESCE(jsonb_agg(jsonb_build_object('resourceId',ara.resource_id,'quantity',ara.quantity,'isExclusive',ara.is_exclusive)) FILTER(WHERE ara.id IS NOT NULL),'[]') resources FROM appointment_items ai JOIN appointment_item_staff_assignments asa ON asa.tenant_id=ai.tenant_id AND asa.appointment_item_id=ai.id AND asa.assignment_role='PRIMARY' AND asa.status='ACTIVE' JOIN staff_profiles sp ON sp.tenant_id=asa.tenant_id AND sp.id=asa.staff_id LEFT JOIN appointment_item_resource_allocations ara ON ara.tenant_id=ai.tenant_id AND ara.appointment_item_id=ai.id AND ara.status='ACTIVE' WHERE ai.tenant_id=$1 AND ai.appointment_id=$2 AND ($3::uuid IS NULL OR asa.staff_id=$3) GROUP BY ai.id,asa.staff_id,sp.display_name ORDER BY ai.sequence_no",
        [auth.tenantId, id, own],
      )
    ).rows;
    if (own && !items.length)
      throw new ForbiddenException({
        code: "BOOKING_ACCESS_DENIED",
        message: "Technician can only view assigned appointment items",
      });
    return {
      ...this.summary(root),
      contact: own
        ? { displayName: root.contact_snapshot_json.displayName }
        : root.contact_snapshot_json,
      customerNote: root.customer_note,
      internalNote: own ? undefined : root.internal_note,
      policy: own ? undefined : root.policy_snapshot_json,
      items: items.map((x: any) => ({
        id: x.id,
        sequenceNo: x.sequence_no,
        status: x.status,
        serviceStartAt: x.service_start_at,
        serviceEndAt: x.service_end_at,
        service: x.service_snapshot_json,
        price: own ? undefined : x.price_snapshot_json,
        staff: { id: x.staff_id, displayName: x.staff_name },
        resources: own ? undefined : x.resources,
      })),
    };
  }

  async historyList(auth: AccessClaims, id: string) {
    await this.detail(auth, id);
    return (
      await this.db.query<any>(
        "SELECT * FROM appointment_status_history WHERE tenant_id=$1 AND appointment_id=$2 ORDER BY created_at,id",
        [auth.tenantId, id],
      )
    ).rows;
  }
  async revisions(auth: AccessClaims, id: string) {
    await this.detail(auth, id);
    return (
      await this.db.query<any>(
        "SELECT * FROM appointment_schedule_revisions WHERE tenant_id=$1 AND appointment_id=$2 ORDER BY schedule_version",
        [auth.tenantId, id],
      )
    ).rows;
  }

  async confirm(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = appointmentVersionSchema.parse(input);
    return this.command(
      auth,
      id,
      "confirm",
      key,
      body,
      async (client, root) => {
        if (root.version !== body.version) throw version();
        if (
          root.status === "PENDING_DEPOSIT" &&
          root.deposit_status !== "WAIVED"
        )
          throw new ConflictException({
            code: "APPOINTMENT_DEPOSIT_REQUIRED",
            message: "Deposit is still required",
          });
        assertAppointmentTransition(root.status, "CONFIRMED");
        const updated = (
          await client.query<any>(
            "UPDATE appointments SET status='CONFIRMED',confirmed_at=now(),confirmed_by_user_id=$3,version=version+1,updated_by_user_id=$3,updated_at=now(),expires_at=NULL WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [auth.tenantId, id, auth.userId],
          )
        ).rows[0];
        await client.query(
          "UPDATE appointment_items SET status='CONFIRMED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND appointment_id=$2 AND status='PLANNED'",
          [auth.tenantId, id],
        );
        await this.history(
          client,
          updated,
          root.status,
          "CONFIRMED",
          "USER",
          auth.userId,
          null,
          "CONFIRMED",
          requestId,
        );
        await this.event(
          client,
          updated,
          "appointment.confirmed",
          auth.userId,
          requestId,
        );
        return this.summary(updated);
      },
    );
  }

  async waiveDeposit(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = depositWaiverSchema.parse(input);
    return this.command(
      auth,
      id,
      "waive-deposit",
      key,
      body,
      async (client, root) => {
        if (root.version !== body.version) throw version();
        if (root.status !== "PENDING_DEPOSIT")
          throw new ConflictException({
            code: "BOOKING_STATUS_INVALID",
            message: "Appointment is not pending deposit",
          });
        const updated = (
          await client.query<any>(
            "UPDATE appointments SET deposit_status='WAIVED',deposit_waived_by_user_id=$3,deposit_waiver_reason=$4,status='CONFIRMED',confirmed_at=now(),confirmed_by_user_id=$3,version=version+1,updated_by_user_id=$3,updated_at=now(),expires_at=NULL WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [auth.tenantId, id, auth.userId, body.reason],
          )
        ).rows[0];
        await client.query(
          "UPDATE appointment_items SET status='CONFIRMED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND appointment_id=$2",
          [auth.tenantId, id],
        );
        await this.history(
          client,
          updated,
          root.status,
          "CONFIRMED",
          "USER",
          auth.userId,
          null,
          "DEPOSIT_WAIVED",
          requestId,
          body.reason,
        );
        await this.event(
          client,
          updated,
          "appointment.deposit_waived",
          auth.userId,
          requestId,
          { reason: body.reason },
        );
        await this.event(
          client,
          updated,
          "appointment.confirmed",
          auth.userId,
          requestId,
        );
        return this.summary(updated);
      },
    );
  }

  async cancel(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
    options: { public?: boolean; actorScope?: string } = {},
  ) {
    const body = appointmentCancelSchema.parse(input);
    return this.command(
      auth,
      id,
      "cancel",
      key,
      body,
      async (client, root) => {
        if (root.version !== body.version) throw version();
        const to = cancellationStatus(body.actorType);
        assertAppointmentTransition(root.status, to);
        const outcome = this.cancellationOutcome(root);
        const updated = (
          await client.query<any>(
            "UPDATE appointments SET status=$3,cancelled_at=now(),cancelled_by_user_id=$4,cancellation_reason_code=$5,cancellation_note=$6,cancellation_outcome=$7,version=version+1,updated_by_user_id=$4,updated_at=now(),expires_at=NULL WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [
              auth.tenantId,
              id,
              to,
              body.actorType === "USER" ? auth.userId : null,
              body.reasonCode,
              body.note ?? null,
              outcome,
            ],
          )
        ).rows[0];
        await client.query(
          "UPDATE staff_schedule_reservations SET status='RELEASED',released_at=now() WHERE tenant_id=$1 AND appointment_item_id IN (SELECT id FROM appointment_items WHERE tenant_id=$1 AND appointment_id=$2) AND status='ACTIVE'",
          [auth.tenantId, id],
        );
        await client.query(
          "UPDATE resource_schedule_reservations SET status='RELEASED',released_at=now() WHERE tenant_id=$1 AND appointment_item_id IN (SELECT id FROM appointment_items WHERE tenant_id=$1 AND appointment_id=$2) AND status='ACTIVE'",
          [auth.tenantId, id],
        );
        await client.query(
          "UPDATE appointment_items SET status='CANCELLED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND appointment_id=$2",
          [auth.tenantId, id],
        );
        await this.history(
          client,
          updated,
          root.status,
          to,
          body.actorType,
          body.actorType === "USER" ? auth.userId : null,
          body.actorType === "CUSTOMER" ? root.customer_id : null,
          body.reasonCode,
          requestId,
          body.note,
        );
        await this.event(
          client,
          updated,
          "appointment.cancelled",
          body.actorType === "USER" ? auth.userId : null,
          requestId,
          { outcome },
        );
        return this.summary(updated);
      },
      options,
    );
  }

  async reschedule(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
    options: {
      public?: boolean;
      customerId?: string;
      actorScope?: string;
    } = {},
  ) {
    this.denyPlatform(auth);
    const body = appointmentRescheduleSchema.parse(input);
    const result = await this.db.transaction((client) =>
      this.idempotency.execute(client, {
        tenantId: auth.tenantId,
        actorScope: options.actorScope ?? `user:${auth.userId}`,
        command: options.public
          ? "public.appointment.reschedule"
          : "appointment.reschedule",
        key,
        request: {
          id,
          ...body,
          replacementHoldTokenDigest: body.replacementHoldToken
            ? this.idempotency.subject(body.replacementHoldToken)
            : undefined,
          replacementHoldToken: undefined,
        },
        work: async () => {
          const initial = (
            await client.query<any>(
              "SELECT * FROM appointments WHERE tenant_id=$1 AND id=$2",
              [auth.tenantId, id],
            )
          ).rows[0];
          if (!initial)
            throw new NotFoundException({
              code: "BOOKING_NOT_FOUND",
              message: "Appointment not found",
            });
          this.guardBranch(auth, initial.branch_id);
          const hold = await this.loadHold(
            client,
            auth.tenantId,
            body.replacementHoldId,
          );
          if (hold.branch_id !== initial.branch_id)
            throw new ConflictException({
              code: "BOOKING_SERVICE_MISMATCH",
              message: "Reschedule must stay in the same branch",
            });
          const plan = await this.loadHoldPlan(client, hold);
          await this.reservations.lockPlan(client, auth.tenantId, plan);
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [`${auth.tenantId}:hold:${hold.id}`],
          );
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [`${auth.tenantId}:appointment:${id}`],
          );
          const root = (
            await client.query<any>(
              "SELECT * FROM appointments WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
              [auth.tenantId, id],
            )
          ).rows[0];
          const lockedHold = await this.loadHold(
            client,
            auth.tenantId,
            hold.id,
            true,
          );
          if (options.public) {
            if (!body.replacementHoldToken)
              throw new ForbiddenException({
                code: "SLOT_HOLD_TOKEN_INVALID",
                message: "Replacement hold token is required",
              });
            await this.tokens.verifyHold(body.replacementHoldToken, {
              tenantId: auth.tenantId,
              holdId: lockedHold.id,
              tokenVersion: lockedHold.public_token_version,
            });
          }
          if (root.version !== body.version) throw version();
          if (!["CONFIRMED", "PENDING_CONFIRMATION"].includes(root.status))
            throw new ConflictException({
              code: "APPOINTMENT_RESCHEDULE_NOT_ALLOWED",
              message:
                "Appointment cannot be rescheduled in its current status",
            });
          if (
            lockedHold.status !== "ACTIVE" ||
            new Date(lockedHold.expires_at) <= new Date()
          )
            throw new ConflictException({
              code: "SLOT_HOLD_EXPIRED",
              message: "Replacement hold has expired",
            });
          const oldItems = (
            await client.query<any>(
              "SELECT * FROM appointment_items WHERE tenant_id=$1 AND appointment_id=$2 ORDER BY sequence_no FOR UPDATE",
              [auth.tenantId, id],
            )
          ).rows;
          const newItems = (
            await client.query<any>(
              "SELECT * FROM slot_hold_items WHERE tenant_id=$1 AND slot_hold_id=$2 ORDER BY sequence_no",
              [auth.tenantId, lockedHold.id],
            )
          ).rows;
          if (
            oldItems.length !== newItems.length ||
            oldItems.some(
              (x: any, i: number) => x.service_id !== newItems[i]?.service_id,
            )
          )
            throw new ConflictException({
              code: "BOOKING_SERVICE_MISMATCH",
              message: "Reschedule cannot change services",
            });
          const previousSchedule = oldItems.map((x: any) => ({
            itemId: x.id,
            serviceId: x.service_id,
            startAt: x.service_start_at,
            endAt: x.service_end_at,
          }));
          await client.query(
            "UPDATE staff_schedule_reservations SET status='RELEASED',released_at=now() WHERE tenant_id=$1 AND appointment_item_id=ANY($2::uuid[]) AND status='ACTIVE'",
            [auth.tenantId, oldItems.map((x: any) => x.id)],
          );
          await client.query(
            "UPDATE resource_schedule_reservations SET status='RELEASED',released_at=now() WHERE tenant_id=$1 AND appointment_item_id=ANY($2::uuid[]) AND status='ACTIVE'",
            [auth.tenantId, oldItems.map((x: any) => x.id)],
          );
          const newSchedule = [] as any[];
          for (let index = 0; index < oldItems.length; index++) {
            const target = oldItems[index],
              source = newItems[index];
            await client.query(
              "UPDATE appointment_item_staff_assignments SET status='RELEASED',released_at=now(),version=version+1 WHERE tenant_id=$1 AND appointment_item_id=$2 AND status='ACTIVE'",
              [auth.tenantId, target.id],
            );
            await client.query(
              "UPDATE appointment_item_resource_allocations SET status='RELEASED',released_at=now(),version=version+1 WHERE tenant_id=$1 AND appointment_item_id=$2 AND status='ACTIVE'",
              [auth.tenantId, target.id],
            );
            await client.query(
              "UPDATE appointment_items SET status='CONFIRMED',service_start_at=$3,service_end_at=$4,staff_occupancy_start_at=$5,staff_occupancy_end_at=$6,resource_occupancy_start_at=$7,resource_occupancy_end_at=$8,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
              [
                auth.tenantId,
                target.id,
                source.service_start_at,
                source.service_end_at,
                source.staff_occupancy_start_at,
                source.staff_occupancy_end_at,
                source.resource_occupancy_start_at,
                source.resource_occupancy_end_at,
              ],
            );
            await client.query(
              "INSERT INTO appointment_item_staff_assignments(tenant_id,appointment_item_id,staff_id,assignment_role,status) VALUES($1,$2,$3,'PRIMARY','ACTIVE')",
              [auth.tenantId, target.id, source.selected_staff_id],
            );
            for (const allocation of source.resource_plan_json)
              await client.query(
                `INSERT INTO appointment_item_resource_allocations(tenant_id,appointment_item_id,resource_id,quantity,is_exclusive,status)
                 VALUES($1,$2,$3,$4,$5,'ACTIVE')
                 ON CONFLICT(tenant_id,appointment_item_id,resource_id) DO UPDATE
                 SET quantity=EXCLUDED.quantity,is_exclusive=EXCLUDED.is_exclusive,status='ACTIVE',
                     allocated_at=now(),released_at=NULL,version=appointment_item_resource_allocations.version+1`,
                [
                  auth.tenantId,
                  target.id,
                  allocation.resourceId,
                  allocation.quantity,
                  allocation.isExclusive,
                ],
              );
            await client.query(
              "UPDATE staff_schedule_reservations SET appointment_item_id=$3,slot_hold_item_id=NULL,reservation_type='APPOINTMENT',expires_at=NULL WHERE tenant_id=$1 AND slot_hold_item_id=$2 AND status='ACTIVE'",
              [auth.tenantId, source.id, target.id],
            );
            await client.query(
              "UPDATE resource_schedule_reservations SET appointment_item_id=$3,slot_hold_item_id=NULL,reservation_type='APPOINTMENT',expires_at=NULL WHERE tenant_id=$1 AND slot_hold_item_id=$2 AND status='ACTIVE'",
              [auth.tenantId, source.id, target.id],
            );
            newSchedule.push({
              itemId: target.id,
              serviceId: target.service_id,
              startAt: source.service_start_at,
              endAt: source.service_end_at,
              staffId: source.selected_staff_id,
            });
          }
          const actorUserId = options.public ? null : auth.userId;
          const nextScheduleVersion = root.schedule_version + 1;
          const updated = (
            await client.query<any>(
              "UPDATE appointments SET status='CONFIRMED',start_at=$3,end_at=$4,schedule_version=$5,version=version+1,confirmed_at=COALESCE(confirmed_at,now()),confirmed_by_user_id=COALESCE(confirmed_by_user_id,$6),updated_by_user_id=$6,updated_at=now(),expires_at=NULL WHERE tenant_id=$1 AND id=$2 RETURNING *",
              [
                auth.tenantId,
                id,
                plan.startAt,
                plan.endAt,
                nextScheduleVersion,
                actorUserId,
              ],
            )
          ).rows[0];
          await client.query(
            "INSERT INTO appointment_schedule_revisions(tenant_id,appointment_id,schedule_version,previous_start_at,previous_end_at,new_start_at,new_end_at,previous_schedule_json,new_schedule_json,actor_type,actor_user_id,actor_customer_id,reason_code,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
            [
              auth.tenantId,
              id,
              nextScheduleVersion,
              root.start_at,
              root.end_at,
              plan.startAt,
              plan.endAt,
              JSON.stringify(previousSchedule),
              JSON.stringify(newSchedule),
              options.public ? "CUSTOMER" : "USER",
              actorUserId,
              options.customerId ?? null,
              body.reasonCode,
              body.note ?? null,
            ],
          );
          await client.query(
            "UPDATE slot_holds SET status='CONSUMED',consumed_by_appointment_id=$3,consumed_at=now(),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
            [auth.tenantId, lockedHold.id, id],
          );
          await this.history(
            client,
            updated,
            root.status,
            "CONFIRMED",
            options.public ? "CUSTOMER" : "USER",
            actorUserId,
            options.customerId ?? null,
            "RESCHEDULED",
            requestId,
            body.note,
          );
          await this.event(
            client,
            updated,
            "appointment.rescheduled",
            actorUserId,
            requestId,
            {
              oldStartAt: root.start_at,
              oldEndAt: root.end_at,
              newStartAt: plan.startAt,
              newEndAt: plan.endAt,
              scheduleVersion: nextScheduleVersion,
            },
          );
          return this.summary(updated);
        },
      }),
    );
    return { ...result.data, idempotencyReplayed: result.replayed };
  }

  private async command<T>(
    auth: AccessClaims,
    id: string,
    name: string,
    key: string,
    request: unknown,
    work: (client: PoolClient, root: any) => Promise<T>,
    options: { public?: boolean; actorScope?: string } = {},
  ) {
    this.denyPlatform(auth);
    const result = await this.db.transaction((client) =>
      this.idempotency.execute(client, {
        tenantId: auth.tenantId,
        actorScope: options.actorScope ?? `user:${auth.userId}`,
        command: `${options.public ? "public." : ""}appointment.${name}`,
        key,
        request: { id, ...(request as any) },
        work: async () => {
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [`${auth.tenantId}:appointment:${id}`],
          );
          const root = (
            await client.query<any>(
              "SELECT * FROM appointments WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
              [auth.tenantId, id],
            )
          ).rows[0];
          if (!root)
            throw new NotFoundException({
              code: "BOOKING_NOT_FOUND",
              message: "Appointment not found",
            });
          this.guardBranch(auth, root.branch_id);
          return work(client, root);
        },
      }),
    );
    return { ...(result.data as any), idempotencyReplayed: result.replayed };
  }

  private async loadHold(
    client: { query: PoolClient["query"] },
    tenantId: string,
    id: string,
    lock = false,
  ) {
    const row = (
      await client.query(
        `SELECT * FROM slot_holds WHERE tenant_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
        [tenantId, id],
      )
    ).rows[0];
    if (!row)
      throw new NotFoundException({
        code: "SLOT_HOLD_NOT_FOUND",
        message: "Slot hold not found",
      });
    return row;
  }
  private async loadHoldPlan(
    client: PoolClient,
    hold: any,
  ): Promise<BookingPlan> {
    const items = (
      await client.query<any>(
        "SELECT * FROM slot_hold_items WHERE tenant_id=$1 AND slot_hold_id=$2 ORDER BY sequence_no",
        [hold.tenant_id, hold.id],
      )
    ).rows;
    const mapped = items.map((x: any) => ({
      sequenceNo: x.sequence_no,
      serviceId: x.service_id,
      staffId: x.selected_staff_id,
      serviceStartAt: new Date(x.service_start_at).toISOString(),
      serviceEndAt: new Date(x.service_end_at).toISOString(),
      staffOccupancyStartAt: new Date(x.staff_occupancy_start_at).toISOString(),
      staffOccupancyEndAt: new Date(x.staff_occupancy_end_at).toISOString(),
      resourceOccupancyStartAt: new Date(
        x.resource_occupancy_start_at,
      ).toISOString(),
      resourceOccupancyEndAt: new Date(
        x.resource_occupancy_end_at,
      ).toISOString(),
      serviceSnapshot: x.service_snapshot_json,
      priceSnapshot: x.price_snapshot_json,
      taxSnapshot: x.tax_snapshot_json,
      resourceAllocations: x.resource_plan_json,
      availabilityFingerprint: x.availability_fingerprint,
    }));
    if (!mapped.length)
      throw new ConflictException({
        code: "SLOT_HOLD_NOT_FOUND",
        message: "Slot hold has no service items",
      });
    const first = mapped[0]!,
      last = mapped[mapped.length - 1]!,
      amountMinor = mapped.reduce(
        (n: any, x: any) => n + Number(x.priceSnapshot.amountMinor ?? 0),
        0,
      ),
      currency = String(first.priceSnapshot.currency ?? "VND"),
      branch = (
        await client.query<any>(
          "SELECT timezone FROM branches WHERE tenant_id=$1 AND id=$2",
          [hold.tenant_id, hold.branch_id],
        )
      ).rows[0];
    return {
      branchId: hold.branch_id,
      timezone: branch.timezone,
      startAt: first.serviceStartAt,
      endAt: last.staffOccupancyEndAt,
      availabilityDataVersion: Number(hold.availability_data_version),
      items: mapped,
      total: { amountMinor, amount: String(amountMinor), currency },
    };
  }
  private holdView(row: any) {
    return {
      holdId: row.id,
      branchId: row.branch_id,
      status: row.status,
      expiresAt: row.expires_at,
      consumedByAppointmentId: row.consumed_by_appointment_id,
      version: row.version,
    };
  }
  private customerView(row: any) {
    return {
      id: row.id,
      displayName: row.display_name,
      phone: row.phone_normalized,
      email: row.email_normalized,
      locale: row.preferred_locale,
      status: row.status,
      isGuest: row.is_guest,
      createdAt: row.created_at,
    };
  }
  private async resolveCustomer(
    client: PoolClient,
    tenantId: string,
    input: any,
    isPublic = false,
    verificationToken?: string,
  ) {
    if (isPublic && input.customerId)
      throw new ForbiddenException({
        code: "PUBLIC_CUSTOMER_ID_NOT_ALLOWED",
        message: "Public booking cannot select an existing customer by ID",
      });
    let customer =
      !isPublic && input.customerId
        ? (
            await client.query<any>(
              "SELECT * FROM customers WHERE tenant_id=$1 AND id=$2",
              [tenantId, input.customerId],
            )
          ).rows[0]
        : null;
    if (customer) return customer;
    const phone = input.phone ? this.normalizePhone(input.phone) : null,
      email = input.email ? this.normalizeEmail(input.email) : null;
    if (isPublic) {
      if (!verificationToken)
        throw new ForbiddenException({
          code: "PUBLIC_CONTACT_VERIFICATION_REQUIRED",
          message: "Contact verification is required",
        });
      const verified = await this.tokens.verifyContact(verificationToken);
      const hash = this.contactHash(phone ?? email ?? "");
      if (verified.tenantId !== tenantId || verified.contactHash !== hash)
        throw new ForbiddenException({
          code: "BOOKING_CONTACT_NOT_VERIFIED",
          message: "Verified contact does not match booking contact",
        });
    }
    customer = (
      await client.query<any>(
        "SELECT * FROM customers WHERE tenant_id=$1 AND (($2::text IS NOT NULL AND phone_normalized=$2) OR ($3::text IS NOT NULL AND lower(email_normalized)=lower($3))) ORDER BY created_at LIMIT 1",
        [tenantId, phone, email],
      )
    ).rows[0];
    if (customer) return customer;
    return (
      await client.query<any>(
        "INSERT INTO customers(tenant_id,display_name,phone_normalized,email_normalized,preferred_locale,is_guest) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [tenantId, input.displayName, phone, email, input.locale, isPublic],
      )
    ).rows[0];
  }
  private deposit(plan: BookingPlan) {
    let total = 0;
    for (const item of plan.items) {
      const type = String(item.serviceSnapshot.depositType ?? "NONE"),
        value = Number(item.serviceSnapshot.depositValue ?? 0);
      if (type === "FIXED")
        total += Math.round(
          value * 10 ** currencyMinorUnit(String(item.priceSnapshot.currency)),
        );
      if (type === "PERCENT")
        total += Math.round(
          (Number(item.priceSnapshot.amountMinor ?? 0) * value) / 100,
        );
    }
    return total;
  }
  normalizeContact(value: string) {
    return value.includes("@")
      ? this.normalizeEmail(value)
      : this.normalizePhone(value);
  }
  normalizeEmail(value: string) {
    return value.trim().toLowerCase();
  }
  normalizePhone(value: string, countryCode = "84") {
    const digits = value.trim().replace(/\D/g, "");
    if (digits.startsWith(countryCode)) return `+${digits}`;
    if (digits.startsWith("0")) return `+${countryCode}${digits.slice(1)}`;
    if (value.trim().startsWith("+")) return `+${digits}`;
    return `+${countryCode}${digits}`;
  }
  private async reference(client: PoolClient, tenantId: string) {
    const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    for (let attempt = 0; attempt < 8; attempt++) {
      const bytes = randomBytes(8);
      let suffix = "";
      for (const byte of bytes) suffix += alphabet[byte % alphabet.length];
      const reference = `NS-${suffix}`;
      const exists = await client.query(
        "SELECT 1 FROM appointments WHERE tenant_id=$1 AND lower(booking_reference)=lower($2)",
        [tenantId, reference],
      );
      if (!exists.rowCount) return reference;
    }
    throw new ConflictException({
      code: "BOOKING_REFERENCE_CONFLICT",
      message: "Could not allocate booking reference",
    });
  }
  private async policy(client: PoolClient, tenantId: string, branchId: string) {
    const row = (
      await client.query<any>(
        "SELECT ts.booking_policy_json tenant_booking,ts.cancellation_policy_json,bs.booking_policy_json branch_booking FROM tenant_settings ts JOIN branch_settings bs ON bs.tenant_id=ts.tenant_id WHERE ts.tenant_id=$1 AND bs.branch_id=$2",
        [tenantId, branchId],
      )
    ).rows[0];
    if (!row)
      throw new ConflictException({
        code: "BOOKING_POLICY_CHANGED",
        message: "Booking policy is not configured",
      });
    const merged = { ...row.tenant_booking, ...row.branch_booking };
    return {
      holdTtlMinutes: Number(merged.holdTtlMinutes),
      activeHoldLimit: Number(merged.activeHoldLimit),
      pendingExpiryMinutes: Number(merged.pendingExpiryMinutes ?? 30),
      confirmationPolicy: String(
        merged.confirmationPolicy ?? "INTERNAL_AUTO_CONFIRM",
      ),
      snapshot: {
        ...merged,
        cancellation: row.cancellation_policy_json,
        version: Number(merged.version ?? 1),
      },
    };
  }
  private cancellationOutcome(root: any) {
    const hours = (new Date(root.start_at).getTime() - Date.now()) / 3_600_000;
    const window = Number(
      root.policy_snapshot_json?.cancellation?.cancelWindowHours ?? 24,
    );
    return hours >= window
      ? "NO_FINANCIAL_ACTION"
      : root.deposit_required_minor > 0
        ? "DEPOSIT_FORFEIT_RECOMMENDED"
        : "MANUAL_REVIEW";
  }
  private async history(
    client: PoolClient,
    root: any,
    from: string | null,
    to: string,
    actorType: string,
    actorUserId: string | null,
    actorCustomerId: string | null,
    reason: string,
    requestId: string,
    note?: string,
  ) {
    await client.query(
      "INSERT INTO appointment_status_history(tenant_id,appointment_id,from_status,to_status,actor_type,actor_user_id,actor_customer_id,reason_code,note,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        root.tenant_id,
        root.id,
        from,
        to,
        actorType,
        actorUserId,
        actorCustomerId,
        reason,
        note ?? null,
        requestId,
      ],
    );
  }
  private async event(
    client: PoolClient,
    root: any,
    eventType: string,
    actorUserId: string | null,
    requestId: string,
    extra: Record<string, unknown> = {},
  ) {
    await this.reservations.record(client, {
      tenantId: root.tenant_id,
      branchId: root.branch_id,
      actorUserId,
      action: eventType,
      aggregateType: "appointment",
      aggregateId: root.id,
      aggregateVersion: root.version,
      requestId,
      payload: {
        appointmentId: root.id,
        branchId: root.branch_id,
        status: root.status,
        startAt: root.start_at,
        endAt: root.end_at,
        version: root.version,
        refetch: true,
        ...extra,
      },
    });
  }
  private async outboxOnly(
    client: PoolClient,
    root: any,
    eventType: string,
    actorUserId: string | null,
  ) {
    await client.query(
      "INSERT INTO outbox_events(tenant_id,branch_id,event_type,aggregate_type,aggregate_id,aggregate_version,payload_json,actor_json,metadata_json) VALUES($1,$2,$3,'appointment',$4,$5,$6,$7,$8)",
      [
        root.tenant_id,
        root.branch_id,
        eventType,
        root.id,
        root.version,
        JSON.stringify({
          appointmentId: root.id,
          branchId: root.branch_id,
          status: root.status,
          refetch: true,
        }),
        JSON.stringify({
          type: actorUserId ? "USER" : "CUSTOMER",
          id: actorUserId,
        }),
        JSON.stringify({
          schemaVersion: 1,
          realtimeEvent: "calendar.event_created",
        }),
      ],
    );
  }
  private summary(row: any) {
    return {
      id: row.id,
      bookingReference: row.booking_reference,
      branchId: row.branch_id,
      customerId: row.customer_id,
      status: row.status,
      source: row.source,
      startAt: row.start_at,
      endAt: row.end_at,
      scheduleVersion: row.schedule_version,
      version: row.version,
      depositStatus: row.deposit_status,
      depositRequiredMinor: Number(row.deposit_required_minor),
      pricingSummary: row.pricing_summary_json,
      expiresAt: row.expires_at,
      cancellationOutcome: row.cancellation_outcome,
    };
  }
  private denyPlatform(auth: AccessClaims) {
    if (auth.roles.includes("PLATFORM_SUPER_ADMIN"))
      throw new ForbiddenException({
        code: "TENANT_ACCESS_DENIED",
        message: "Platform support grant is required",
      });
  }
  private owner(auth: AccessClaims) {
    return auth.roles.includes("SALON_OWNER");
  }
  private guardBranch(auth: AccessClaims, branchId: string) {
    if (!this.owner(auth) && !auth.branchIds.includes(branchId))
      throw new ForbiddenException({
        code: "BOOKING_ACCESS_DENIED",
        message: "Branch is outside membership scope",
      });
  }
  private async ownStaff(auth: AccessClaims) {
    return (
      auth.ownStaffId ??
      (
        await this.db.query<any>(
          "SELECT id FROM staff_profiles WHERE tenant_id=$1 AND membership_id=$2",
          [auth.tenantId, auth.membershipId],
        )
      ).rows[0]?.id ??
      null
    );
  }
  contactHash(contact: string) {
    return createHash("sha256")
      .update(contact.trim().toLowerCase())
      .digest("hex");
  }
}

function changed() {
  return new ConflictException({
    code: "AVAILABILITY_CHANGED",
    message: "The selected time is no longer available",
  });
}
function version() {
  return new ConflictException({
    code: "BOOKING_VERSION_CONFLICT",
    message: "Appointment version is stale",
  });
}

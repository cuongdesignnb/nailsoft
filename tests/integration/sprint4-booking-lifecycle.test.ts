import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/main";
import { DatabaseService } from "../../apps/api/src/infrastructure/database.service";

const tenantId = "10000000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000001";
const serviceId = "50000000-0000-4000-8000-000000000001";
const staffId = "47000000-0000-4000-8000-000000000003";
const customerId = "60000000-0000-4000-8000-000000000001";
const runKey = `sprint4-${Date.now()}`;

let app: Awaited<ReturnType<typeof createApp>>;
let token = "";
let holdId = "";
let appointmentId = "";
let holdToken = "";
const additionalHoldIds: string[] = [];

describe.sequential("Sprint 4 booking lifecycle", () => {
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        tenantSlug: "nailsoft-demo",
        email: "owner@example.test",
        password: "DemoPass123!",
        deviceId: runKey,
        deviceName: "Sprint 4 integration",
        platform: "web",
      },
    });
    expect(login.statusCode).toBe(200);
    token = login.json().data.accessToken;
  });

  afterAll(async () => {
    if (!app) return;
    const db = app.get(DatabaseService);
    // Appointment history is deliberately append-only. The created appointment is cancelled
    // during the test so it no longer reserves capacity, and is retained as test audit evidence.
    for (const id of additionalHoldIds) {
      await db.query(
        "DELETE FROM outbox_events WHERE tenant_id=$1 AND aggregate_id=$2",
        [tenantId, id],
      );
      await db.query(
        "DELETE FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2",
        [tenantId, id],
      );
      await db.query(
        "DELETE FROM staff_schedule_reservations WHERE tenant_id=$1 AND slot_hold_item_id IN (SELECT id FROM slot_hold_items WHERE tenant_id=$1 AND slot_hold_id=$2)",
        [tenantId, id],
      );
      await db.query(
        "DELETE FROM resource_schedule_reservations WHERE tenant_id=$1 AND slot_hold_item_id IN (SELECT id FROM slot_hold_items WHERE tenant_id=$1 AND slot_hold_id=$2)",
        [tenantId, id],
      );
      await db.query(
        "DELETE FROM slot_hold_items WHERE tenant_id=$1 AND slot_hold_id=$2",
        [tenantId, id],
      );
      await db.query("DELETE FROM slot_holds WHERE tenant_id=$1 AND id=$2", [
        tenantId,
        id,
      ]);
    }
    await app.close();
  });

  const headers = () => ({
    authorization: `Bearer ${token}`,
    "x-tenant-id": tenantId,
  });

  it("creates one durable hold, replays it idempotently, and rejects a conflicting hold", async () => {
    const availability = await app.inject({
      method: "GET",
      url: `/v1/availability?branchId=${branchId}&serviceId=${serviceId}&staffId=${staffId}&dateFrom=2026-08-10&dateTo=2026-08-10&slotIntervalMin=5`,
      headers: headers(),
    });
    expect(availability.statusCode).toBe(200);
    const availabilityData = availability.json().data;
    const slot = availabilityData.days.flatMap(
      (day: { slots: unknown[] }) => day.slots,
    )[0];
    expect(slot).toBeTruthy();

    const payload = {
      branchId,
      desiredStartAt: slot.startAt,
      availabilityDataVersion: availabilityData.dataVersion,
      source: "RECEPTION",
      clientKey: runKey,
      items: [
        {
          serviceId,
          staffPreference: { type: "SPECIFIC", staffId },
          availabilityFingerprint: slot.fingerprint,
        },
      ],
    };
    const idempotencyKey = `${runKey}-create-hold`;
    const created = await app.inject({
      method: "POST",
      url: "/v1/slot-holds",
      headers: { ...headers(), "idempotency-key": idempotencyKey },
      payload,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.status).toBe("ACTIVE");
    holdId = created.json().data.holdId;
    holdToken = created.json().data.holdToken;
    expect(holdToken).toBeTruthy();

    const replay = await app.inject({
      method: "POST",
      url: "/v1/slot-holds",
      headers: { ...headers(), "idempotency-key": idempotencyKey },
      payload,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().data.holdId).toBe(holdId);
    expect(replay.json().data.idempotencyReplayed).toBe(true);

    const conflict = await app.inject({
      method: "POST",
      url: "/v1/slot-holds",
      headers: {
        ...headers(),
        "idempotency-key": `${runKey}-conflicting-hold`,
      },
      payload: { ...payload, clientKey: `${runKey}-other` },
    });
    expect(conflict.statusCode).toBe(409);
    expect([
      "STAFF_RESERVED",
      "SLOT_UNAVAILABLE",
      "AVAILABILITY_CHANGED",
    ]).toContain(conflict.json().error.code);
  });

  it("consumes the hold once, reschedules atomically, enforces optimistic versioning, and releases the reservation on cancellation", async () => {
    const hold = await app.inject({
      method: "GET",
      url: `/v1/slot-holds/${holdId}`,
      headers: headers(),
    });
    expect(hold.statusCode).toBe(200);
    const db = app.get(DatabaseService);
    const createKey = `${runKey}-create-appointment`;
    const created = await app.inject({
      method: "POST",
      url: "/v1/appointments",
      headers: { ...headers(), "idempotency-key": createKey },
      payload: {
        holdId,
        holdToken,
        customer: { customerId, locale: "vi-VN" },
        confirm: true,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.status).toBe("CONFIRMED");
    appointmentId = created.json().data.id;
    const version = created.json().data.version;

    const replay = await app.inject({
      method: "POST",
      url: "/v1/appointments",
      headers: { ...headers(), "idempotency-key": createKey },
      payload: {
        holdId,
        holdToken,
        customer: { customerId, locale: "vi-VN" },
        confirm: true,
      },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().data.id).toBe(appointmentId);
    expect(replay.json().data.idempotencyReplayed).toBe(true);

    const availability = await app.inject({
      method: "GET",
      url: `/v1/availability?branchId=${branchId}&serviceId=${serviceId}&staffId=${staffId}&dateFrom=2026-08-10&dateTo=2026-08-10&slotIntervalMin=5`,
      headers: headers(),
    });
    expect(availability.statusCode).toBe(200);
    const availabilityData = availability.json().data;
    const replacementSlot = availabilityData.days.flatMap(
      (day: { slots: unknown[] }) => day.slots,
    )[0];
    expect(replacementSlot).toBeTruthy();
    const replacement = await app.inject({
      method: "POST",
      url: `/v1/appointments/${appointmentId}/reschedule-hold`,
      headers: {
        ...headers(),
        "idempotency-key": `${runKey}-replacement-hold`,
      },
      payload: {
        branchId,
        desiredStartAt: replacementSlot.startAt,
        availabilityDataVersion: availabilityData.dataVersion,
        clientKey: `${runKey}-replacement`,
        items: [
          {
            serviceId,
            staffPreference: { type: "SPECIFIC", staffId },
            availabilityFingerprint: replacementSlot.fingerprint,
          },
        ],
      },
    });
    expect(replacement.statusCode).toBe(201);
    const rescheduled = await app.inject({
      method: "POST",
      url: `/v1/appointments/${appointmentId}/reschedule`,
      headers: { ...headers(), "idempotency-key": `${runKey}-reschedule` },
      payload: {
        version,
        replacementHoldId: replacement.json().data.holdId,
        reasonCode: "CUSTOMER_REQUEST",
        note: "Atomic reschedule integration",
      },
    });
    expect(rescheduled.statusCode).toBe(201);
    expect(rescheduled.json().data.status).toBe("CONFIRMED");
    expect(rescheduled.json().data.scheduleVersion).toBe(2);
    expect(rescheduled.json().data.startAt).toBe(replacementSlot.startAt);
    const currentVersion = rescheduled.json().data.version;
    const revisions = await app.inject({
      method: "GET",
      url: `/v1/appointments/${appointmentId}/schedule-revisions`,
      headers: headers(),
    });
    expect(revisions.statusCode).toBe(200);
    expect(revisions.json().data).toHaveLength(1);

    const stale = await app.inject({
      method: "POST",
      url: `/v1/appointments/${appointmentId}/cancel`,
      headers: { ...headers(), "idempotency-key": `${runKey}-stale-cancel` },
      payload: { version: currentVersion + 1, reasonCode: "CUSTOMER_REQUEST" },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("BOOKING_VERSION_CONFLICT");

    const cancelled = await app.inject({
      method: "POST",
      url: `/v1/appointments/${appointmentId}/cancel`,
      headers: { ...headers(), "idempotency-key": `${runKey}-cancel` },
      payload: { version: currentVersion, reasonCode: "CUSTOMER_REQUEST" },
    });
    expect(cancelled.statusCode).toBe(201);
    expect(cancelled.json().data.status).toBe("CANCELLED_BY_SALON");
    const activeReservations = await db.query<{ count: number }>(
      "SELECT count(*)::int count FROM staff_schedule_reservations WHERE tenant_id=$1 AND appointment_item_id IN (SELECT id FROM appointment_items WHERE tenant_id=$1 AND appointment_id=$2) AND status='ACTIVE'",
      [tenantId, appointmentId],
    );
    expect(activeReservations.rows[0]?.count).toBe(0);
  });

  it("lets only one of two concurrent hold requests reserve the same technician window", async () => {
    const availability = await app.inject({
      method: "GET",
      url: `/v1/availability?branchId=${branchId}&serviceId=${serviceId}&staffId=${staffId}&dateFrom=2026-08-10&dateTo=2026-08-10&slotIntervalMin=5`,
      headers: headers(),
    });
    expect(availability.statusCode).toBe(200);
    const data = availability.json().data,
      slot = data.days.flatMap((day: { slots: unknown[] }) => day.slots)[0];
    const payload = {
      branchId,
      desiredStartAt: slot.startAt,
      availabilityDataVersion: data.dataVersion,
      source: "RECEPTION",
      items: [
        {
          serviceId,
          staffPreference: { type: "SPECIFIC", staffId },
          availabilityFingerprint: slot.fingerprint,
        },
      ],
    };
    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/v1/slot-holds",
        headers: { ...headers(), "idempotency-key": `${runKey}-concurrent-a` },
        payload: { ...payload, clientKey: `${runKey}-concurrent-a` },
      }),
      app.inject({
        method: "POST",
        url: "/v1/slot-holds",
        headers: { ...headers(), "idempotency-key": `${runKey}-concurrent-b` },
        payload: { ...payload, clientKey: `${runKey}-concurrent-b` },
      }),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([201, 409]);
    const winner = first.statusCode === 201 ? first : second;
    additionalHoldIds.push(winner.json().data.holdId);
    const released = await app.inject({
      method: "POST",
      url: `/v1/slot-holds/${winner.json().data.holdId}/release`,
      headers: {
        ...headers(),
        "idempotency-key": `${runKey}-concurrent-release`,
      },
    });
    expect(released.statusCode).toBe(201);
  });

  it("plans and reserves multiple service items sequentially", async () => {
    const availability = await app.inject({
      method: "GET",
      url: `/v1/availability?branchId=${branchId}&serviceId=${serviceId}&dateFrom=2026-08-10&dateTo=2026-08-10&slotIntervalMin=5`,
      headers: headers(),
    });
    expect(availability.statusCode).toBe(200);
    const data = availability.json().data;
    const slot = data.days.flatMap((day: { slots: unknown[] }) => day.slots)[0];
    expect(slot).toBeTruthy();
    const created = await app.inject({
      method: "POST",
      url: "/v1/slot-holds",
      headers: { ...headers(), "idempotency-key": `${runKey}-multi-service` },
      payload: {
        branchId,
        desiredStartAt: slot.startAt,
        availabilityDataVersion: data.dataVersion,
        source: "RECEPTION",
        clientKey: `${runKey}-multi-service`,
        items: [
          {
            serviceId,
            staffPreference: { type: "ANY" },
            availabilityFingerprint: slot.fingerprint,
          },
          { serviceId, staffPreference: { type: "ANY" } },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.plan.items).toHaveLength(2);
    const items = created.json().data.plan.items;
    expect(new Date(items[1].serviceStartAt).getTime()).toBeGreaterThanOrEqual(
      new Date(items[0].staffOccupancyEndAt).getTime(),
    );
    additionalHoldIds.push(created.json().data.holdId);
    const released = await app.inject({
      method: "POST",
      url: `/v1/slot-holds/${created.json().data.holdId}/release`,
      headers: { ...headers(), "idempotency-key": `${runKey}-multi-release` },
    });
    expect(released.statusCode).toBe(201);
    expect(released.json().data.status).toBe("RELEASED");
  });

  it("protects public booking creation and management with scoped OTP capabilities", async () => {
    const publicAvailability = await app.inject({
      method: "GET",
      url: `/v1/public/salons/nailsoft-demo/availability?branchId=${branchId}&serviceId=${serviceId}&dateFrom=2026-08-10&dateTo=2026-08-10&slotIntervalMin=5`,
    });
    expect(publicAvailability.statusCode).toBe(200);
    const availability = publicAvailability.json().data,
      slot = availability.days.flatMap(
        (day: { slots: unknown[] }) => day.slots,
      )[0];
    const hold = await app.inject({
      method: "POST",
      url: "/v1/public/salons/nailsoft-demo/slot-holds",
      headers: { "idempotency-key": `${runKey}-public-hold` },
      payload: {
        branchId,
        desiredStartAt: slot.startAt,
        availabilityDataVersion: availability.dataVersion,
        clientKey: `${runKey}-public-client`,
        items: [
          {
            serviceId,
            staffPreference: { type: "ANY" },
            availabilityFingerprint: slot.fingerprint,
          },
        ],
      },
    });
    expect(hold.statusCode).toBe(201);
    const holdData = hold.json().data;

    const phone = `+849${String(Date.now()).slice(-8)}`;
    const challenge = await app.inject({
      method: "POST",
      url: "/v1/public/salons/nailsoft-demo/contact-verification/request",
      payload: { contact: phone, channel: "SMS" },
    });
    expect(challenge.statusCode).toBe(201);
    const verified = await app.inject({
      method: "POST",
      url: "/v1/public/salons/nailsoft-demo/contact-verification/verify",
      payload: {
        challengeId: challenge.json().data.challengeId,
        code: challenge.json().data.testCode ?? "123456",
      },
    });
    expect(verified.statusCode).toBe(201);

    const booking = await app.inject({
      method: "POST",
      url: "/v1/public/salons/nailsoft-demo/bookings",
      headers: { "idempotency-key": `${runKey}-public-booking` },
      payload: {
        holdId: holdData.holdId,
        holdToken: holdData.holdToken,
        contactVerificationToken: verified.json().data.verificationToken,
        customer: { displayName: "Public Sprint Four", phone, locale: "vi-VN" },
        marketingConsent: false,
        confirm: true,
      },
    });
    expect(booking.statusCode).toBe(201);
    const appointment = booking.json().data;
    expect(appointment.bookingReference).toMatch(/^NS-/);

    const denied = await app.inject({
      method: "GET",
      url: `/v1/public/bookings/${appointment.bookingReference}`,
    });
    expect(denied.statusCode).toBe(401);

    const access = await app.inject({
      method: "POST",
      url: "/v1/public/bookings/access/request",
      payload: {
        bookingReference: appointment.bookingReference,
        contact: phone,
        channel: "SMS",
      },
    });
    expect(access.statusCode).toBe(201);
    expect(access.json().data.message).toContain(
      "If the booking details match",
    );
    const accessVerified = await app.inject({
      method: "POST",
      url: "/v1/public/bookings/access/verify",
      payload: {
        challengeId: access.json().data.challengeId,
        code: access.json().data.testCode ?? "123456",
      },
    });
    expect(accessVerified.statusCode).toBe(201);
    const managementToken = accessVerified.json().data.managementToken;
    const managed = await app.inject({
      method: "GET",
      url: `/v1/public/bookings/${appointment.bookingReference}`,
      headers: { authorization: `Bearer ${managementToken}` },
    });
    expect(managed.statusCode).toBe(200);
    expect(managed.json().data.internalNote).toBeUndefined();

    const cancelled = await app.inject({
      method: "POST",
      url: `/v1/public/bookings/${appointment.bookingReference}/cancel`,
      headers: {
        authorization: `Bearer ${managementToken}`,
        "idempotency-key": `${runKey}-public-cancel`,
      },
      payload: {
        version: managed.json().data.version,
        reasonCode: "CUSTOMER_REQUEST",
      },
    });
    expect(cancelled.statusCode).toBe(201);
    expect(cancelled.json().data.status).toBe("CANCELLED_BY_CUSTOMER");
  });
});

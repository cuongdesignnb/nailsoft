import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/main";
import { DatabaseService } from "../../apps/api/src/infrastructure/database.service";
import { BookingOtpProcessor } from "../../apps/worker/src/booking-otp.processor";
import { BookingOtpProvider } from "../../apps/worker/src/booking-otp.provider";

const slug = "nailsoft-demo";
const run = `${Date.now()}`;
const phone = `090${run.slice(-7)}`;

let app: Awaited<ReturnType<typeof createApp>>;
let db: DatabaseService;

describe.sequential("Sprint 4 public booking closure security", () => {
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    db = app.get(DatabaseService);
    await db.query(
      "INSERT INTO tenants(id,name,slug,status) VALUES('11000000-0000-4000-8000-000000000004','Public Isolation','public-isolation','ACTIVE') ON CONFLICT(id) DO NOTHING",
    );
  });

  afterAll(async () => {
    if (!app) return;
    await db.query(
      "DELETE FROM tenants WHERE id='11000000-0000-4000-8000-000000000004'",
    );
    await app.close();
  });

  it("completes verified booking and management while rejecting bypass and cross-tenant capabilities", async () => {
    const branches = await app.inject({
      method: "GET",
      url: `/v1/public/salons/${slug}/branches`,
    });
    expect(branches.statusCode).toBe(200);
    const branch = branches.json().data.find((item: any) => item.code === "Q1");
    expect(branch.bookingWindow.earliestDate).toMatch(/^2026-/);

    const services = await app.inject({
      method: "GET",
      url: `/v1/public/salons/${slug}/services?branchId=${branch.id}`,
    });
    expect(services.statusCode).toBe(200);
    const service = services
      .json()
      .data.find((item: any) => item.code === "SVC-1");
    expect(service).toBeTruthy();

    const availability = await app.inject({
      method: "GET",
      url: `/v1/public/salons/${slug}/availability?branchId=${branch.id}&serviceId=${service.id}&dateFrom=2026-08-10&dateTo=2026-08-10&slotIntervalMin=5`,
    });
    expect(availability.statusCode).toBe(200);
    const availabilityData = availability.json().data;
    const slot = availabilityData.days
      .flatMap((day: any) => day.slots)
      .find((candidate: any) => candidate.staffCandidates.length > 0);
    expect(slot).toBeTruthy();

    const hold = await app.inject({
      method: "POST",
      url: `/v1/public/salons/${slug}/slot-holds`,
      headers: { "idempotency-key": `public-hold-${run}` },
      payload: {
        branchId: branch.id,
        desiredStartAt: slot.startAt,
        availabilityDataVersion: availabilityData.dataVersion,
        clientKey: `public-client-${run}`,
        items: [
          {
            serviceId: service.id,
            staffPreference: { type: "ANY" },
            availabilityFingerprint: slot.fingerprint,
          },
        ],
      },
    });
    expect(hold.statusCode).toBe(201);
    const holdData = hold.json().data;

    const challenge = await app.inject({
      method: "POST",
      url: `/v1/public/salons/${slug}/contact-verification/request`,
      payload: { contact: phone, channel: "SMS" },
    });
    expect(challenge.statusCode).toBe(201);
    const challengeData = challenge.json().data;
    expect(challengeData.testCode).toBe("123456");
    const queued = await db.query<{ code_ciphertext: string }>(
      "SELECT code_ciphertext FROM booking_otp_delivery_jobs WHERE challenge_id=$1",
      [challengeData.challengeId],
    );
    expect(queued.rows[0]?.code_ciphertext).not.toContain("123456");
    const otpProcessor = new BookingOtpProcessor(new BookingOtpProvider());
    try {
      expect(await otpProcessor.run()).toBeGreaterThan(0);
      const delivery = await db.query<{ status: string }>(
        "SELECT status FROM booking_otp_delivery_jobs WHERE challenge_id=$1",
        [challengeData.challengeId],
      );
      expect(delivery.rows[0]?.status).toBe("DELIVERED");
    } finally {
      await otpProcessor.onModuleDestroy();
    }

    const verified = await app.inject({
      method: "POST",
      url: `/v1/public/salons/${slug}/contact-verification/verify`,
      payload: { challengeId: challengeData.challengeId, code: "123456" },
    });
    expect(verified.statusCode).toBe(201);
    const contactToken = verified.json().data.verificationToken;

    const bookingPayload = {
      holdId: holdData.holdId,
      holdToken: holdData.holdToken,
      contactVerificationToken: contactToken,
      customer: {
        displayName: `Public Closure ${run}`,
        phone,
        locale: "vi-VN",
      },
      marketingConsent: false,
      acceptedPolicyVersion: branch.policy.version,
      acceptedAt: new Date().toISOString(),
    };
    const bypass = await app.inject({
      method: "POST",
      url: `/v1/public/salons/${slug}/bookings`,
      headers: { "idempotency-key": `public-bypass-${run}` },
      payload: {
        ...bookingPayload,
        customer: {
          ...bookingPayload.customer,
          customerId: "60000000-0000-4000-8000-000000000001",
        },
      },
    });
    expect(bypass.statusCode).toBe(400);

    const bookingKey = `public-booking-${run}`;
    const created = await app.inject({
      method: "POST",
      url: `/v1/public/salons/${slug}/bookings`,
      headers: { "idempotency-key": bookingKey },
      payload: bookingPayload,
    });
    expect(created.statusCode).toBe(201);
    const createdData = created.json().data;
    expect(createdData.bookingReference).toMatch(/^NS-/);

    const invalidReplay = await app.inject({
      method: "POST",
      url: `/v1/public/salons/${slug}/bookings`,
      headers: { "idempotency-key": bookingKey },
      payload: { ...bookingPayload, holdToken: `${holdData.holdToken}x` },
    });
    expect(invalidReplay.statusCode).toBe(401);
    expect(invalidReplay.json().error.code).toBe("SLOT_HOLD_TOKEN_INVALID");

    const access = await app.inject({
      method: "POST",
      url: `/v1/public/salons/${slug}/bookings/access/request`,
      payload: {
        bookingReference: createdData.bookingReference,
        contact: phone,
        channel: "SMS",
      },
    });
    expect(access.statusCode).toBe(201);
    const accessData = access.json().data;
    const accessVerified = await app.inject({
      method: "POST",
      url: `/v1/public/salons/${slug}/bookings/access/verify`,
      payload: {
        challengeId: accessData.challengeId,
        code: accessData.testCode,
      },
    });
    expect(accessVerified.statusCode).toBe(201);
    const managementToken = accessVerified.json().data.managementToken;

    const crossTenant = await app.inject({
      method: "GET",
      url: `/v1/public/salons/public-isolation/bookings/${createdData.bookingReference}`,
      headers: { authorization: `Bearer ${managementToken}` },
    });
    expect(crossTenant.statusCode).toBe(403);
    expect(crossTenant.json().error.code).toBe("BOOKING_ACCESS_DENIED");

    const detail = await app.inject({
      method: "GET",
      url: `/v1/public/salons/${slug}/bookings/${createdData.bookingReference}`,
      headers: { authorization: `Bearer ${managementToken}` },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.customerId).toBeUndefined();
    expect(detail.json().data.internalNote).toBeUndefined();

    const cancelKey = `public-cancel-${run}`;
    const cancelled = await app.inject({
      method: "POST",
      url: `/v1/public/salons/${slug}/bookings/${createdData.bookingReference}/cancel`,
      headers: {
        authorization: `Bearer ${managementToken}`,
        "idempotency-key": cancelKey,
      },
      payload: {
        version: detail.json().data.version,
        reasonCode: "CUSTOMER_REQUEST",
      },
    });
    expect(cancelled.statusCode).toBe(201);
    expect(cancelled.json().data.status).toBe("CANCELLED_BY_CUSTOMER");

    const replay = await app.inject({
      method: "POST",
      url: `/v1/public/salons/${slug}/bookings/${createdData.bookingReference}/cancel`,
      headers: {
        authorization: `Bearer ${managementToken}`,
        "idempotency-key": cancelKey,
      },
      payload: {
        version: detail.json().data.version,
        reasonCode: "CUSTOMER_REQUEST",
      },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().data.idempotencyReplayed).toBe(true);
  });
});

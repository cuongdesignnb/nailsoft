import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/main";
import { DatabaseService } from "../../apps/api/src/infrastructure/database.service";

const slug = "nailsoft-demo";
const tenantId = "10000000-0000-4000-8000-000000000001";

let app: Awaited<ReturnType<typeof createApp>>;
let db: DatabaseService;
let branchId: string;
let serviceId: string;

async function setPolicy(accessMode: string, bookingEnabled: boolean) {
  await db.query("UPDATE tenants SET access_mode=$2 WHERE id=$1", [
    tenantId,
    accessMode,
  ]);
  await db.query(
    "UPDATE platform_entitlement_projections SET enabled=$3 WHERE tenant_id=$1 AND entitlement_code=$2",
    [tenantId, "booking.enabled", bookingEnabled],
  );
}

describe.sequential("Sprint 19 Wave 7 public booking foundation", () => {
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    db = app.get(DatabaseService);
    branchId = (
      await db.query<{ id: string }>(
        "SELECT id FROM branches WHERE tenant_id=$1 AND status='ACTIVE' ORDER BY id LIMIT 1",
        [tenantId],
      )
    ).rows[0].id;
    serviceId = (
      await db.query<{ id: string }>(
        "SELECT id FROM services WHERE tenant_id=$1 AND status='ACTIVE' ORDER BY id LIMIT 1",
        [tenantId],
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    await setPolicy("FULL", true);
    if (app) await app.close();
  });

  it("exposes only a safe booking capability", async () => {
    await setPolicy("FULL", true);
    const available = await app.inject({
      method: "GET",
      url: `/v1/public/salons/${slug}`,
    });
    expect(available.statusCode).toBe(200);
    expect(available.json().data).toMatchObject({ bookingAvailable: true });
    expect(available.json().data.accessMode).toBeUndefined();
    expect(available.json().data.billingState).toBeUndefined();

    await setPolicy("FULL", false);
    const unavailable = await app.inject({
      method: "GET",
      url: `/v1/public/salons/${slug}`,
    });
    expect(unavailable.statusCode).toBe(200);
    expect(unavailable.json().data.bookingAvailable).toBe(false);
    expect(unavailable.json().data.entitlementSource).toBeUndefined();
  });

  it.each(["READ_ONLY", "BILLING_ONLY", "SUSPENDED", "TERMINATED"])(
    "denies new booking operations without leaking mode for %s",
    async (accessMode) => {
      await setPolicy(accessMode, true);
      const response = await app.inject({
        method: "GET",
        url: `/v1/public/salons/${slug}/branches`,
      });
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe("PUBLIC_BOOKING_UNAVAILABLE");
      expect(response.json().error.message).not.toMatch(
        /billing|subscription|entitlement|read_only|suspended/i,
      );
    },
  );

  it("keeps read-only management lookup available without booking entitlement", async () => {
    await setPolicy("READ_ONLY", false);
    const response = await app.inject({
      method: "POST",
      url: `/v1/public/salons/${slug}/bookings/access/request`,
      payload: {
        bookingReference: "NS-NOTFOUND",
        contact: "customer@example.test",
        channel: "EMAIL",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().data.message).toMatch(/details match/i);
  });

  it("uses the same branch price offering rule for listing and direct availability", async () => {
    await setPolicy("FULL", true);
    const original = (
      await db.query<{ id: string; effective_to: string | null }>(
        "SELECT id, effective_to FROM service_prices WHERE tenant_id=$1 AND service_id=$2",
        [tenantId, serviceId],
      )
    ).rows;
    await db.query(
      "UPDATE service_prices SET effective_to=now()-interval '1 minute' WHERE tenant_id=$1 AND service_id=$2",
      [tenantId, serviceId],
    );
    try {
      const listed = await app.inject({
        method: "GET",
        url: `/v1/public/salons/${slug}/services?branchId=${branchId}`,
      });
      expect(listed.statusCode).toBe(200);
      expect(
        listed.json().data.some((item: { id: string }) => item.id === serviceId),
      ).toBe(false);

      const availability = await app.inject({
        method: "GET",
        url: `/v1/public/salons/${slug}/availability?branchId=${branchId}&serviceId=${serviceId}&dateFrom=2026-08-10&dateTo=2026-08-10&slotIntervalMin=5`,
      });
      expect(availability.statusCode).toBe(403);
      expect(availability.json().error.code).toBe("PUBLIC_SERVICE_NOT_BOOKABLE");

      const hold = await app.inject({
        method: "POST",
        url: `/v1/public/salons/${slug}/slot-holds`,
        headers: { "idempotency-key": "wave7-non-offered-service-hold" },
        payload: {
          branchId,
          desiredStartAt: "2026-08-10T02:15:00.000Z",
          availabilityDataVersion: 1,
          clientKey: "wave7-non-offered-service",
          items: [
            {
              serviceId,
              staffPreference: { type: "ANY" },
            },
          ],
        },
      });
      expect(hold.statusCode).toBe(403);
      expect(hold.json().error.code).toBe("PUBLIC_SERVICE_NOT_BOOKABLE");
    } finally {
      for (const price of original) {
        await db.query("UPDATE service_prices SET effective_to=$2 WHERE id=$1", [
          price.id,
          price.effective_to,
        ]);
      }
    }
  });
});

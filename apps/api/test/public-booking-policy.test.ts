/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicBookingService } from "../src/modules/booking/public-booking.service";
import { BookingService } from "../src/modules/booking/booking.service";

const tenant = {
  id: "10000000-0000-4000-8000-000000000001",
  slug: "nailsoft-demo",
  status: "ACTIVE",
};
const branchId = "20000000-0000-4000-8000-000000000001";
const serviceId = "50000000-0000-4000-8000-000000000001";

function subject(options: {
  policy?: Record<string, unknown>;
  serviceBookable?: boolean;
}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM tenants")) return { rows: [tenant], rowCount: 1 };
    if (sql.includes("auth_rate_limits"))
      return { rows: [{ attempt_count: 1, blocked_until: null }], rowCount: 1 };
    if (sql.includes("tenant_settings ts"))
      return {
        rows: [
          {
            tenant_policy_json: {},
            branch_policy_json: options.policy ?? {},
          },
        ],
        rowCount: 1,
      };
    if (sql.includes("SELECT id FROM services"))
      return options.serviceBookable === false
        ? { rows: [], rowCount: 0 }
        : { rows: [{ id: serviceId }], rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const availability = {
    search: vi.fn(async () => ({
      dataVersion: 1,
      days: [
        {
          slots: [
            {
              fingerprint: "a".repeat(64),
              staffCandidates: [
                {
                  staffId: "47000000-0000-4000-8000-000000000003",
                  displayName: "Private",
                },
              ],
            },
          ],
        },
      ],
    })),
  };
  const booking = {
    contactHash: (value: string) => value,
  };
  return {
    service: new PublicBookingService(
      { query } as any,
      availability as any,
      booking as any,
      {} as any,
    ),
    availability,
  };
}

describe("public booking policy boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("removes staff identity when the branch hides names", async () => {
    const { service } = subject({
      policy: { hideStaffNamesOnPublicBooking: true },
    });
    const result = await service.search(
      tenant.slug,
      {
        branchId,
        serviceId,
        dateFrom: "2026-08-10",
        dateTo: "2026-08-10",
        slotIntervalMin: 5,
      },
      "127.0.0.1",
    );
    expect(result.days[0].slots[0].staffCandidates).toEqual([]);
  });

  it("rejects a direct availability request for an offline service", async () => {
    const { service, availability } = subject({ serviceBookable: false });
    await expect(
      service.search(
        tenant.slug,
        {
          branchId,
          serviceId,
          dateFrom: "2026-08-10",
          dateTo: "2026-08-10",
          slotIntervalMin: 5,
        },
        "127.0.0.1",
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(availability.search).not.toHaveBeenCalled();
  });

  it("fails fast when production public OTP delivery is not configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_BOOKING_ENABLED", "true");
    vi.stubEnv("OTP_PEPPER", "");
    vi.stubEnv("OTP_PROVIDER", "");
    expect(() => subject({})).toThrow(/OTP_PEPPER.*OTP_PROVIDER/);
  });

  it("keeps the production public surface disabled unless explicitly enabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_BOOKING_ENABLED", "false");
    const { service } = subject({});
    await expect(service.salon(tenant.slug)).rejects.toMatchObject({
      status: 503,
    });
  });
});

describe("public contact normalization", () => {
  const booking = BookingService.prototype;

  it("normalizes equivalent Vietnamese phone forms and email casing", () => {
    expect(booking.normalizePhone("090 123 4567")).toBe("+84901234567");
    expect(booking.normalizePhone("+84 90 123 4567")).toBe("+84901234567");
    expect(booking.normalizeEmail(" Customer@Example.Test ")).toBe(
      "customer@example.test",
    );
  });
});

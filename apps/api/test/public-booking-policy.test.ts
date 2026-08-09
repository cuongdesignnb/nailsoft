/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicBookingService } from "../src/modules/booking/public-booking.service";
import { BookingService } from "../src/modules/booking/booking.service";

const tenant = {
  id: "10000000-0000-4000-8000-000000000001",
  slug: "nailsoft-demo",
  status: "ACTIVE",
  access_mode: "FULL",
  booking_enabled: true,
};
const branchId = "20000000-0000-4000-8000-000000000001";
const serviceId = "50000000-0000-4000-8000-000000000001";

function subject(options: {
  policy?: Record<string, unknown>;
  serviceBookable?: boolean;
  accessMode?: string;
  bookingEnabled?: boolean;
}) {
  const configuredTenant = {
    ...tenant,
    access_mode: options.accessMode ?? "FULL",
    booking_enabled: options.bookingEnabled ?? true,
  };
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM tenants"))
      return { rows: [configuredTenant], rowCount: 1 };
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
    if (sql.includes("FROM appointments")) return { rows: [], rowCount: 0 };
    if (sql.includes("FROM services"))
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
    normalizeContact: (value: string) => value,
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

  it.each(["READ_ONLY", "BILLING_ONLY", "SUSPENDED", "TERMINATED"])(
    "denies new booking operations for %s mode",
    async (accessMode) => {
      const { service, availability } = subject({ accessMode });
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
      ).rejects.toMatchObject({ status: 503 });
      expect(availability.search).not.toHaveBeenCalled();
    },
  );

  it("denies new booking when booking entitlement is disabled", async () => {
    const { service } = subject({ bookingEnabled: false });
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
    ).rejects.toMatchObject({ status: 503 });
  });

  it("returns a safe unavailable capability without billing details", async () => {
    const { service } = subject({ bookingEnabled: false });
    await expect(service.salon(tenant.slug)).resolves.toMatchObject({
      bookingAvailable: false,
    });
  });

  it("allows read-only management access without booking entitlement", async () => {
    const { service } = subject({ accessMode: "READ_ONLY", bookingEnabled: false });
    const result = await service.requestAccess(
      tenant.slug,
      { bookingReference: "NS-NOTFOUND", contact: "customer@example.test" },
      "127.0.0.1",
    );
    expect(result.message).toMatch(/If the booking details match/i);
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

  it("normalizes public notes and rejects unsafe controls", async () => {
    const { publicCreateAppointmentSchema, publicCustomerNoteSchema } =
      await import("@nailsoft/validation");
    expect(publicCustomerNoteSchema.parse("  Dịch vụ\r\nnhanh  ")).toBe(
      "Dịch vụ\nnhanh",
    );
    expect(() => publicCustomerNoteSchema.parse("x\u0000y")).toThrow();
    expect(() => publicCustomerNoteSchema.parse("x\u000By")).toThrow();
    expect(publicCustomerNoteSchema.parse("<b>plain text</b>")).toBe(
      "<b>plain text</b>",
    );
    expect(() =>
      publicCreateAppointmentSchema.parse({
        holdId: "00000000-0000-4000-8000-000000000001",
        holdToken: "hold-token",
        contactVerificationToken: "contact-token",
        customer: {
          displayName: "Customer",
          phone: "0901234567",
          locale: "vi-VN",
        },
        customerNote: "x\u0000y",
        marketingConsent: false,
        acceptedPolicyVersion: 1,
        acceptedAt: "2026-08-10T10:00:00+07:00",
      }),
    ).toThrow();
  });
});

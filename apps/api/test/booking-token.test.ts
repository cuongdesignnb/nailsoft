import { describe, expect, it } from "vitest";
import { BookingTokenService } from "../src/modules/booking/booking-token.service";

const tenantId = "10000000-0000-4000-8000-000000000001";
const holdId = "70000000-0000-4000-8000-000000000001";
const appointmentId = "70000000-0000-4000-8000-000000000002";

describe("Sprint 4 purpose-bound capability tokens", () => {
  const service = new BookingTokenService();

  it("binds a hold capability to tenant, hold and token version", async () => {
    const token = await service.hold({
      tenantId,
      holdId,
      tokenVersion: 2,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(
      service.verifyHold(token, { tenantId, holdId, tokenVersion: 2 }),
    ).resolves.toBeUndefined();
    await expect(
      service.verifyHold(token, { tenantId, holdId, tokenVersion: 3 }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("does not accept a contact capability as a management capability", async () => {
    const token = await service.contact({
      tenantId,
      contactHash: "a".repeat(64),
      challengeId: holdId,
    });
    await expect(service.verifyManagement(token)).rejects.toMatchObject({
      status: 401,
    });
  });

  it("normalizes the booking reference in a management capability", async () => {
    const token = await service.management({
      tenantId,
      appointmentId,
      bookingReference: "ns-demo",
      contactVerificationVersion: 4,
    });
    await expect(service.verifyManagement(token)).resolves.toMatchObject({
      tenantId,
      appointmentId,
      bookingReference: "NS-DEMO",
      contactVerificationVersion: 4,
    });
  });
});

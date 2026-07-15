import { describe, expect, it } from "vitest";
import { BookingIdempotencyService } from "../src/modules/booking/booking-idempotency.service";

describe("Sprint 4 idempotency hashing", () => {
  const service = new BookingIdempotencyService();

  it("produces the same request hash regardless of object key order", () => {
    expect(
      service.hash({
        branchId: "b",
        items: [{ serviceId: "s", staff: "ANY" }],
      }),
    ).toBe(
      service.hash({
        items: [{ staff: "ANY", serviceId: "s" }],
        branchId: "b",
      }),
    );
  });

  it("separates actor/command subjects and never retains the raw value", () => {
    const raw = "customer@example.test";
    expect(service.subject(raw)).not.toContain(raw);
    expect(service.subject(`actor-a:create:${raw}`)).not.toBe(
      service.subject(`actor-b:create:${raw}`),
    );
    expect(service.subject(`actor-a:create:${raw}`)).not.toBe(
      service.subject(`actor-a:cancel:${raw}`),
    );
  });
});

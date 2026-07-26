import { describe, expect, it } from "vitest";
import {
  arrivalOffset,
  assertSessionTransition,
  assertWalkInTransition,
  deriveAppointmentStatus,
  durationSeconds,
  sanitizeNote,
} from "../src/modules/operations/operations-domain.js";
describe("Sprint 5 operational domain", () => {
  it("enforces walk-in and session state machines", () => {
    expect(() => assertWalkInTransition("WAITING", "READY")).not.toThrow();
    expect(() => assertWalkInTransition("LEFT", "WAITING")).toThrow();
    expect(() =>
      assertSessionTransition("PENDING", "IN_PROGRESS"),
    ).not.toThrow();
    expect(() => assertSessionTransition("COMPLETED", "IN_PROGRESS")).toThrow();
  });
  it("derives partial, in-service, complete, and checkout readiness", () => {
    expect(
      deriveAppointmentStatus({
        checkedIn: true,
        itemStatuses: ["COMPLETED", "CONFIRMED"],
        sessionStatuses: ["COMPLETED", "PENDING"],
      }),
    ).toEqual({ status: "PARTIALLY_COMPLETED", checkoutReady: false });
    expect(
      deriveAppointmentStatus({
        checkedIn: true,
        itemStatuses: ["COMPLETED", "CANCELLED"],
        sessionStatuses: ["COMPLETED"],
      }),
    ).toEqual({ status: "PARTIALLY_COMPLETED", checkoutReady: true });
    expect(
      deriveAppointmentStatus({
        checkedIn: true,
        itemStatuses: ["COMPLETED"],
        sessionStatuses: ["COMPLETED"],
      }),
    ).toEqual({ status: "COMPLETED", checkoutReady: true });
    expect(
      deriveAppointmentStatus({
        checkedIn: true,
        itemStatuses: ["CONFIRMED"],
        sessionStatuses: ["PAUSED"],
      }).status,
    ).toBe("IN_SERVICE");
  });
  it("calculates arrival and work time and strips HTML", () => {
    expect(
      arrivalOffset(
        new Date("2026-01-01T10:00:00Z"),
        new Date("2026-01-01T10:17:00Z"),
      ),
    ).toEqual({ lateMinutes: 17, earlyMinutes: 0 });
    expect(durationSeconds(new Date(0), new Date(100_000), 20)).toBe(80);
    expect(sanitizeNote(" <script>x</script>Hello ")).toBe("xHello");
  });
});

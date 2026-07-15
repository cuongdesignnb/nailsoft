import { describe, expect, it } from "vitest";
import {
  assertAppointmentTransition,
  assertHoldTransition,
  cancellationStatus,
} from "../src/modules/booking/booking-state-machine";

describe("Sprint 4 booking state machines", () => {
  it("allows explicit confirmation, reschedule-in-place and cancellation transitions", () => {
    expect(() =>
      assertAppointmentTransition("PENDING_CONFIRMATION", "CONFIRMED"),
    ).not.toThrow();
    expect(() =>
      assertAppointmentTransition("CONFIRMED", "CONFIRMED"),
    ).not.toThrow();
    expect(() =>
      assertAppointmentTransition("CONFIRMED", "CANCELLED_BY_CUSTOMER"),
    ).not.toThrow();
  });

  it("keeps expired and cancelled appointments terminal", () => {
    for (const state of [
      "EXPIRED",
      "CANCELLED_BY_CUSTOMER",
      "CANCELLED_BY_SALON",
    ] as const)
      expect(() =>
        assertAppointmentTransition(state, "CONFIRMED"),
      ).toThrowError(/cannot transition/i);
  });

  it("only permits an active hold to reach a terminal state", () => {
    for (const target of ["CONSUMED", "EXPIRED", "RELEASED"] as const)
      expect(() => assertHoldTransition("ACTIVE", target)).not.toThrow();
    expect(() => assertHoldTransition("CONSUMED", "RELEASED")).toThrowError(
      /cannot transition/i,
    );
  });

  it("derives cancellation state from the authenticated actor type", () => {
    expect(cancellationStatus("USER")).toBe("CANCELLED_BY_SALON");
    expect(cancellationStatus("CUSTOMER")).toBe("CANCELLED_BY_CUSTOMER");
  });
});

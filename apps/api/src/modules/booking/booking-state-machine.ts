import { ConflictException } from "@nestjs/common";
import type { AppointmentStatus, SlotHoldStatus } from "@nailsoft/domain-types";

const transitions: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  DRAFT: [
    "PENDING_CONFIRMATION",
    "PENDING_DEPOSIT",
    "CONFIRMED",
    "EXPIRED",
    "CANCELLED_BY_CUSTOMER",
    "CANCELLED_BY_SALON",
  ],
  PENDING_CONFIRMATION: [
    "CONFIRMED",
    "PENDING_DEPOSIT",
    "EXPIRED",
    "CANCELLED_BY_CUSTOMER",
    "CANCELLED_BY_SALON",
  ],
  PENDING_DEPOSIT: [
    "CONFIRMED",
    "EXPIRED",
    "CANCELLED_BY_CUSTOMER",
    "CANCELLED_BY_SALON",
  ],
  CONFIRMED: ["CONFIRMED", "CANCELLED_BY_CUSTOMER", "CANCELLED_BY_SALON"],
  EXPIRED: [],
  CANCELLED_BY_CUSTOMER: [],
  CANCELLED_BY_SALON: [],
};

export function assertAppointmentTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
) {
  if (!transitions[from]?.includes(to))
    throw new ConflictException({
      code: "BOOKING_STATUS_INVALID",
      message: `Appointment cannot transition from ${from} to ${to}`,
    });
}

export function assertHoldTransition(from: SlotHoldStatus, to: SlotHoldStatus) {
  if (from !== "ACTIVE" || !["CONSUMED", "EXPIRED", "RELEASED"].includes(to))
    throw new ConflictException({
      code: `SLOT_HOLD_${from}`,
      message: `Slot hold cannot transition from ${from} to ${to}`,
    });
}

export function cancellationStatus(
  actorType: "USER" | "CUSTOMER",
): AppointmentStatus {
  return actorType === "CUSTOMER"
    ? "CANCELLED_BY_CUSTOMER"
    : "CANCELLED_BY_SALON";
}

import { ConflictException } from "@nestjs/common";
import type {
  AppointmentStatus,
  ServiceSessionStatus,
  WalkInStatus,
} from "@nailsoft/domain-types";

const walkInTransitions: Record<WalkInStatus, readonly WalkInStatus[]> = {
  WAITING: ["READY", "CANCELLED", "LEFT"],
  READY: ["CALLED", "WAITING", "CANCELLED", "LEFT"],
  CALLED: ["CONVERTED", "WAITING", "LEFT"],
  CONVERTED: [],
  CANCELLED: [],
  LEFT: [],
};
const sessionTransitions: Record<
  ServiceSessionStatus,
  readonly ServiceSessionStatus[]
> = {
  PENDING: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["PAUSED", "COMPLETED", "CANCELLED"],
  PAUSED: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};
export function assertWalkInTransition(from: WalkInStatus, to: WalkInStatus) {
  if (!walkInTransitions[from].includes(to))
    throw new ConflictException({
      code: "WALK_IN_STATUS_INVALID",
      message: `Walk-in cannot transition from ${from} to ${to}`,
    });
}
export function assertSessionTransition(
  from: ServiceSessionStatus,
  to: ServiceSessionStatus,
) {
  if (!sessionTransitions[from].includes(to))
    throw new ConflictException({
      code: "SERVICE_SESSION_STATUS_INVALID",
      message: `Service session cannot transition from ${from} to ${to}`,
    });
}
export function deriveAppointmentStatus(input: {
  terminal?: boolean;
  checkedIn: boolean;
  itemStatuses: string[];
  sessionStatuses: ServiceSessionStatus[];
}): { status?: AppointmentStatus; checkoutReady: boolean } {
  if (input.terminal) return { checkoutReady: false };
  const active = input.itemStatuses.filter((x) => x !== "CANCELLED"),
    completed = input.sessionStatuses.filter((x) => x === "COMPLETED").length;
  const checkoutReady =
    completed > 0 &&
    active.length === completed &&
    input.itemStatuses.every((x) => x === "CANCELLED" || x === "COMPLETED");
  if (input.sessionStatuses.some((x) => x === "IN_PROGRESS" || x === "PAUSED"))
    return { status: "IN_SERVICE", checkoutReady: false };
  if (
    active.length > 0 &&
    active.length === completed &&
    !input.itemStatuses.includes("CANCELLED")
  )
    return { status: "COMPLETED", checkoutReady: true };
  if (completed > 0) return { status: "PARTIALLY_COMPLETED", checkoutReady };
  if (input.checkedIn) return { status: "CHECKED_IN", checkoutReady: false };
  return { checkoutReady: false };
}
export function durationSeconds(
  startedAt: Date,
  endedAt: Date,
  pauseSeconds: number,
) {
  return Math.max(
    0,
    Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000) - pauseSeconds,
  );
}
export function arrivalOffset(scheduled: Date, arrived: Date) {
  const minutes = Math.floor((arrived.getTime() - scheduled.getTime()) / 60000);
  return {
    lateMinutes: Math.max(0, minutes),
    earlyMinutes: Math.max(0, -minutes),
  };
}
export function sanitizeNote(note: string) {
  return note.replace(/<[^>]*>/g, "").trim();
}

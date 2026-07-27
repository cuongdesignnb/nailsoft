import { DateTime } from "luxon";

export type RefundWindowEvidence = {
  invoiceIssuedAt: string;
  branchTimezone: string;
  refundWindowDays: number;
  localIssuedDate: string;
  localDeadlineDate: string;
  deadlineAt: string;
  evaluatedAt: string;
  outOfWindow: boolean;
};

export function branchFiscalYear(
  at: Date | string,
  branchTimezone: string,
): number {
  const instant =
    at instanceof Date ? DateTime.fromJSDate(at) : DateTime.fromISO(at);
  const local = instant.setZone(branchTimezone);
  if (!local.isValid) throw new Error("Invalid branch timezone or timestamp");
  return local.year;
}

export function refundWindowEvidence(
  invoiceIssuedAt: Date | string,
  branchTimezone: string,
  refundWindowDays: number,
  evaluatedAt: Date = new Date(),
): RefundWindowEvidence {
  const issued =
    invoiceIssuedAt instanceof Date
      ? DateTime.fromJSDate(invoiceIssuedAt)
      : DateTime.fromISO(invoiceIssuedAt);
  const localIssued = issued.setZone(branchTimezone);
  const evaluated = DateTime.fromJSDate(evaluatedAt);
  if (!localIssued.isValid || !evaluated.isValid)
    throw new Error("Invalid refund-window timestamp or branch timezone");

  // The window is based on branch-local calendar days. It closes at the end
  // of the final permitted local date, so DST-length days are handled safely.
  const deadline = localIssued
    .startOf("day")
    .plus({ days: refundWindowDays })
    .endOf("day");
  return {
    invoiceIssuedAt: issued.toUTC().toISO()!,
    branchTimezone,
    refundWindowDays,
    localIssuedDate: localIssued.toISODate()!,
    localDeadlineDate: deadline.toISODate()!,
    deadlineAt: deadline.toUTC().toISO()!,
    evaluatedAt: evaluated.toUTC().toISO()!,
    outOfWindow: evaluated > deadline,
  };
}

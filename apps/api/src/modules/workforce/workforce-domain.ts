import { createHash } from "node:crypto";

export type TimesheetState =
  "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "LOCKED" | "REOPENED";
export type PayrollRunState =
  | "DRAFT"
  | "CALCULATING"
  | "CALCULATED"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "FINALIZED"
  | "VOID_PENDING"
  | "VOIDED"
  | "FAILED";
export type PayoutState =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "PROCESSING"
  | "PARTIALLY_PAID"
  | "PAID"
  | "FAILED"
  | "CANCELLED"
  | "REVERSAL_PENDING"
  | "REVERSED";

const transitions: Record<string, readonly string[]> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["APPROVED", "REJECTED"],
  REJECTED: ["DRAFT"],
  APPROVED: ["LOCKED", "REOPENED"],
  REOPENED: ["SUBMITTED"],
  LOCKED: [],
};
export function assertTimesheetTransition(
  from: TimesheetState,
  to: TimesheetState,
) {
  if (!transitions[from]?.includes(to))
    throw new Error("TIMESHEET_STATUS_INVALID");
}
const runTransitions: Record<string, readonly string[]> = {
  DRAFT: ["CALCULATING"],
  CALCULATING: ["CALCULATED", "FAILED"],
  CALCULATED: ["CALCULATING", "PENDING_APPROVAL"],
  PENDING_APPROVAL: ["APPROVED", "CALCULATED"],
  APPROVED: ["FINALIZED", "CALCULATED"],
  FINALIZED: ["VOID_PENDING"],
  VOID_PENDING: ["VOIDED"],
  VOIDED: [],
  FAILED: ["CALCULATING"],
};
export function assertPayrollTransition(
  from: PayrollRunState,
  to: PayrollRunState,
) {
  if (!runTransitions[from]?.includes(to))
    throw new Error("PAYROLL_RUN_STATUS_INVALID");
}
const payoutTransitions: Record<string, readonly string[]> = {
  DRAFT: ["PENDING_APPROVAL", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "CANCELLED"],
  APPROVED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["PARTIALLY_PAID", "PAID", "FAILED"],
  PARTIALLY_PAID: ["PAID", "FAILED", "REVERSAL_PENDING"],
  PAID: ["REVERSAL_PENDING"],
  FAILED: ["PROCESSING", "CANCELLED"],
  CANCELLED: [],
  REVERSAL_PENDING: ["REVERSED"],
  REVERSED: [],
};
export function assertPayoutTransition(from: PayoutState, to: PayoutState) {
  if (!payoutTransitions[from]?.includes(to))
    throw new Error("PAYOUT_BATCH_STATUS_INVALID");
}
export function elapsedSeconds(start: Date, end: Date) {
  return BigInt(
    Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000)),
  );
}
export function calculateHourlyMinor(
  quantitySeconds: bigint,
  rateMinor: bigint,
  numerator = 1n,
  denominator = 1n,
) {
  if (
    quantitySeconds < 0n ||
    rateMinor < 0n ||
    numerator <= 0n ||
    denominator <= 0n
  )
    throw new Error("PAYROLL_CALCULATION_FAILED");
  const top = quantitySeconds * rateMinor * numerator,
    bottom = 3600n * denominator;
  return (top + bottom / 2n) / bottom;
}
export function calculateNetPay(
  gross: bigint,
  reimbursement: bigint,
  deductions: bigint,
  withholding: bigint,
) {
  const net = gross + reimbursement - deductions - withholding;
  if (net < 0n) throw new Error("PAYROLL_NEGATIVE_NET_PAY");
  return net;
}
export function deterministicFingerprint(value: unknown) {
  return createHash("sha256").update(stable(value)).digest("hex");
}
function stable(value: unknown): string {
  if (value === null || typeof value !== "object")
    return typeof value === "bigint" ? `"${value}"` : JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
    .join(",")}}`;
}
export function redactWorkforceEvidence(value: Record<string, unknown>) {
  const blocked = new Set([
    "bankAccount",
    "accountNumber",
    "routingNumber",
    "deviceSecret",
    "pin",
    "latitude",
    "longitude",
    "payStatement",
  ]);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !blocked.has(key))
      .map(([key, item]) => [
        key,
        typeof item === "string" && item.length > 500
          ? item.slice(0, 500)
          : item,
      ]),
  );
}
export function providerConfigured(env: NodeJS.ProcessEnv = process.env) {
  if (env.PAYOUT_PROVIDER_MODE === "FAKE")
    return env.NODE_ENV !== "production";
  return Boolean(env.PAYOUT_PROVIDER_URL && env.PAYOUT_PROVIDER_SECRET);
}

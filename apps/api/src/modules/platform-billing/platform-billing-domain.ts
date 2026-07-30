import { createHash } from "node:crypto";

export type SubscriptionStatus =
  | "DRAFT" | "TRIALING" | "ACTIVE" | "PAST_DUE" | "GRACE"
  | "READ_ONLY" | "SUSPENDED" | "CANCEL_AT_PERIOD_END" | "CANCELLED"
  | "TERMINATION_PENDING" | "TERMINATED";

const transitions: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  DRAFT: ["TRIALING", "ACTIVE", "CANCELLED"],
  TRIALING: ["ACTIVE", "CANCEL_AT_PERIOD_END", "CANCELLED", "GRACE"],
  ACTIVE: ["PAST_DUE", "CANCEL_AT_PERIOD_END", "CANCELLED"],
  PAST_DUE: ["ACTIVE", "GRACE", "CANCELLED"],
  GRACE: ["ACTIVE", "READ_ONLY", "CANCELLED"],
  READ_ONLY: ["ACTIVE", "SUSPENDED", "CANCELLED"],
  SUSPENDED: ["ACTIVE", "TERMINATION_PENDING"],
  CANCEL_AT_PERIOD_END: ["ACTIVE", "CANCELLED"],
  CANCELLED: ["ACTIVE", "TERMINATION_PENDING"],
  TERMINATION_PENDING: ["TERMINATED", "ACTIVE"],
  TERMINATED: [],
};

export function canTransitionSubscription(from: SubscriptionStatus, to: SubscriptionStatus) {
  return transitions[from].includes(to);
}

export function prorateMinor(
  priceDeltaMinor: bigint,
  remainingSeconds: bigint,
  totalPeriodSeconds: bigint,
) {
  if (totalPeriodSeconds <= 0n || remainingSeconds < 0n || remainingSeconds > totalPeriodSeconds)
    throw new Error("INVALID_PRORATION_PERIOD");
  const numerator = priceDeltaMinor * remainingSeconds;
  const absolute = numerator < 0n ? -numerator : numerator;
  const rounded = (absolute + totalPeriodSeconds / 2n) / totalPeriodSeconds;
  return numerator < 0n ? -rounded : rounded;
}

export function stablePlatformPaymentKey(tenantId: string, invoiceId: string, intentId: string) {
  return `platform-payment:${tenantId}:${invoiceId}:${intentId}`;
}

export function fingerprint(value: unknown) {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
    .join(",")}}`;
}

export function accessModeAllowsWrite(mode: string, capability: "BILLING" | "SECURITY" | "EXPORT" | "SALON") {
  if (mode === "TERMINATED") return false;
  if (["READ_ONLY", "BILLING_ONLY", "SUSPENDED"].includes(mode))
    return capability !== "SALON";
  return true;
}

export function entitlementAllows(input: {
  override?: { enabled: boolean | null; quotaLimit: bigint | null; unlimited: boolean };
  addOn?: { enabled: boolean | null; quotaLimit: bigint | null; unlimited: boolean };
  plan?: { enabled: boolean | null; quotaLimit: bigint | null; unlimited: boolean };
  legacy?: { enabled: boolean | null; quotaLimit: bigint | null; unlimited: boolean };
}) {
  return input.override ?? input.addOn ?? input.plan ?? input.legacy ?? null;
}

export function refundableMinor(paidMinor: bigint, refundedMinor: bigint) {
  const value = paidMinor - refundedMinor;
  return value > 0n ? value : 0n;
}

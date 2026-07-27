import { createHmac } from "node:crypto";
import { DateTime } from "luxon";

export const BENEFIT_APPLICATION_ORDER = [
  "PACKAGE",
  "MEMBERSHIP",
  "VOUCHER",
  "LOYALTY",
] as const;

export function normalizeVoucherCode(code: string) {
  return code
    .normalize("NFKC")
    .trim()
    .replace(/[\s-]+/g, "")
    .toUpperCase();
}

export function voucherCodeHash(code: string, tenantId: string) {
  const secret =
    process.env.VOUCHER_HMAC_SECRET ??
    process.env.JWT_SECRET ??
    "development-only-voucher-hmac-secret";
  if (
    process.env.NODE_ENV === "production" &&
    secret.startsWith("development-")
  )
    throw new Error("VOUCHER_HMAC_SECRET is required in production");
  return createHmac("sha256", secret)
    .update(`${tenantId}:${normalizeVoucherCode(code)}`)
    .digest("hex");
}

export function voucherLast4(code: string) {
  return normalizeVoucherCode(code).slice(-4).padStart(4, "*");
}

export function fixedOrPercentDiscount(input: {
  type: "FIXED" | "PERCENT";
  value: bigint;
  eligibleMinor: bigint;
  maximumMinor?: bigint | null;
}) {
  if (input.eligibleMinor <= 0n) return 0n;
  let value =
    input.type === "FIXED"
      ? input.value
      : (input.eligibleMinor * input.value + 5000n) / 10000n;
  if (input.maximumMinor != null && value > input.maximumMinor)
    value = input.maximumMinor;
  return value > input.eligibleMinor ? input.eligibleMinor : value;
}

export function loyaltyEarnPoints(
  spendMinor: bigint,
  spendMinorPerPoint: bigint,
) {
  if (spendMinor < 0n || spendMinorPerPoint <= 0n)
    throw new Error("Invalid loyalty earn basis");
  return spendMinor / spendMinorPerPoint;
}

export function loyaltyRedemptionMinor(
  points: bigint,
  redemptionPoints: bigint,
  redemptionMinor: bigint,
) {
  if (points < 0n || redemptionPoints <= 0n || redemptionMinor <= 0n)
    throw new Error("Invalid loyalty redemption ratio");
  return (points / redemptionPoints) * redemptionMinor;
}

export function packageBalance(input: {
  granted: number;
  adjustments: number;
  reserved: number;
  consumed: number;
}) {
  return input.granted + input.adjustments - input.reserved - input.consumed;
}

export function liability(input: {
  availablePoints: bigint;
  redemptionPoints: bigint;
  redemptionMinor: bigint;
  packageUnits: bigint;
  packageUnitValueMinor: bigint;
}) {
  return {
    loyaltyMinor: loyaltyRedemptionMinor(
      input.availablePoints > 0n ? input.availablePoints : 0n,
      input.redemptionPoints,
      input.redemptionMinor,
    ),
    packageMinor: input.packageUnits * input.packageUnitValueMinor,
  };
}

export function branchLocalExpiry(localDate: string, timezone: string) {
  const value = DateTime.fromISO(localDate, { zone: timezone }).endOf("day");
  if (!value.isValid)
    throw new Error("Invalid benefit expiration timezone/date");
  return value.toUTC().toISO()!;
}

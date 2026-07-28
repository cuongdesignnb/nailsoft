import {
  createHmac,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

export const giftCardTransitions: Record<string, string[]> = {
  PENDING_ACTIVATION: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["SUSPENDED", "DEPLETED", "EXPIRED", "CANCELLED", "REPLACED"],
  SUSPENDED: ["ACTIVE", "CANCELLED", "REPLACED"],
  DEPLETED: [],
  EXPIRED: [],
  CANCELLED: [],
  REPLACED: [],
};

export function assertGiftCardTransition(from: string, to: string) {
  if (!giftCardTransitions[from]?.includes(to))
    throw Object.assign(new Error("GIFT_CARD_PRODUCT_STATUS_INVALID"), {
      code: "GIFT_CARD_PRODUCT_STATUS_INVALID",
    });
}

export function minor(value: string | number | bigint) {
  const parsed = BigInt(value);
  if (parsed < 0n) throw new Error("GIFT_CARD_AMOUNT_INVALID");
  return parsed;
}

export function acceptedStoredValue(
  requested: bigint,
  available: bigint,
  eligibleDue: bigint,
) {
  if (requested <= 0n) throw new Error("GIFT_CARD_AMOUNT_INVALID");
  return [requested, available, eligibleDue].reduce((a, b) => (a < b ? a : b));
}

export function storedValueLiability(available: bigint, reserved: bigint) {
  return available + reserved;
}

export function cardHash(tenantId: string, number: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`${tenantId}:${number.replace(/\s+/g, "")}`)
    .digest("hex");
}

export function lookupKeyHash(
  tenantId: string,
  subject: string,
  secret: string,
) {
  return createHmac("sha256", secret)
    .update(`${tenantId}:lookup:${subject}`)
    .digest("hex");
}

export function generateCardCredentials() {
  const number = Array.from({ length: 16 }, () => randomInt(0, 10)).join("");
  const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
  return { number, pin, last4: number.slice(-4) };
}

export function pinHash(
  pin: string,
  tenantId: string,
  cardId: string,
  pepper: string,
) {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(
    `${tenantId}:${cardId}:${pin}:${pepper}`,
    salt,
    32,
  ).toString("hex");
  return `scrypt$${salt}$${digest}`;
}

export function verifyPin(
  pin: string,
  encoded: string | null,
  tenantId: string,
  cardId: string,
  pepper: string,
) {
  if (!encoded) return true;
  const [, salt, expectedHex] = encoded.split("$");
  if (!salt || !expectedHex) return false;
  const actual = scryptSync(`${tenantId}:${cardId}:${pin}:${pepper}`, salt, 32);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const maskCard = (last4: string) => `**** **** **** ${last4}`;

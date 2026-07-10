import { describe, expect, it } from "vitest";
import {
  assertPasswordPolicy,
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  normalizePhone,
  totp,
  verifyTotp,
} from "../src/modules/identity/identity-security";

describe("identity security primitives", () => {
  it("normalizes Vietnamese and international phone numbers", () => {
    expect(normalizePhone("090 123 4567")).toBe("+84901234567");
    expect(normalizePhone("00 1 (415) 555-2671")).toBe("+14155552671");
    expect(() => normalizePhone("123")).toThrow("PHONE_INVALID");
  });

  it("enforces the password baseline without arbitrary composition rules", () => {
    expect(() => assertPasswordPolicy("long passphrase 2026", ["owner@example.test"])).not.toThrow();
    expect(() => assertPasswordPolicy("aaaaaaaaaa")).toThrow("PASSWORD_POLICY_INVALID");
    expect(() => assertPasswordPolicy("owner@example.test", ["owner@example.test"])).toThrow("PASSWORD_POLICY_INVALID");
  });

  it("encrypts TOTP secrets and validates a bounded time window", () => {
    const secret = generateTotpSecret();
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
    const now = Date.UTC(2026, 6, 11, 0, 0, 0);
    expect(verifyTotp(secret, totp(secret, now), now)).toBe(true);
    expect(verifyTotp(secret, "000000", now)).toBe(false);
  });
});

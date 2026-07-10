import { describe, expect, it } from "vitest";
import { redactSensitive } from "../src/common/redact-sensitive";

describe("security log redaction", () => {
  it("recursively removes every Sprint 1 credential class", () => {
    const serialized = JSON.stringify(redactSensitive({
      password: "Passphrase 2026", otp: "123456", invitation: { token: "invite-raw" },
      reset: { secret: "totp-raw", recoveryCodes: ["recovery-one", "recovery-two"] }, accessToken: "jwt-secret-value", refreshToken: "refresh-secret-value",
      headers: { authorization: "Bearer token", cookie: "refreshToken=raw" }, safe: "request-id",
    }));
    for (const raw of ["Passphrase 2026", "123456", "invite-raw", "totp-raw", "recovery-one", "jwt-secret-value", "refresh-secret-value", "Bearer token", "refreshToken=raw"])
      expect(serialized).not.toContain(raw);
    expect(serialized).toContain("request-id");
  });
});

import { describe, expect, it } from "vitest";
import { redactSensitive } from "../../apps/api/src/common/redact-sensitive.js";

describe("Sprint 18 log and error redaction", () => {
  it("redacts structured credentials and raw transport secrets", () => {
    const safe = redactSensitive({ password: "pw", authorization: "Bearer abc.def", url: "postgresql://user:secret@db:5432/nailsoft", signed: "https://storage.example/x?X-Amz-Signature=secret" }) as Record<string, string>;
    expect(safe.password).toBe("[REDACTED]");
    expect(safe.authorization).toBe("[REDACTED]");
    expect(safe.url).toBe("[REDACTED_DATABASE_URL]");
    expect(safe.signed).toContain("X-Amz-Signature=[REDACTED]");
    expect(JSON.stringify(safe)).not.toMatch(/abc\.def|secret@db|Signature=secret/);
  });
});

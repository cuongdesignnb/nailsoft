import { describe, expect, it } from "vitest";
import {
  assertPayrollTransition,
  assertPayoutTransition,
  assertTimesheetTransition,
  calculateHourlyMinor,
  calculateNetPay,
  deterministicFingerprint,
  elapsedSeconds,
  providerConfigured,
  redactWorkforceEvidence,
} from "../src/modules/workforce/workforce-domain.js";
describe("Sprint 12 workforce domain", () => {
  it("enforces state machines", () => {
    expect(() => assertTimesheetTransition("DRAFT", "SUBMITTED")).not.toThrow();
    expect(() => assertTimesheetTransition("DRAFT", "LOCKED")).toThrow(
      "TIMESHEET_STATUS_INVALID",
    );
    expect(() =>
      assertPayrollTransition("APPROVED", "FINALIZED"),
    ).not.toThrow();
    expect(() => assertPayoutTransition("DRAFT", "PAID")).toThrow(
      "PAYOUT_BATCH_STATUS_INVALID",
    );
  });
  it("uses exact bigint rational rounding", () => {
    expect(calculateHourlyMinor(1800n, 10001n)).toBe(5001n);
    expect(calculateHourlyMinor(3600n, 20000n, 3n, 2n)).toBe(30000n);
    expect(calculateNetPay(10000n, 1000n, 2500n, 500n)).toBe(8000n);
    expect(() => calculateNetPay(1n, 0n, 2n, 0n)).toThrow(
      "PAYROLL_NEGATIVE_NET_PAY",
    );
  });
  it("calculates cross-midnight elapsed seconds from UTC", () =>
    expect(
      elapsedSeconds(
        new Date("2026-07-29T23:30:00+07:00"),
        new Date("2026-07-30T01:00:00+07:00"),
      ),
    ).toBe(5400n));
  it("fingerprints and redacts", () => {
    expect(deterministicFingerprint({ b: 2, a: 1 })).toBe(
      deterministicFingerprint({ a: 1, b: 2 }),
    );
    expect(
      redactWorkforceEvidence({ accountNumber: "123", safe: "ok" }),
    ).toEqual({ safe: "ok" });
  });
  it("fails closed when provider is absent and forbids fake production mode", () => {
    expect(providerConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      providerConfigured({
        NODE_ENV: "test",
        PAYOUT_PROVIDER_MODE: "FAKE",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(
      providerConfigured({
        NODE_ENV: "production",
        PAYOUT_PROVIDER_MODE: "FAKE",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      providerConfigured({
        PAYOUT_PROVIDER_URL: "https://provider.example.test",
        PAYOUT_PROVIDER_SECRET: "test-only-secret",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });
});

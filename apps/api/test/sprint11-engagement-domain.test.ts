import { describe, expect, it } from "vitest";
import {
  assertTransition,
  campaignTransitions,
  frequencyAllowed,
  isQuietHour,
  recoverySlaHours,
  reduceConsent,
  renderTemplate,
  reviewEligible,
  signPublicToken,
  verifyPublicToken,
} from "../src/modules/engagement/engagement-domain.js";

describe("Sprint 11 engagement domain", () => {
  it("reduces consent without inferring a grant", () => {
    expect(reduceConsent("NOT_GRANTED", "MIGRATION")).toBe("NOT_GRANTED");
    expect(reduceConsent("NOT_GRANTED", "GRANT")).toBe("GRANTED");
    expect(reduceConsent("GRANTED", "WITHDRAW")).toBe("WITHDRAWN");
  });
  it("signs scoped expiring public tokens", () => {
    const token = signPublicToken(
      {
        tenantId: "t",
        customerId: "c",
        purpose: "MARKETING_EMAIL",
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    expect(verifyPublicToken(token, "secret").customerId).toBe("c");
    expect(() => verifyPublicToken(`${token}x`, "secret")).toThrow(
      "PUBLIC_TOKEN_INVALID",
    );
  });
  it("renders only allowlisted escaped variables and sanitizes HTML", () => {
    expect(
      renderTemplate(
        "<b>{{name}}</b><script>x</script>",
        { name: "<Kim>" },
        ["name"],
        ["name"],
      ),
    ).toBe("<b>&lt;Kim&gt;</b>");
    expect(() => renderTemplate("{{unknown}}", {}, [], [])).toThrow(
      "FAILED_RENDER",
    );
  });
  it("enforces campaign transitions, caps and overnight quiet hours", () => {
    expect(() =>
      assertTransition(
        campaignTransitions,
        "DRAFT",
        "APPROVED",
        "CAMPAIGN_STATUS_INVALID",
      ),
    ).toThrow("CAMPAIGN_STATUS_INVALID");
    expect(frequencyAllowed(1, 2)).toBe(true);
    expect(frequencyAllowed(2, 2)).toBe(false);
    expect(isQuietHour(21, 20, 8)).toBe(true);
    expect(isQuietHour(10, 20, 8)).toBe(false);
  });
  it("requires completed, issued, verified and allowed review evidence", () => {
    expect(
      reviewEligible({
        appointmentStatus: "COMPLETED",
        invoiceStatus: "ISSUED",
        emailStatus: "VERIFIED",
        allowed: true,
      }),
    ).toBe(true);
    expect(
      reviewEligible({
        appointmentStatus: "COMPLETED",
        invoiceStatus: "ISSUED",
        emailStatus: "UNVERIFIED",
        allowed: true,
      }),
    ).toBe(false);
  });
  it("snapshots deterministic severity SLA", () => {
    expect(recoverySlaHours("CRITICAL")).toEqual([1, 24]);
    expect(recoverySlaHours("LOW")).toEqual([48, 168]);
  });
});

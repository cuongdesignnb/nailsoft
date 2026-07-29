import { describe, expect, it } from "vitest";
import { EmailProvider } from "../src/email.provider";

const request = {
  messageId: "message-1",
  recipient: "customer@example.test",
  subject: "Subject",
  html: "<p>Body</p>",
  text: "Body",
};

describe("Sprint 11 email provider boundary", () => {
  it("returns SENT but never fabricated DELIVERED in FAKE mode", async () => {
    const result = await new EmailProvider().sendEmail("FAKE", request);
    expect(result.status).toBe("SENT");
    expect(result.providerReference).toMatch(/^fake:message-1:/);
    expect(JSON.stringify(result)).not.toContain("DELIVERED");
  });

  it("fails closed when disabled or production is not configured", async () => {
    await expect(
      new EmailProvider().sendEmail("DISABLED", request),
    ).rejects.toMatchObject({ code: "EMAIL_PROVIDER_DISABLED" });
    await expect(
      new EmailProvider().sendEmail("PRODUCTION", request),
    ).rejects.toMatchObject({ code: "EMAIL_PROVIDER_NOT_CONFIGURED" });
  });
});

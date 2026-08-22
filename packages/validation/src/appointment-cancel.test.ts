import { describe, expect, it } from "vitest";
import { appointmentCancelSchema } from "./index.js";

describe("appointment cancellation command contract", () => {
  it("defaults cancellation email delivery on for backwards-compatible callers", () => {
    expect(appointmentCancelSchema.parse({ version: 3, reasonCode: "CUSTOMER_REQUEST" })).toMatchObject({
      actorType: "USER",
      sendCancellationEmail: true,
    });
  });

  it("preserves an explicit email opt-out", () => {
    expect(appointmentCancelSchema.parse({ version: 3, reasonCode: "CUSTOMER_REQUEST", sendCancellationEmail: false }).sendCancellationEmail).toBe(false);
  });
});

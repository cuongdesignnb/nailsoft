import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiSession } from "./helpers/sprint10-closure.js";
let owner: Awaited<ReturnType<typeof apiSession>>;
describe("Sprint 10 card cancellation safety", () => {
  beforeAll(async () => void (owner = await apiSession()));
  afterAll(async () => owner.app.close());
  it("denies monetary cancellation without refund evidence", async () => {
    const response = await owner.app.inject({
      method: "POST",
      url: "/v1/gift-cards/da200000-0000-4000-8000-000000000001/cancel",
      headers: owner.headers("s10-unsafe-cancel"),
      payload: { version: 1, reason: "Customer requested cancellation" },
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe(
      "GIFT_CARD_CANCELLATION_EVIDENCE_REQUIRED",
    );
  });
});

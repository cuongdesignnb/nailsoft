import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiSession, draftOrder } from "./helpers/sprint10-closure.js";
let owner: Awaited<ReturnType<typeof apiSession>>;
describe("Sprint 10 reserve fraud controls", () => {
  beforeAll(async () => void (owner = await apiSession()));
  afterAll(async () => owner.app.close());
  it("uses the persisted lookup limiter on the reserve endpoint", async () => {
    let last: any;
    for (let index = 0; index < 11; index += 1)
      last = await owner.app.inject({
        method: "POST",
        url: `/v1/pos-orders/${draftOrder}/stored-value/gift-card`,
        headers: owner.headers(`sprint10-fraud-${index}`),
        payload: {
          requestedMinor: "1000",
          number: "4999999999999999",
          version: 1,
        },
      });
    expect(last.statusCode, last.body).toBe(409);
    expect(last.json().error.code).toBe("GIFT_CARD_LOCKED");
  });
});

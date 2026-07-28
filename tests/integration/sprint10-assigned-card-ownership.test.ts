import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiSession, draftOrder } from "./helpers/sprint10-closure.js";
let session: Awaited<ReturnType<typeof apiSession>>;
describe("Sprint 10 assigned card ownership", () => {
  beforeAll(async () => void (session = await apiSession()));
  afterAll(async () => session.app.close());
  it("rejects an assigned card on another customer's order", async () => {
    const card = await session.app.inject({
      method: "GET",
      url: "/v1/gift-cards/da200000-0000-4000-8000-000000000001",
      headers: session.headers(),
    });
    const response = await session.app.inject({
      method: "POST",
      url: `/v1/pos-orders/${draftOrder}/stored-value/gift-card`,
      headers: session.headers("s10-assigned-mismatch"),
      payload: {
        requestedMinor: "10000",
        number: "4111111111111111",
        version: card.json().data.balance.version,
      },
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe("STORED_VALUE_CUSTOMER_MISMATCH");
  });
});

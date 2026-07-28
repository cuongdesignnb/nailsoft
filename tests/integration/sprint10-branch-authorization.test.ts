import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiSession } from "./helpers/sprint10-closure.js";
let manager: Awaited<ReturnType<typeof apiSession>>;
describe("Sprint 10 stored-value branch authorization", () => {
  beforeAll(
    async () => void (manager = await apiSession("manager-b@example.test")),
  );
  afterAll(async () => manager.app.close());
  it("does not expose branch A cards to a branch B manager", async () => {
    const list = await manager.app.inject({
      method: "GET",
      url: "/v1/gift-cards",
      headers: manager.headers(),
    });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().data).toEqual([]);
    const card = await manager.app.inject({
      method: "GET",
      url: "/v1/gift-cards/da200000-0000-4000-8000-000000000001",
      headers: manager.headers(),
    });
    expect(card.statusCode).toBe(404);
  });
});

import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";
test("branch manager cannot read or mutate another branch card", async () => {
  const manager = await login("manager-b@example.test");
  try {
    const card = await manager.api.get(
      "/v1/gift-cards/da200000-0000-4000-8000-000000000001",
      { headers: headers(manager) },
    );
    expect(card.status()).toBe(404);
    const command = await manager.api.post(
      "/v1/gift-cards/da200000-0000-4000-8000-000000000001/suspend",
      {
        headers: headers(manager, "s10-cross-branch-command"),
        data: { version: 1, reason: "Cross branch attempt" },
      },
    );
    expect([403, 404]).toContain(command.status());
  } finally {
    await close(manager);
  }
});

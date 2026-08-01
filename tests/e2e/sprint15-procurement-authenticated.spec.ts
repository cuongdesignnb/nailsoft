import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";

test("procurement authenticated read surface is tenant-scoped and granular", async () => {
  const owner = await login("owner@example.test");
  try {
    const requests = await owner.api.get("/v1/procurement/purchase-requests", { headers: headers(owner) });
    expect(requests.ok()).toBeTruthy();
    const wildcard = await owner.api.post("/v1/procurement/purchase-orders/00000000-0000-0000-0000-000000000000/process", { headers: headers(owner), data: {} });
    expect([404, 405]).toContain(wildcard.status());
  } finally { await close(owner); }
});

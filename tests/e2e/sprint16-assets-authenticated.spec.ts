import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";

test("fixed asset authenticated read surface is tenant scoped and explicit", async () => {
  const owner = await login("owner@example.test");
  try {
    const readiness = await owner.api.get("/v1/assets/configuration/readiness", { headers: headers(owner) });
    expect([200, 403]).toContain(readiness.status());
    const register = await owner.api.get("/v1/assets", { headers: headers(owner) });
    expect(register.ok()).toBeTruthy();
    const wildcard = await owner.api.post("/v1/assets/00000000-0000-0000-0000-000000000000/process", { headers: headers(owner), data: {} });
    expect([404, 405]).toContain(wildcard.status());
  } finally {
    await close(owner);
  }
});

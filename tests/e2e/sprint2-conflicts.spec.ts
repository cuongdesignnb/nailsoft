import { expect, test } from "@playwright/test";
import { authenticated, close } from "./auth/setup";
import { cleanupE2E } from "./helpers/database-cleanup";

test("version conflict never overwrites newer category data", async () => {
  const owner = await authenticated("owner"); const code = `CONFLICT-E2E-${Date.now()}`; const headers = { authorization: `Bearer ${owner.accessToken}`, "x-tenant-id": owner.tenantId };
  try {
    const created = await owner.api.post("/v1/service-categories", { headers, data: { code, name: { "vi-VN": "Conflict", "en-US": "Conflict" } } }); expect(created.status()).toBe(201); const id = (await created.json()).data.id;
    const first = await owner.api.patch(`/v1/service-categories/${id}`, { headers, data: { name: { "vi-VN": "First", "en-US": "First" }, version: 1 } }); expect(first.status()).toBe(200);
    const stale = await owner.api.patch(`/v1/service-categories/${id}`, { headers, data: { name: { "vi-VN": "Stale", "en-US": "Stale" }, version: 1 } }); expect(stale.status()).toBe(409); expect((await stale.json()).error.code).toBe("VERSION_CONFLICT");
  } finally { await close(owner); await cleanupE2E(code); }
});

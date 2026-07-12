import { expect, test } from "@playwright/test";
import { authenticated, close } from "./auth/setup";
import { branchA, branchB } from "./helpers/test-data";

test("owner can read both branches while manager scope is restricted", async () => {
  const owner = await authenticated("owner"); const managerA = await authenticated("managerA");
  try {
    const ownerBranches = await owner.api.get("/v1/branches", { headers: { authorization: `Bearer ${owner.accessToken}`, "x-tenant-id": owner.tenantId } }); expect(ownerBranches.status()).toBe(200); expect((await ownerBranches.json()).data.length).toBeGreaterThanOrEqual(2);
    const managerOwn = await managerA.api.get(`/v1/shifts?branchId=${branchA}`, { headers: { authorization: `Bearer ${managerA.accessToken}`, "x-tenant-id": managerA.tenantId } }); expect(managerOwn.status()).toBe(200);
    const managerOther = await managerA.api.get(`/v1/shifts?branchId=${branchB}`, { headers: { authorization: `Bearer ${managerA.accessToken}`, "x-tenant-id": managerA.tenantId } }); expect(managerOther.status()).toBe(403);
  } finally { await close(owner); await close(managerA); }
});

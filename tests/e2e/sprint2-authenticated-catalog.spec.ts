import { expect, test } from "@playwright/test";
import { authenticated, close } from "./auth/setup";
import { cleanupE2E } from "./helpers/database-cleanup";
import { branchA, names, unique } from "./helpers/test-data";

test.describe("authenticated service catalog and pricing", () => {
  test("owner completes category, service, pricing, skills, resources and add-on flows", async ({ page }) => {
    const prefix = unique("CATALOG"); const session = await authenticated("owner");
    try {
      await page.goto("/admin/catalog/categories");
      await expect(page.getByRole("heading", { name: "Service categories" })).toBeVisible();
      const root = await session.api.post("/v1/service-categories", { headers: { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId }, data: { code: `${prefix}-ROOT`, name: names("Root") } });
      expect(root.status()).toBe(201); const rootId = (await root.json()).data.id;
      const child = await session.api.post("/v1/service-categories", { headers: { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId }, data: { parentId: rootId, code: `${prefix}-CHILD`, name: names("Child") } });
      expect(child.status()).toBe(201); const childId = (await child.json()).data.id;
      const updated = await session.api.patch(`/v1/service-categories/${childId}`, { headers: { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId }, data: { name: names("Child updated"), sortOrder: 4, version: 1 } });
      expect(updated.status()).toBe(200); const updatedBody = await updated.json(); expect(updatedBody.data.name_json ?? updatedBody.data.name).toBeDefined();
      const reorder = await session.api.post("/v1/service-categories/reorder", { headers: { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId }, data: { ids: [childId, rootId] } });
      expect(reorder.status()).toBe(201); const categories = await session.api.get("/v1/service-categories", { headers: { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId } }); expect(categories.status()).toBe(200);

      const service = await session.api.post("/v1/services", { headers: { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId }, data: { categoryId: childId, code: `${prefix}-SERVICE`, name: names("E2E Service"), description: names("Description"), defaultDurationMin: 45, prepTimeMin: 5, cleanupTimeMin: 5, bookingBufferBeforeMin: 5, bookingBufferAfterMin: 5, depositType: "NONE", onlineBookingEnabled: true } });
      expect(service.status()).toBe(201); const serviceId = (await service.json()).data.id;
      const activationBeforePrice = await session.api.post(`/v1/services/${serviceId}/activate`, { headers: { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId } }); expect(activationBeforePrice.status()).toBe(409); expect((await activationBeforePrice.json()).error.code).toBe("SERVICE_ACTIVATION_INCOMPLETE");
      const price = await session.api.post(`/v1/services/${serviceId}/prices`, { headers: { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId }, data: { branchId: null, amount: 350000, currency: "VND", effectiveFrom: "2035-01-01T00:00:00.000Z", status: "ACTIVE" } }); expect(price.status()).toBe(201);
      const activated = await session.api.post(`/v1/services/${serviceId}/activate`, { headers: { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId } }); expect(activated.status()).toBe(201); expect((await activated.json()).data.status).toBe("ACTIVE");
      const overlap = await session.api.post(`/v1/services/${serviceId}/prices`, { headers: { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId }, data: { branchId: null, amount: 360000, currency: "VND", effectiveFrom: "2035-02-01T00:00:00.000Z", status: "ACTIVE" } }); expect(overlap.status()).toBe(409); expect((await overlap.json()).error.code).toBe("PRICE_OVERLAP");
      const createdSkill = await session.api.post("/v1/skills", { headers: { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId }, data: { code: `${prefix}-SKILL`, name: names("E2E Skill") } }); expect(createdSkill.status()).toBe(201); const skillId = (await createdSkill.json()).data.id;
      const skillUpdate = await session.api.patch(`/v1/skills/${skillId}`, { headers: { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId }, data: { name: names("E2E Skill Updated"), version: 1 } }); expect(skillUpdate.status()).toBe(200);
      const skill = await session.api.put(`/v1/services/${serviceId}/skills`, { headers: { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId }, data: { skills: [{ skillId, minimumProficiency: 3, isRequired: true }] } }); expect(skill.status()).toBe(200);
      const createdType = await session.api.post("/v1/resource-types", { headers: { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId }, data: { code: `${prefix}-RESOURCE-TYPE`, name: names("E2E Resource Type") } }); expect(createdType.status()).toBe(201); const resourceTypeId = (await createdType.json()).data.id;
      const createdResource = await session.api.post("/v1/resources", { headers: { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId }, data: { branchId: branchA, resourceTypeId, code: `${prefix}-RESOURCE`, name: "E2E Room", capacity: 2 } }); expect(createdResource.status()).toBe(201);
      const resource = await session.api.put(`/v1/services/${serviceId}/resources`, { headers: { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId }, data: { resources: [{ resourceTypeId, quantity: 1, isExclusive: true }] } }); expect(resource.status()).toBe(200);
      const addon = await session.api.put(`/v1/services/${serviceId}/addons`, { headers: { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId }, data: { addons: [{ addonServiceId: "50000000-0000-4000-8000-000000000001", relationshipType: "OPTIONAL", sortOrder: 0 }] } }); expect(addon.status()).toBe(200);
      const selfAddon = await session.api.put(`/v1/services/${serviceId}/addons`, { headers: { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId }, data: { addons: [{ addonServiceId: serviceId, relationshipType: "OPTIONAL", sortOrder: 0 }] } }); expect(selfAddon.status()).toBe(409); expect((await selfAddon.json()).error.code).toBe("SERVICE_SELF_ADDON");
      const cycleService = await session.api.post("/v1/services", { headers: { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId }, data: { categoryId: rootId, code: `${prefix}-CYCLE`, name: names("Cycle Service"), defaultDurationMin: 30 } }); expect(cycleService.status()).toBe(201); const cycleId = (await cycleService.json()).data.id;
      expect((await session.api.put(`/v1/services/${cycleId}/addons`, { headers: { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId }, data: { addons: [{ addonServiceId: serviceId, relationshipType: "OPTIONAL", sortOrder: 0 }] } })).status()).toBe(200);
      const cycle = await session.api.put(`/v1/services/${serviceId}/addons`, { headers: { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId }, data: { addons: [{ addonServiceId: cycleId, relationshipType: "OPTIONAL", sortOrder: 0 }] } }); expect(cycle.status()).toBe(409); expect((await cycle.json()).error.code).toBe("SERVICE_ADDON_CYCLE");
      const archiveActiveCategory = await session.api.post(`/v1/service-categories/${childId}/archive`, { headers: { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId } }); expect(archiveActiveCategory.status()).toBe(409); expect((await archiveActiveCategory.json()).error.code).toBe("CATEGORY_HAS_ACTIVE_SERVICES");
      const deactivate = await session.api.post(`/v1/services/${serviceId}/deactivate`, { headers: { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId } }); expect(deactivate.status()).toBe(201);
      const archived = await session.api.post(`/v1/service-categories/${childId}/archive`, { headers: { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId } }); expect(archived.status()).toBe(201);
      const reload = await session.api.get(`/v1/services/${serviceId}`, { headers: { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId } }); expect(reload.status()).toBe(200); expect((await reload.json()).data.code).toBe(`${prefix}-SERVICE`);
    } finally { await close(session); await cleanupE2E(prefix); }
  });
});

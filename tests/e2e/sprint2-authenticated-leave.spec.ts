import { expect, test } from "@playwright/test";
import { authenticated, close } from "./auth/setup";
import { branchA, technicianAStaff } from "./helpers/test-data";

test("technician creates own leave and manager reviews it", async () => {
  const technician = await authenticated("technicianA"); const manager = await authenticated("managerA"); const headers = (session: typeof technician) => ({ authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId });
  try {
    const created = await technician.api.post("/v1/leave-requests", { headers: headers(technician), data: { staffId: technicianAStaff, branchId: branchA, leaveType: "PERSONAL", startAt: "2037-07-01T09:00:00.000Z", endAt: "2037-07-01T17:00:00.000Z", reason: "E2E technician leave" } }); expect(created.status()).toBe(201); const id = (await created.json()).data.id;
    const submitted = await technician.api.post(`/v1/leave-requests/${id}/submit`, { headers: headers(technician) }); expect(submitted.status()).toBe(201); expect((await submitted.json()).data.status).toBe("PENDING");
    const own = await technician.api.get("/v1/leave-requests", { headers: headers(technician) }); expect(own.status()).toBe(200); expect((await own.json()).data.every((row: { staffId: string }) => row.staffId === technicianAStaff)).toBeTruthy();
    const approved = await manager.api.post(`/v1/leave-requests/${id}/approve`, { headers: headers(manager), data: { reviewNote: "Approved in authenticated E2E" } }); expect(approved.status()).toBe(201); expect((await approved.json()).data.status).toBe("APPROVED");
  } finally { await close(technician); await close(manager); }
});

test("branch, role and platform authorization boundaries deny writes", async () => {
  const managerB = await authenticated("managerB"); const technician = await authenticated("technicianA"); const platform = await authenticated("platform");
  try {
    const crossBranch = await managerB.api.get("/v1/leave-requests?branchId=" + branchA, { headers: { authorization: `Bearer ${managerB.accessToken}`, "x-tenant-id": managerB.tenantId } }); expect(crossBranch.status()).toBe(403);
    const approve = await technician.api.post("/v1/leave-requests/49000000-0000-4000-8000-000000000001/approve", { headers: { authorization: `Bearer ${technician.accessToken}`, "x-tenant-id": technician.tenantId }, data: { reviewNote: "not allowed" } }); expect(approve.status()).toBe(403);
    const platformData = await platform.api.get("/v1/services", { headers: { authorization: `Bearer ${platform.accessToken}`, "x-tenant-id": platform.tenantId } }); expect(platformData.status()).toBe(403);
  } finally { await close(managerB); await close(technician); await close(platform); }
});

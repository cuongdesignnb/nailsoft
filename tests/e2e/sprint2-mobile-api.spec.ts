import { expect, test } from "@playwright/test";
import { authenticated, close } from "./auth/setup";
import { cleanupE2E } from "./helpers/database-cleanup";
import { branchA, technicianAStaff, unique } from "./helpers/test-data";

test("Staff Mobile API integration uses real session, profile, branches, skills, shifts and leave", async () => {
  const prefix = unique("MOBILE-STAFF"); const staff = await authenticated("technicianA"); const headers = { authorization: `Bearer ${staff.accessToken}`, "x-tenant-id": staff.tenantId };
  try {
    const profile = await staff.api.get("/v1/staff/me", { headers }); expect(profile.status()).toBe(200); const staffId = (await profile.json()).data.id;
    const branches = await staff.api.get(`/v1/staff/${staffId}/branches`, { headers }); expect(branches.status()).toBe(200);
    const skills = await staff.api.get(`/v1/staff/${staffId}/skills`, { headers }); expect(skills.status()).toBe(200);
    const shifts = await staff.api.get(`/v1/shifts?staffId=${staffId}`, { headers }); expect(shifts.status()).toBe(200);
    const leave = await staff.api.post("/v1/leave-requests", { headers, data: { staffId: technicianAStaff, branchId: branchA, leaveType: "PERSONAL", startAt: "2038-01-01T09:00:00.000Z", endAt: "2038-01-01T17:00:00.000Z", reason: prefix } }); expect(leave.status()).toBe(201); const id = (await leave.json()).data.id;
    const submitted = await staff.api.post(`/v1/leave-requests/${id}/submit`, { headers }); expect(submitted.status()).toBe(201);
  } finally { await close(staff); await cleanupE2E(prefix); }
});

test("Owner Mobile API integration loads service/staff/shift/leave and reviews leave", async () => {
  const prefix = unique("MOBILE-OWNER"); const owner = await authenticated("owner"); const technician = await authenticated("technicianA"); const headers = { authorization: `Bearer ${owner.accessToken}`, "x-tenant-id": owner.tenantId };
  try {
    const services = await owner.api.get("/v1/services?status=ACTIVE&page=1&pageSize=20", { headers }); expect(services.status()).toBe(200); const serviceId = (await services.json()).data[0].id;
    const detail = await owner.api.get(`/v1/services/${serviceId}`, { headers }); expect(detail.status()).toBe(200);
    const staff = await owner.api.get("/v1/staff?status=ACTIVE", { headers }); expect(staff.status()).toBe(200); const staffId = (await staff.json()).data[0].id;
    const staffDetail = await owner.api.get(`/v1/staff/${staffId}`, { headers }); expect(staffDetail.status()).toBe(200);
    const shifts = await owner.api.get("/v1/shifts", { headers }); expect(shifts.status()).toBe(200);
    const leave = await owner.api.get("/v1/leave-requests?status=PENDING", { headers }); expect(leave.status()).toBe(200);
    const techHeaders = { authorization: `Bearer ${technician.accessToken}`, "x-tenant-id": technician.tenantId }; const created = await technician.api.post("/v1/leave-requests", { headers: techHeaders, data: { staffId: technicianAStaff, branchId: branchA, leaveType: "PERSONAL", startAt: "2038-02-01T09:00:00.000Z", endAt: "2038-02-01T17:00:00.000Z", reason: prefix } }); expect(created.status()).toBe(201); const id = (await created.json()).data.id;
    expect((await technician.api.post(`/v1/leave-requests/${id}/submit`, { headers: techHeaders })).status()).toBe(201); const approved = await owner.api.post(`/v1/leave-requests/${id}/approve`, { headers, data: { reviewNote: "Owner Mobile review" } }); expect(approved.status()).toBe(201); expect((await approved.json()).data.status).toBe("APPROVED");
  } finally { await close(owner); await close(technician); await cleanupE2E(prefix); }
});

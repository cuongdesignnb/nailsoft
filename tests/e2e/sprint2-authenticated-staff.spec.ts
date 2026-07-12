import { expect, test } from "@playwright/test";
import { authenticated, close } from "./auth/setup";
import { cleanupE2E } from "./helpers/database-cleanup";
import { branchA, branchB, seedSkill, unique } from "./helpers/test-data";

test("owner and branch manager complete staff profile, assignment and skills flows", async () => {
  const prefix = unique("STAFF"); const owner = await authenticated("owner"); const managerB = await authenticated("managerB");
  try {
    const staff = await owner.api.post("/v1/staff", { headers: { authorization: `Bearer ${owner.accessToken}`, "x-tenant-id": owner.tenantId }, data: { membershipId: null, employeeCode: prefix, displayName: "E2E Staff", employmentType: "FULL_TIME", preferredLocale: "vi-VN", hireDate: "2035-01-01" } });
    expect(staff.status()).toBe(201); const staffId = (await staff.json()).data.id;
    const detail = await owner.api.get(`/v1/staff/${staffId}`, { headers: { authorization: `Bearer ${owner.accessToken}`, "x-tenant-id": owner.tenantId } }); expect(detail.status()).toBe(200); expect((await detail.json()).data.displayName).toBe("E2E Staff");
    const assignment = await owner.api.post(`/v1/staff/${staffId}/branches`, { headers: { authorization: `Bearer ${owner.accessToken}`, "x-tenant-id": owner.tenantId }, data: { branchId: branchA, isPrimary: true, canBeBooked: true, effectiveFrom: "2035-01-01" } }); expect(assignment.status()).toBe(201);
    const duplicate = await owner.api.post(`/v1/staff/${staffId}/branches`, { headers: { authorization: `Bearer ${owner.accessToken}`, "x-tenant-id": owner.tenantId }, data: { branchId: branchA, isPrimary: false, canBeBooked: true, effectiveFrom: "2035-02-01" } }); expect(duplicate.status()).toBe(409); expect((await duplicate.json()).error.code).toBe("STAFF_BRANCH_ASSIGNMENT_OVERLAP");
    const secondPrimary = await owner.api.post(`/v1/staff/${staffId}/branches`, { headers: { authorization: `Bearer ${owner.accessToken}`, "x-tenant-id": owner.tenantId }, data: { branchId: branchB, isPrimary: true, canBeBooked: true, effectiveFrom: "2035-01-01" } }); expect(secondPrimary.status()).toBe(201);
    const skills = await owner.api.put(`/v1/staff/${staffId}/skills`, { headers: { authorization: `Bearer ${owner.accessToken}`, "x-tenant-id": owner.tenantId }, data: { skills: [{ skillId: seedSkill, proficiencyLevel: 4, certifiedAt: "2035-01-01", expiresAt: "2036-01-01" }] } }); expect(skills.status()).toBe(200);
    const invalidSkill = await owner.api.put(`/v1/staff/${staffId}/skills`, { headers: { authorization: `Bearer ${owner.accessToken}`, "x-tenant-id": owner.tenantId }, data: { skills: [{ skillId: seedSkill, proficiencyLevel: 6 }] } }); expect(invalidSkill.status()).toBe(400);
    const outsideScope = await managerB.api.post(`/v1/staff/${staffId}/branches`, { headers: { authorization: `Bearer ${managerB.accessToken}`, "x-tenant-id": managerB.tenantId }, data: { branchId: branchA, isPrimary: false, canBeBooked: true, effectiveFrom: "2037-01-01" } }); expect(outsideScope.status()).toBe(403);
    const assignments = await owner.api.get(`/v1/staff/${staffId}/branches`, { headers: { authorization: `Bearer ${owner.accessToken}`, "x-tenant-id": owner.tenantId } }); expect(assignments.status()).toBe(200); const assignmentRows = (await assignments.json()).data; expect(assignmentRows.length).toBe(2); expect(assignmentRows.filter((row: { isPrimary: boolean }) => row.isPrimary)).toHaveLength(1);
  } finally { await close(owner); await close(managerB); await cleanupE2E(prefix); }
});

test("receptionist cannot write staff or pricing APIs", async () => {
  const prefix = unique("DENY"); const receptionist = await authenticated("receptionist");
  try {
    const staff = await receptionist.api.post("/v1/staff", { headers: { authorization: `Bearer ${receptionist.accessToken}`, "x-tenant-id": receptionist.tenantId }, data: { employeeCode: prefix, displayName: "Denied", employmentType: "FULL_TIME", preferredLocale: "vi-VN" } }); expect(staff.status()).toBe(403);
    const price = await receptionist.api.post("/v1/services/50000000-0000-4000-8000-000000000001/prices", { headers: { authorization: `Bearer ${receptionist.accessToken}`, "x-tenant-id": receptionist.tenantId }, data: { branchId: branchA, amount: 1, currency: "VND", effectiveFrom: "2037-01-01T00:00:00.000Z", status: "ACTIVE" } }); expect(price.status()).toBe(403);
  } finally { await close(receptionist); await cleanupE2E(prefix); }
});

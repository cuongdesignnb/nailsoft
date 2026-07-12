import { expect, test } from "@playwright/test";
import { authenticated, close } from "./auth/setup";
import { branchA, technicianAStaff, technicianBStaff } from "./helpers/test-data";

test("owner creates shifts and concurrent publish yields one success and SHIFT_OVERLAP", async () => {
  const owner = await authenticated("owner"); const headers = { authorization: `Bearer ${owner.accessToken}`, "x-tenant-id": owner.tenantId };
  const shiftIds: string[] = []; const day = 1 + (Date.now() % 20); const date = `2040-05-${String(day).padStart(2, "0")}`;
  try {
    const create = async () => owner.api.post("/v1/shifts", { headers, data: { branchId: branchA, staffId: technicianAStaff, startAt: `${date}T09:00:00.000Z`, endAt: `${date}T10:00:00.000Z`, breakMinutes: 0, source: "IMPORT" } });
    const first = await create(); const second = await create(); expect(first.status()).toBe(201); expect(second.status()).toBe(201);
    const firstId = (await first.json()).data.id; const secondId = (await second.json()).data.id; shiftIds.push(firstId, secondId);
    const published = await Promise.all([owner.api.post(`/v1/shifts/${firstId}/publish`, { headers }), owner.api.post(`/v1/shifts/${secondId}/publish`, { headers })]);
    expect(published.filter((response) => response.status() === 201)).toHaveLength(1); const loser = published.find((response) => response.status() !== 201); expect(loser).toBeDefined(); expect((await loser?.json()).error.code).toBe("SHIFT_OVERLAP");
    const list = await owner.api.get(`/v1/shifts?staffId=${technicianAStaff}&from=${date}T00:00:00.000Z&to=${date}T23:59:59.000Z`, { headers }); const rows = (await list.json()).data.filter((row: { id: string }) => shiftIds.includes(row.id)); expect(rows.filter((row: { status: string }) => row.status === "PUBLISHED")).toHaveLength(1);
    const invalid = await owner.api.post("/v1/shifts", { headers, data: { branchId: branchA, staffId: technicianBStaff, startAt: "2037-06-01T09:00:00.000Z", endAt: "2037-06-01T10:00:00.000Z", breakMinutes: 0, source: "IMPORT" } }); expect(invalid.status()).toBe(409); expect((await invalid.json()).error.code).toBe("SHIFT_BRANCH_ASSIGNMENT_REQUIRED");
  } finally { for (const id of shiftIds) await owner.api.post(`/v1/shifts/${id}/cancel`, { headers }).catch(() => undefined); await close(owner); }
});

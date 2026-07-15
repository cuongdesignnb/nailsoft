import { expect, test } from "@playwright/test";
import pg from "pg";
import { authenticated, close } from "./auth/setup";
import { branchA, technicianAStaff } from "./helpers/test-data";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft";
const tenantId = "10000000-0000-4000-8000-000000000001";
const serviceId = "50000000-0000-4000-8000-000000000001";
const resourceTypeId = "45000000-0000-4000-8000-000000000001";

test("inactive branch blocks availability and new busy writes but preserves historical calendar", async () => {
  const owner = await authenticated("owner");
  const headers = {
    authorization: `Bearer ${owner.accessToken}`,
    "x-tenant-id": owner.tenantId,
  };
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("UPDATE branches SET status='INACTIVE' WHERE id=$1", [branchA]);
    const availability = await owner.api.get(
      `/v1/availability?branchId=${branchA}&serviceId=${serviceId}&dateFrom=2026-08-10&dateTo=2026-08-10&slotIntervalMin=15`,
      { headers },
    );
    expect(availability.status()).toBe(409);
    expect((await availability.json()).error.code).toBe(
      "AVAILABILITY_BRANCH_INACTIVE",
    );
    const calendar = await owner.api.get(
      `/v1/calendar/events?branchId=${branchA}&from=2026-08-10T00:00:00%2B07:00&to=2026-08-11T00:00:00%2B07:00`,
      { headers },
    );
    expect(calendar.status()).toBe(200);
    const write = await owner.api.post("/v1/availability-blocks", {
      headers,
      data: {
        branchId: branchA,
        staffId: technicianAStaff,
        blockType: "MANUAL",
        title: "must-not-write-inactive",
        startAt: "2044-01-01T09:00:00+07:00",
        endAt: "2044-01-01T09:30:00+07:00",
      },
    });
    expect(write.status()).toBe(409);
    expect((await write.json()).error.code).toBe("AVAILABILITY_BRANCH_INACTIVE");
  } finally {
    await db.query("UPDATE branches SET status='ACTIVE' WHERE id=$1", [branchA]);
    await db.end();
    await close(owner);
  }
});

test("Availability Explain treats partial maintenance as warning and insufficient capacity as blocking", async () => {
  const owner = await authenticated("owner");
  const headers = {
    authorization: `Bearer ${owner.accessToken}`,
    "x-tenant-id": owner.tenantId,
  };
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const resources = await db.query<{ id: string; status: string }>(
    "SELECT id,status FROM resources WHERE tenant_id=$1 AND branch_id=$2 AND resource_type_id=$3 ORDER BY id",
    [tenantId, branchA, resourceTypeId],
  );
  try {
    await db.query(
      "UPDATE resources SET status='ACTIVE' WHERE id=ANY($1::uuid[])",
      [resources.rows.map((row) => row.id)],
    );
    const search = await owner.api.get(
      `/v1/availability?branchId=${branchA}&serviceId=${serviceId}&dateFrom=2026-08-10&dateTo=2026-08-10&slotIntervalMin=15`,
      { headers },
    );
    const startAt = (await search.json()).data.days[0].slots[0].startAt;
    await db.query("UPDATE resources SET status='MAINTENANCE' WHERE id=$1", [
      resources.rows[0]!.id,
    ]);
    const partial = await owner.api.post("/v1/availability/explain", {
      headers,
      data: { branchId: branchA, serviceId, startAt },
    });
    const partialData = (await partial.json()).data;
    expect(partialData.available).toBe(true);
    expect(partialData.blockingReasons).toEqual([]);
    expect(partialData.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "RESOURCE_MAINTENANCE" })]),
    );
    expect(partialData.rules.resources).toBe(true);

    await db.query(
      "UPDATE resources SET status='MAINTENANCE' WHERE id=ANY($1::uuid[])",
      [resources.rows.map((row) => row.id)],
    );
    const insufficient = await owner.api.post("/v1/availability/explain", {
      headers,
      data: { branchId: branchA, serviceId, startAt },
    });
    const insufficientData = (await insufficient.json()).data;
    expect(insufficientData.available).toBe(false);
    expect(insufficientData.rules.resources).toBe(false);
    expect(insufficientData.blockingReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "RESOURCE_CAPACITY_INSUFFICIENT" }),
        expect.objectContaining({ code: "RESOURCE_MAINTENANCE" }),
      ]),
    );
  } finally {
    for (const resource of resources.rows)
      await db.query("UPDATE resources SET status=$2 WHERE id=$1", [
        resource.id,
        resource.status,
      ]);
    await db.end();
    await close(owner);
  }
});

import { expect, test } from "@playwright/test";
import { io } from "socket.io-client";
import { authenticated, close } from "./auth/setup";
import { cleanupE2E } from "./helpers/database-cleanup";
import {
  branchA,
  branchB,
  technicianAStaff,
  technicianBStaff,
  unique,
} from "./helpers/test-data";
const service = "50000000-0000-4000-8000-000000000001",
  staff = "47000000-0000-4000-8000-000000000003";
const availability = `/v1/availability?branchId=${branchA}&serviceId=${service}&dateFrom=2026-08-10&dateTo=2026-08-10&slotIntervalMin=15`;
test("owner block write invalidates cached availability and cancel restores slots", async () => {
  const prefix = unique("S3-BLOCK"),
    owner = await authenticated("owner"),
    headers = {
      authorization: `Bearer ${owner.accessToken}`,
      "x-tenant-id": owner.tenantId,
    };
  try {
    const first = await owner.api.get(availability, { headers });
    expect(first.status()).toBe(200);
    const firstData = (await first.json()).data,
      initial = firstData.days[0].slots.length;
    const cached = await owner.api.get(availability, { headers });
    expect((await cached.json()).data.cache.hit).toBe(true);
    const created = await owner.api.post("/v1/availability-blocks", {
      headers,
      data: {
        branchId: branchA,
        staffId: staff,
        blockType: "MANUAL",
        title: prefix,
        startAt: "2026-08-10T10:00:00+07:00",
        endAt: "2026-08-10T11:00:00+07:00",
      },
    });
    expect(created.status()).toBe(201);
    const block = (await created.json()).data;
    const blocked = (
      await (await owner.api.get(availability, { headers })).json()
    ).data;
    expect(blocked.dataVersion).toBeGreaterThan(firstData.dataVersion);
    expect(blocked.days[0].slots.length).toBeLessThan(initial);
    const explained=await owner.api.post("/v1/availability/explain",{headers,data:{branchId:branchA,serviceId:service,startAt:"2026-08-10T10:00:00+07:00",staffId:staff}});expect(explained.status()).toBe(201);const explanation=(await explained.json()).data;expect(explanation.available).toBe(false);expect(explanation.reasons.map((x:any)=>x.code)).toContain("STAFF_BUSY");
    const conflict = await owner.api.patch(
      `/v1/availability-blocks/${block.id}`,
      {
        headers,
        data: { title: `${prefix}-stale`, version: block.version + 20 },
      },
    );
    expect(conflict.status()).toBe(409);
    expect((await conflict.json()).error.code).toBe(
      "BUSY_BLOCK_VERSION_CONFLICT",
    );
    const cancelled = await owner.api.post(
      `/v1/availability-blocks/${block.id}/cancel`,
      { headers, data: { version: block.version } },
    );
    expect(cancelled.status()).toBe(201);
    const restored = (
      await (await owner.api.get(availability, { headers })).json()
    ).data;
    expect(restored.days[0].slots.length).toBe(initial);
  } finally {
    await close(owner);
    await cleanupE2E(prefix);
  }
});
test("external block create is idempotent and calendar includes normalized events", async () => {
  const prefix = unique("S3-EXT"),
    owner = await authenticated("owner"),
    headers = {
      authorization: `Bearer ${owner.accessToken}`,
      "x-tenant-id": owner.tenantId,
    },
    body = {
      branchId: branchA,
      staffId: staff,
      blockType: "EXTERNAL",
      title: prefix,
      startAt: "2026-08-10T15:00:00+07:00",
      endAt: "2026-08-10T15:30:00+07:00",
      source: "e2e",
      sourceReference: prefix,
    };
  try {
    const a = await owner.api.post("/v1/availability-blocks", {
        headers,
        data: body,
      }),
      b = await owner.api.post("/v1/availability-blocks", {
        headers,
        data: body,
      });
    expect(a.status()).toBe(201);
    const first = (await a.json()).data;
    expect((await b.json()).data.id).toBe(first.id);
    const calendar = await owner.api.get(
      `/v1/calendar/events?branchId=${branchA}&from=2026-08-10T00:00:00%2B07:00&to=2026-08-11T00:00:00%2B07:00`,
      { headers },
    );
    expect(calendar.status()).toBe(200);
    const data = (await calendar.json()).data;
    expect(data.timezone).toBe("Asia/Ho_Chi_Minh");
    expect(data.events.map((x: any) => x.eventType)).toEqual(
      expect.arrayContaining(["SHIFT", "BUSY_BLOCK"]),
    );
  } finally {
    await close(owner);
    await cleanupE2E(prefix);
  }
});
test("authenticated realtime room emits invalidation and requires refetch", async () => {
  const prefix=unique("S3-RT"),owner=await authenticated("owner"),headers={authorization:`Bearer ${owner.accessToken}`,"x-tenant-id":owner.tenantId};
  const socket=io("http://127.0.0.1:3001/scheduling",{auth:{token:owner.accessToken},transports:["websocket"]});
  try{
    await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error("Realtime connection timeout")),3000);socket.once("scheduling.connected",()=>{clearTimeout(timeout);resolve();});socket.once("connect_error",reject);});
    const invalidated=new Promise<any>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error("Invalidation timeout")),3000);socket.once("availability.invalidated",payload=>{clearTimeout(timeout);resolve(payload);});});
    const response=await owner.api.post("/v1/availability-blocks",{headers,data:{branchId:branchA,staffId:staff,blockType:"MANUAL",title:prefix,startAt:"2026-08-10T17:00:00+07:00",endAt:"2026-08-10T17:30:00+07:00"}});expect(response.status()).toBe(201);expect(await invalidated).toMatchObject({tenantId:owner.tenantId,branchId:branchA,refetch:true});
  }finally{socket.disconnect();await close(owner);await cleanupE2E(prefix);}
});

test("manager, technician and platform scopes remain isolated", async () => {
  const manager = await authenticated("managerB"),
    tech = await authenticated("technicianA"),
    platform = await authenticated("platform");
  try {
    const mh = {
        authorization: `Bearer ${manager.accessToken}`,
        "x-tenant-id": manager.tenantId,
      },
      th = {
        authorization: `Bearer ${tech.accessToken}`,
        "x-tenant-id": tech.tenantId,
      },
      ph = {
        authorization: `Bearer ${platform.accessToken}`,
        "x-tenant-id": platform.tenantId,
      };
    expect(
      (
        await manager.api.get(
          `/v1/calendar/events?branchId=${branchB}&from=2026-08-10T00:00:00%2B07:00&to=2026-08-11T00:00:00%2B07:00`,
          { headers: mh },
        )
      ).status(),
    ).toBe(200);
    expect(
      (
        await manager.api.get(
          `/v1/calendar/events?branchId=${branchA}&from=2026-08-10T00:00:00%2B07:00&to=2026-08-11T00:00:00%2B07:00`,
          { headers: mh },
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await tech.api.get(
          `/v1/calendar/events?branchId=${branchA}&from=2026-08-10T00:00:00%2B07:00&to=2026-08-11T00:00:00%2B07:00&staffIds=${technicianAStaff}`,
          { headers: th },
        )
      ).status(),
    ).toBe(200);
    expect(
      (
        await tech.api.get(
          `/v1/calendar/events?branchId=${branchA}&from=2026-08-10T00:00:00%2B07:00&to=2026-08-11T00:00:00%2B07:00&staffIds=${technicianBStaff}`,
          { headers: th },
        )
      ).status(),
    ).toBe(403);
    expect(
      (await platform.api.get(availability, { headers: ph })).status(),
    ).toBe(403);
  } finally {
    await close(manager);
    await close(tech);
    await close(platform);
  }
});
test("Admin Web exposes real Sprint 3 search, calendar and block forms", async ({
  page,
}) => {
  await page.goto("/admin/availability/search");
  await expect(
    page.getByRole("heading", { name: "Availability search" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Calculate" })).toBeVisible();
  await page.goto("/admin/calendar/day");
  await expect(
    page.getByRole("heading", { name: "Calendar day" }),
  ).toBeVisible();
  await page.goto("/admin/scheduling/blocks/new");
  await expect(
    page.getByRole("button", { name: "Create manual block" }),
  ).toBeVisible();
});

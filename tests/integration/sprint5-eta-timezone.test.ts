import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../apps/api/src/infrastructure/database.service";
import { createApp } from "../../apps/api/src/main";

const tenant = "10000000-0000-4000-8000-000000000001",
  branch = "20000000-0000-4000-8000-000000000001",
  branchB = "20000000-0000-4000-8000-000000000002",
  service = "50000000-0000-4000-8000-000000000001",
  staff = "47000000-0000-4000-8000-000000000007",
  run = `s5-eta-zone-${Date.now()}`;
let app: Awaited<ReturnType<typeof createApp>>,
  db: DatabaseService,
  ownerToken = "",
  staffToken = "";
const headers = (token = ownerToken, key = crypto.randomUUID()) => ({
  authorization: `Bearer ${token}`,
  "x-tenant-id": tenant,
  "idempotency-key": key,
});

async function login(email: string, suffix: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: {
      tenantSlug: "nailsoft-demo",
      email,
      password: "DemoPass123!",
      deviceId: `${run}-${suffix}`,
      deviceName: "Sprint 5 ETA/timezone closure",
      platform: "web",
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().data.accessToken as string;
}

describe.sequential("Sprint 5 closure ETA and timezone", () => {
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    db = app.get(DatabaseService);
    ownerToken = await login("owner@example.test", "owner");
    staffToken = await login("staff7@example.test", "staff");
  });
  afterAll(async () => app?.close());

  it("returns a slot-aligned, queue-aware ETA and refreshes after priority", async () => {
    await db.query(
      "UPDATE branches SET timezone='UTC' WHERE tenant_id=$1 AND id=$2",
      [tenant, branch],
    );
    await db.query(
      "UPDATE walk_in_entries SET status='LEFT',cancellation_reason_code='TEST_RESET' WHERE tenant_id=$1 AND branch_id=$2 AND status IN ('WAITING','READY','CALLED')",
      [tenant, branch],
    );
    await db.query(
      "UPDATE services SET default_duration_min=5,prep_time_min=0,cleanup_time_min=0,booking_buffer_before_min=0,booking_buffer_after_min=0 WHERE tenant_id=$1 AND id=$2",
      [tenant, service],
    );
    await db.query(
      `UPDATE business_hours SET is_closed=false,open_time='00:00',close_time='23:59'
       WHERE tenant_id=$1 AND branch_id=$2
         AND day_of_week=extract(dow FROM (now() AT TIME ZONE 'UTC'))::int`,
      [tenant, branch],
    );
    await db.query(
      `INSERT INTO staff_skills(tenant_id,staff_id,skill_id,proficiency_level,status)
       SELECT $1,$2,ss.skill_id,5,'ACTIVE'
       FROM service_skill_requirements ss
       WHERE ss.tenant_id=$1 AND ss.service_id=$3
       ON CONFLICT(tenant_id,staff_id,skill_id)
       DO UPDATE SET proficiency_level=excluded.proficiency_level,status='ACTIVE'`,
      [tenant, staff, service],
    );
    await db.query(
      `INSERT INTO shifts(id,tenant_id,branch_id,staff_id,start_at,end_at,status,source)
       VALUES(gen_random_uuid(),$1,$2,$3,date_trunc('minute',now())+interval '5 minutes',date_trunc('minute',now())+interval '55 minutes','PUBLISHED','MANUAL')`,
      [tenant, branch, staff],
    );
    const create = async (name: string, key: string) =>
      app.inject({
        method: "POST",
        url: "/v1/walk-ins",
        headers: headers(ownerToken, key),
        payload: {
          branchId: branch,
          displayName: name,
          items: [
            {
              serviceId: service,
              staffPreference: { type: "SPECIFIC", staffId: staff },
            },
          ],
        },
      });
    const firstResponse = await create("ETA first", `${run}-eta-first`);
    expect(firstResponse.statusCode, firstResponse.body).toBe(201);
    const first = firstResponse.json().data;
    expect(first.estimatedStartAt).toBeTruthy();
    expect(first.estimateDisclaimer).toBe("ESTIMATED_NOT_GUARANTEED");
    expect(first.estimateReasonCodes).toContain("SLOT_INTERVAL_ROUNDED");
    expect(new Date(first.estimatedStartAt).getUTCMinutes() % 5).toBe(0);

    const secondResponse = await create("ETA second", `${run}-eta-second`);
    expect(secondResponse.statusCode, secondResponse.body).toBe(201);
    const second = secondResponse.json().data;
    expect(Date.parse(second.estimatedStartAt)).toBeGreaterThan(
      Date.parse(first.estimatedStartAt),
    );
    expect(second.estimateReasonCodes).toContain("QUEUE_WORKLOAD_INCLUDED");
    const priority = await app.inject({
      method: "POST",
      url: `/v1/walk-ins/${second.id}/priority`,
      headers: headers(ownerToken, `${run}-priority`),
      payload: {
        version: second.version,
        priority: "MANAGER_OVERRIDE",
        reason: "Recovery priority with audit",
      },
    });
    expect(priority.statusCode, priority.body).toBe(201);
    const refreshed = await app.inject({
      method: "GET",
      url: `/v1/walk-ins/${second.id}`,
      headers: headers(),
    });
    expect(
      Date.parse(refreshed.json().data.estimatedStartAt),
    ).toBeLessThanOrEqual(Date.parse(second.estimatedStartAt));
    await db.query(
      "UPDATE branches SET timezone='Asia/Ho_Chi_Minh' WHERE tenant_id=$1 AND id=$2",
      [tenant, branch],
    );
  });

  it("queries Operational Board by branch-local half-open day including DST", async () => {
    const appointmentA = "70000000-0000-4000-8000-000000000001",
      appointmentB = "70000000-0000-4000-8000-000000000002";
    await db.query(
      "UPDATE branches SET timezone='Asia/Ho_Chi_Minh' WHERE tenant_id=$1 AND id=$2",
      [tenant, branch],
    );
    await db.query(
      "UPDATE appointments SET branch_id=$3,status='CONFIRMED',start_at='2026-07-26T18:00:00Z',end_at='2026-07-26T18:30:00Z' WHERE tenant_id=$1 AND id=$2",
      [tenant, appointmentA, branch],
    );
    const localBoard = await app.inject({
      method: "GET",
      url: `/v1/operations/board?branchId=${branch}&date=2026-07-27`,
      headers: headers(),
    });
    expect(localBoard.statusCode, localBoard.body).toBe(200);
    const localIds = Object.values(localBoard.json().data.columns)
      .flat()
      .map((row: any) => row.id);
    expect(localIds).toContain(appointmentA);

    await db.query(
      "UPDATE branches SET timezone='America/New_York' WHERE tenant_id=$1 AND id=$2",
      [tenant, branchB],
    );
    await db.query(
      "UPDATE appointments SET branch_id=$3,status='CONFIRMED',confirmed_at=coalesce(confirmed_at,now()),timezone='America/New_York',start_at='2026-11-01T05:30:00Z',end_at='2026-11-01T06:30:00Z' WHERE tenant_id=$1 AND id=$2",
      [tenant, appointmentB, branchB],
    );
    const dstBoard = await app.inject({
      method: "GET",
      url: `/v1/operations/board?branchId=${branchB}&date=2026-11-01`,
      headers: headers(),
    });
    expect(dstBoard.statusCode, dstBoard.body).toBe(200);
    expect(dstBoard.json().data.timezone).toBe("America/New_York");
    const dstIds = Object.values(dstBoard.json().data.columns)
      .flat()
      .map((row: any) => row.id);
    expect(dstIds).toContain(appointmentB);
  });

  it("groups Staff Today by each branch local date", async () => {
    await db.query(
      "UPDATE branches SET timezone='Asia/Ho_Chi_Minh' WHERE tenant_id=$1 AND id=$2",
      [tenant, branch],
    );
    await db.query(
      "UPDATE service_sessions SET scheduled_start_at=now(),scheduled_end_at=now()+interval '5 minutes' WHERE tenant_id=$1 AND id='77000000-0000-4000-8000-000000000007'",
      [tenant],
    );
    const response = await app.inject({
      method: "GET",
      url: "/v1/staff/me/today",
      headers: headers(staffToken),
    });
    expect(response.statusCode, response.body).toBe(200);
    const data = response.json().data;
    expect(data.branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          branchId: branch,
          timezone: "Asia/Ho_Chi_Minh",
          localDate: expect.any(String),
        }),
      ]),
    );
    expect(
      data.branches
        .find((entry: any) => entry.branchId === branch)
        .upcomingServices.some(
          (entry: any) => entry.id === "77000000-0000-4000-8000-000000000007",
        ),
    ).toBe(true);
  });
});

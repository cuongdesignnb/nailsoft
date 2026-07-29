import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/main";

let app: Awaited<ReturnType<typeof createApp>>;
const tenantId = "10000000-0000-4000-8000-000000000001";

async function login(email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: {
      tenantSlug: "nailsoft-demo",
      email,
      password: "DemoPass123!",
      deviceId: `sprint12-${email}`,
      deviceName: "Sprint 12 authenticated integration",
      platform: "web",
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return {
    authorization: `Bearer ${response.json().data.accessToken}`,
    "x-tenant-id": tenantId,
  };
}

function commandHeaders(auth: Awaited<ReturnType<typeof login>>, key: string) {
  return { ...auth, "idempotency-key": key };
}

describe.sequential("Sprint 12 authenticated workforce API", () => {
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => app.close());

  it("executes the technician's own break lifecycle and replays safely", async () => {
    const technician = await login("staff5@example.test");
    const status = await app.inject({
      method: "GET",
      url: "/v1/staff/me/time-clock/status",
      headers: technician,
    });
    expect(status.statusCode, status.body).toBe(200);
    const clock = status.json().data;
    expect(clock.clockedIn).toBe(true);
    if (clock.session.openBreakId) {
      const cleanup = await app.inject({
        method: "POST",
        url: "/v1/staff/me/time-clock/breaks/end",
        headers: commandHeaders(technician, "s12-api-preexisting-break-end"),
        payload: { source: "STAFF_MOBILE" },
      });
      expect(cleanup.statusCode, cleanup.body).toBe(201);
    }

    const startHeaders = commandHeaders(technician, "s12-api-break-start");
    const started = await app.inject({
      method: "POST",
      url: "/v1/staff/me/time-clock/breaks/start",
      headers: startHeaders,
      payload: { breakType: "OTHER", source: "STAFF_MOBILE" },
    });
    expect(started.statusCode, started.body).toBe(201);
    const replay = await app.inject({
      method: "POST",
      url: "/v1/staff/me/time-clock/breaks/start",
      headers: startHeaders,
      payload: { breakType: "OTHER", source: "STAFF_MOBILE" },
    });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json().data.id).toBe(started.json().data.id);
    expect(replay.json().data.idempotencyReplayed).toBe(true);

    const ended = await app.inject({
      method: "POST",
      url: "/v1/staff/me/time-clock/breaks/end",
      headers: commandHeaders(technician, "s12-api-break-end"),
      payload: { source: "STAFF_MOBILE" },
    });
    expect(ended.statusCode, ended.body).toBe(201);
    expect(ended.json().data.state).toBe("CLOSED");
  });

  it("exposes payroll workers and exceptions to an authorized owner", async () => {
    const owner = await login("owner@example.test");
    const workers = await app.inject({
      method: "GET",
      url: "/v1/payroll/runs/f1200000-0000-4000-8000-000000000090/workers",
      headers: owner,
    });
    expect(workers.statusCode, workers.body).toBe(200);
    expect(workers.json().data).toHaveLength(1);

    const exceptions = await app.inject({
      method: "GET",
      url: "/v1/payroll/exceptions",
      headers: owner,
    });
    expect(exceptions.statusCode, exceptions.body).toBe(200);
    expect(Array.isArray(exceptions.json().data)).toBe(true);
  });

  it("enforces payroll dual control and platform tenant denial", async () => {
    const accountant = await login("accountant@example.test");
    const approve = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs/f1200000-0000-4000-8000-000000000091/approve",
      headers: commandHeaders(accountant, "s12-accountant-approve-denied"),
      payload: { reason: "Must be independently approved" },
    });
    expect(approve.statusCode, approve.body).toBe(403);

    const platform = await login("platform-e2e@example.test");
    const denied = await app.inject({
      method: "GET",
      url: "/v1/time-clock/sessions",
      headers: platform,
    });
    expect(denied.statusCode, denied.body).toBe(403);
  });
});

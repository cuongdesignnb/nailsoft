import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/main";
import { DatabaseService } from "../../apps/api/src/infrastructure/database.service";
const tenant = "10000000-0000-4000-8000-000000000001",
  branch = "20000000-0000-4000-8000-000000000001",
  service = "50000000-0000-4000-8000-000000000001",
  run = `s5-${Date.now()}`;
const fixtureStartAt = new Date();
fixtureStartAt.setUTCDate(fixtureStartAt.getUTCDate() + 1);
fixtureStartAt.setUTCHours(3, 0, 0, 0);
while (fixtureStartAt.getUTCDay() === 0) {
  fixtureStartAt.setUTCDate(fixtureStartAt.getUTCDate() + 1);
}
const fixtureDate = fixtureStartAt.toISOString().slice(0, 10);
let app: Awaited<ReturnType<typeof createApp>>,
  token = "",
  managerToken = "",
  techToken = "",
  targetTechToken = "",
  convertedAppointmentId = "";
const headers = (k = crypto.randomUUID()) => ({
  authorization: `Bearer ${token}`,
  "x-tenant-id": tenant,
  "idempotency-key": k,
});
const managerHeaders = (k = crypto.randomUUID()) => ({
  authorization: `Bearer ${managerToken}`,
  "x-tenant-id": tenant,
  "idempotency-key": k,
});
describe.sequential("Sprint 5 walk-in, check-in, and execution", () => {
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const r = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        tenantSlug: "nailsoft-demo",
        email: "staff3@example.test",
        password: "DemoPass123!",
        deviceId: run,
        deviceName: "Sprint 5 integration",
        platform: "web",
      },
    });
    expect(r.statusCode, r.body).toBe(200);
    token = r.json().data.accessToken;
    const manager = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        tenantSlug: "nailsoft-demo",
        email: "staff2@example.test",
        password: "DemoPass123!",
        deviceId: `${run}-manager`,
        deviceName: "Sprint 5 manager",
        platform: "web",
      },
    });
    expect(manager.statusCode, manager.body).toBe(200);
    managerToken = manager.json().data.accessToken;
    const tech = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        tenantSlug: "nailsoft-demo",
        email: "staff7@example.test",
        password: "DemoPass123!",
        deviceId: `${run}-executor`,
        deviceName: "Sprint 5 technician",
        platform: "android",
      },
    });
    expect(tech.statusCode, tech.body).toBe(200);
    techToken = tech.json().data.accessToken;
    const target = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        tenantSlug: "nailsoft-demo",
        email: "staff11@example.test",
        password: "DemoPass123!",
        deviceId: `${run}-target-executor`,
        deviceName: "Sprint 5 transfer target",
        platform: "android",
      },
    });
    expect(target.statusCode, target.body).toBe(200);
    targetTechToken = target.json().data.accessToken;
    await app.get(DatabaseService).query(
      "UPDATE shifts SET start_at=$3::timestamptz,end_at=$3::timestamptz+interval '6 hours' WHERE id=(SELECT id FROM shifts WHERE tenant_id=$1 AND branch_id=$2 AND status='PUBLISHED' ORDER BY start_at DESC LIMIT 1)",
      [tenant, branch, fixtureStartAt.toISOString()],
    );
  });
  afterAll(async () => {
    if (app) await app.close();
  });
  it("allocates unique queue numbers concurrently and records estimate semantics", async () => {
    const requests = Array.from({ length: 8 }, (_, i) =>
        app.inject({
          method: "POST",
          url: "/v1/walk-ins",
          headers: headers(`${run}-queue-${i}`),
          payload: {
            branchId: branch,
            displayName: `Concurrent walk-in ${i}`,
            items: [{ serviceId: service, staffPreference: { type: "ANY" } }],
          },
        }),
      ),
      responses = await Promise.all(requests);
    expect(
      responses.every((x) => x.statusCode === 201),
      responses.map((x) => x.body).join("\n"),
    ).toBe(true);
    const data = responses.map((x) => x.json().data),
      numbers = data.map((x) => x.queueNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(
      data.every((x) => x.estimateDisclaimer === "ESTIMATED_NOT_GUARANTEED"),
    ).toBe(true);
  });
  it("enforces walk-in versioned transitions and idempotent replay", async () => {
    const created = await app.inject({
        method: "POST",
        url: "/v1/walk-ins",
        headers: headers(`${run}-state-create`),
        payload: {
          branchId: branch,
          displayName: "State machine guest",
          items: [{ serviceId: service, staffPreference: { type: "ANY" } }],
        },
      }),
      walk = created.json().data,
      k = `${run}-ready-replay`,
      payload = { version: walk.version };
    const first = await app.inject({
        method: "POST",
        url: `/v1/walk-ins/${walk.id}/ready`,
        headers: headers(k),
        payload,
      }),
      replay = await app.inject({
        method: "POST",
        url: `/v1/walk-ins/${walk.id}/ready`,
        headers: headers(k),
        payload,
      });
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json().data.id).toBe(first.json().data.id);
    const stale = await app.inject({
      method: "POST",
      url: `/v1/walk-ins/${walk.id}/call`,
      headers: headers(`${run}-stale`),
      payload: { version: walk.version },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("VERSION_CONFLICT");
  }, 15_000);

  it("converts a walk-in once through Booking Planner, hold, and reservation consumption", async () => {
    const availability = await app.inject({
      method: "GET",
      url: `/v1/availability?branchId=${branch}&serviceId=${service}&dateFrom=${fixtureDate}&dateTo=${fixtureDate}&slotIntervalMin=5`,
      headers: headers(),
    });
    expect(availability.statusCode, availability.body).toBe(200);
    const slot = availability.json().data.days.flatMap((x: any) => x.slots)[0];
    expect(slot).toBeTruthy();
    const created = await app.inject({
      method: "POST",
      url: "/v1/walk-ins",
      headers: headers(`${run}-convert-create`),
      payload: {
        branchId: branch,
        displayName: "Walk-in conversion guest",
        phone: `090${String(Date.now()).slice(-7)}`,
        items: [
          {
            serviceId: service,
            staffPreference: {
              type: "SPECIFIC",
              staffId: slot.staffCandidates[0].staffId,
            },
          },
        ],
      },
    });
    const walk = created.json().data,
      ready = await app.inject({
        method: "POST",
        url: `/v1/walk-ins/${walk.id}/ready`,
        headers: headers(`${run}-convert-ready`),
        payload: { version: walk.version },
      }),
      current = ready.json().data,
      hold = await app.inject({
        method: "POST",
        url: `/v1/walk-ins/${walk.id}/conversion-holds`,
        headers: headers(`${run}-convert-hold`),
        payload: { desiredStartAt: slot.startAt },
      });
    expect(hold.statusCode, hold.body).toBe(201);
    const payload = {
        version: current.version,
        holdId: hold.json().data.holdId,
      },
      [first, replay] = await Promise.all([
        app.inject({
          method: "POST",
          url: `/v1/walk-ins/${walk.id}/convert`,
          headers: headers(`${run}-convert`),
          payload,
        }),
        app.inject({
          method: "POST",
          url: `/v1/walk-ins/${walk.id}/convert`,
          headers: headers(`${run}-convert`),
          payload,
        }),
      ]);
    expect(first.statusCode, first.body).toBe(201);
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json().data.appointmentId).toBe(
      first.json().data.appointmentId,
    );
    convertedAppointmentId = first.json().data.appointmentId;
    const db = app.get(DatabaseService),
      evidence = await db.query<{
        appointments: number;
        reservations: number;
        hold_status: string;
      }>(
        "SELECT (SELECT count(*)::int FROM appointments WHERE tenant_id=$1 AND id=$2) appointments,(SELECT count(*)::int FROM staff_schedule_reservations r JOIN appointment_items i ON i.tenant_id=r.tenant_id AND i.id=r.appointment_item_id WHERE i.tenant_id=$1 AND i.appointment_id=$2 AND r.reservation_type='APPOINTMENT') reservations,(SELECT status FROM slot_holds WHERE tenant_id=$1 AND id=$3) hold_status",
        [tenant, first.json().data.appointmentId, hold.json().data.holdId],
      );
    expect(evidence.rows[0].appointments).toBe(1);
    expect(evidence.rows[0].reservations).toBeGreaterThan(0);
    expect(evidence.rows[0].hold_status).toBe("CONSUMED");
  }, 15_000);

  it("plans, holds, approves, and appends an add-service without repricing existing items", async () => {
    const checked = await app.inject({
      method: "POST",
      url: `/v1/appointments/${convertedAppointmentId}/check-in`,
      headers: managerHeaders(`${run}-extension-checkin`),
      payload: {
        version: 1,
        overrideReason: "Deterministic late-fixture approval",
      },
    });
    expect(checked.statusCode, checked.body).toBe(201);
    const before = await app.inject({
      method: "GET",
      url: `/v1/appointments/${convertedAppointmentId}`,
      headers: headers(),
    });
    const originalPrice = before.json().data.items[0].price;
    const plan = await app.inject({
      method: "POST",
      url: `/v1/appointments/${convertedAppointmentId}/add-service-plans`,
      headers: headers(),
      payload: { serviceId: service, staffPreference: { type: "ANY" } },
    });
    expect(plan.statusCode, plan.body).toBe(201);
    expect(plan.json().data.scheduleImpact.extendsMinutes).toBeGreaterThan(0);
    const hold = await app.inject({
      method: "POST",
      url: `/v1/appointments/${convertedAppointmentId}/add-service-holds`,
      headers: headers(`${run}-extension-hold`),
      payload: { serviceId: service, staffPreference: { type: "ANY" } },
    });
    expect(hold.statusCode, hold.body).toBe(201);
    const committed = await app.inject({
      method: "POST",
      url: `/v1/appointments/${convertedAppointmentId}/add-service`,
      headers: headers(`${run}-extension-commit`),
      payload: {
        holdId: hold.json().data.holdId,
        version: checked.json().data.version,
        customerApprovalMethod: "VERBAL",
        approvalNote: "Customer approved in salon",
      },
    });
    expect(committed.statusCode, committed.body).toBe(201);
    const after = await app.inject({
      method: "GET",
      url: `/v1/appointments/${convertedAppointmentId}`,
      headers: headers(),
    });
    expect(after.json().data.items).toHaveLength(2);
    expect(after.json().data.items[0].price).toEqual(originalPrice);
    const db = app.get(DatabaseService),
      metadata = await db.query<{
        item_source: string;
        customer_approval_method: string;
      }>(
        "SELECT item_source,customer_approval_method FROM appointment_items WHERE tenant_id=$1 AND id=$2",
        [tenant, committed.json().data.appointmentItemId],
      );
    expect(metadata.rows[0]).toEqual({
      item_source: "MANUAL",
      customer_approval_method: "VERBAL",
    });
  });
  it("allows one concurrent check-in and creates one pending session per item", async () => {
    const appointment = "70000000-0000-4000-8000-000000000001",
      payload = {
        version: 1,
        overrideReason: "Deterministic late-fixture approval",
      };
    const db = app.get(DatabaseService);
    await db.query(
      "UPDATE appointments SET start_at=now(),end_at=now()+interval '1 hour' WHERE tenant_id=$1 AND id=$2",
      [tenant, appointment],
    );
    await db.query(
      "UPDATE appointment_items SET service_start_at=now(),service_end_at=now()+interval '1 hour',staff_occupancy_start_at=now(),staff_occupancy_end_at=now()+interval '1 hour',resource_occupancy_start_at=now(),resource_occupancy_end_at=now()+interval '1 hour' WHERE tenant_id=$1 AND appointment_id=$2",
      [tenant, appointment],
    );
    const [a, b] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/v1/appointments/${appointment}/check-in`,
        headers: headers(`${run}-check-a`),
        payload,
      }),
      app.inject({
        method: "POST",
        url: `/v1/appointments/${appointment}/check-in`,
        headers: headers(`${run}-check-b`),
        payload,
      }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    expect([a, b].find((x) => x.statusCode === 409)?.json().error.code).toBe(
      "APPOINTMENT_ALREADY_CHECKED_IN",
    );
    const counts = await db.query<{ arrivals: number; sessions: number }>(
      "SELECT (SELECT count(*)::int FROM appointment_arrivals WHERE tenant_id=$1 AND appointment_id=$2) arrivals,(SELECT count(*)::int FROM service_sessions WHERE tenant_id=$1 AND appointment_id=$2) sessions",
      [tenant, appointment],
    );
    expect(counts.rows[0]).toEqual({ arrivals: 1, sessions: 1 });
  });
  it("serializes start, keeps segment/pause history, and derives checkout readiness", async () => {
    const sessionId = "77000000-0000-4000-8000-000000000007";
    const techHeaders = (k = crypto.randomUUID()) => ({
      authorization: `Bearer ${techToken}`,
      "x-tenant-id": tenant,
      "idempotency-key": k,
    });
    const [a, b] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/v1/service-sessions/${sessionId}/start`,
        headers: techHeaders(`${run}-start-a`),
        payload: {
          version: 1,
          staffId: "47000000-0000-4000-8000-000000000007",
        },
      }),
      app.inject({
        method: "POST",
        url: `/v1/service-sessions/${sessionId}/start`,
        headers: techHeaders(`${run}-start-b`),
        payload: {
          version: 1,
          staffId: "47000000-0000-4000-8000-000000000007",
        },
      }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    let current = (a.statusCode === 201 ? a : b).json().data;
    const transferred = await app.inject({
      method: "POST",
      url: `/v1/service-sessions/${sessionId}/transfer-staff`,
      headers: headers(`${run}-transfer`),
      payload: {
        version: current.version,
        targetStaffId: "47000000-0000-4000-8000-000000000011",
        reasonCode: "SHIFT_CHANGE",
        note: "Concurrent integration transfer",
      },
    });
    expect(transferred.statusCode, transferred.body).toBe(201);
    current = transferred.json().data;
    const formerPause = await app.inject({
        method: "POST",
        url: `/v1/service-sessions/${sessionId}/pause`,
        headers: techHeaders(`${run}-former-pause`),
        payload: { version: current.version, reasonCode: "CUSTOMER_BREAK" },
      }),
      formerComplete = await app.inject({
        method: "POST",
        url: `/v1/service-sessions/${sessionId}/complete`,
        headers: techHeaders(`${run}-former-complete`),
        payload: { version: current.version },
      });
    expect(formerPause.statusCode, formerPause.body).toBe(403);
    expect(formerPause.json().error.code).toBe("SERVICE_SESSION_SCOPE_DENIED");
    expect(formerComplete.statusCode, formerComplete.body).toBe(403);
    const targetHeaders = (k = crypto.randomUUID()) => ({
      authorization: `Bearer ${targetTechToken}`,
      "x-tenant-id": tenant,
      "idempotency-key": k,
    });
    const paused = await app.inject({
      method: "POST",
      url: `/v1/service-sessions/${sessionId}/pause`,
      headers: targetHeaders(`${run}-pause`),
      payload: { version: current.version, reasonCode: "CUSTOMER_BREAK" },
    });
    expect(paused.statusCode, paused.body).toBe(201);
    current = paused.json().data;
    const resumed = await app.inject({
      method: "POST",
      url: `/v1/service-sessions/${sessionId}/resume`,
      headers: targetHeaders(`${run}-resume`),
      payload: {
        version: current.version,
        staffId: "47000000-0000-4000-8000-000000000011",
      },
    });
    expect(resumed.statusCode, resumed.body).toBe(201);
    current = resumed.json().data;
    const done = await app.inject({
      method: "POST",
      url: `/v1/service-sessions/${sessionId}/complete`,
      headers: targetHeaders(`${run}-complete`),
      payload: {
        version: current.version,
        completionNote: "Integration completed",
      },
    });
    expect(done.statusCode, done.body).toBe(201);
    const detail = await app.inject({
      method: "GET",
      url: `/v1/service-sessions/${sessionId}`,
      headers: targetHeaders(),
    });
    expect(detail.json().data.status).toBe("COMPLETED");
    expect(detail.json().data.segments).toHaveLength(3);
    expect(detail.json().data.segments[0].ended_reason).toBe("TRANSFERRED");
    expect(detail.json().data.pauses).toHaveLength(1);
    const checkout = await app.inject({
      method: "GET",
      url: "/v1/appointments/70000000-0000-4000-8000-000000000007/checkout-summary",
      headers: headers(),
    });
    expect(checkout.statusCode).toBe(200);
    expect(checkout.json().data.checkoutReady).toBe(true);
    expect(checkout.json().data.pricingPreview).toBeTruthy();
  }, 15_000);

  it("sanitizes assigned-technician notes and issues tenant-bound media metadata", async () => {
    const sessionId = "77000000-0000-4000-8000-000000000007",
      ownHeaders = (k = crypto.randomUUID()) => ({
        authorization: `Bearer ${targetTechToken}`,
        "x-tenant-id": tenant,
        "idempotency-key": k,
      });
    const note = await app.inject({
      method: "POST",
      url: `/v1/service-sessions/${sessionId}/notes`,
      headers: ownHeaders(`${run}-note`),
      payload: {
        visibility: "TECHNICIAN",
        note: "<b>Safe</b><script>text</script>",
      },
    });
    expect(note.statusCode, note.body).toBe(201);
    expect(note.json().data.note).toBe("Safetext");
    const notes = await app.inject({
      method: "GET",
      url: `/v1/service-sessions/${sessionId}/notes`,
      headers: ownHeaders(),
    });
    expect(
      notes.json().data.some((x: { note: string }) => x.note === "Safetext"),
    ).toBe(true);
    process.env.OBJECT_STORAGE_ENDPOINT = "https://objects.example.test";
    process.env.OBJECT_STORAGE_BUCKET = "private-nailsoft";
    process.env.OBJECT_STORAGE_SECRET_KEY = "integration-secret-not-production";
    const checksum = "b".repeat(64),
      presign = await app.inject({
        method: "POST",
        url: `/v1/service-sessions/${sessionId}/media/presign`,
        headers: ownHeaders(`${run}-media`),
        payload: {
          mediaType: "AFTER",
          mimeType: "image/jpeg",
          sizeBytes: 2048,
          checksum,
        },
      });
    expect(presign.statusCode, presign.body).toBe(201);
    expect(presign.json().data.uploadUrl).toContain(
      `tenants/${tenant}/sessions/${sessionId}`,
    );
    const completed = await app.inject({
      method: "POST",
      url: `/v1/service-sessions/${sessionId}/media/${presign.json().data.mediaId}/complete`,
      headers: ownHeaders(),
      payload: { checksum },
    });
    expect(completed.statusCode).toBe(201);
    expect(completed.json().data).toEqual(
      expect.objectContaining({
        status: "PENDING_UPLOAD",
        verificationRequired: "TRUSTED_PROVIDER_CALLBACK",
      }),
    );
    delete process.env.OBJECT_STORAGE_ENDPOINT;
    delete process.env.OBJECT_STORAGE_BUCKET;
    delete process.env.OBJECT_STORAGE_SECRET_KEY;
  });
  it("enforces tenant/branch/staff scope and platform denial", async () => {
    const branchDenied = await app.inject({
      method: "GET",
      url: "/v1/walk-ins?branchId=20000000-0000-4000-8000-000000000002",
      headers: headers(),
    });
    expect(branchDenied.statusCode).toBe(403);
    const crossTenantOpaque = await app.inject({
      method: "GET",
      url: "/v1/walk-ins/10000000-0000-4000-8000-000000000099",
      headers: headers(),
    });
    expect(crossTenantOpaque.statusCode).toBe(404);
    const platformLogin = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          tenantSlug: "nailsoft-demo",
          email: "platform-e2e@example.test",
          password: "DemoPass123!",
          deviceId: `${run}-platform`,
          deviceName: "Platform",
          platform: "web",
        },
      }),
      platformToken = platformLogin.json().data.accessToken,
      denied = await app.inject({
        method: "GET",
        url: `/v1/walk-ins?branchId=${branch}`,
        headers: {
          authorization: `Bearer ${platformToken}`,
          "x-tenant-id": tenant,
        },
      });
    expect(denied.statusCode).toBe(403);
    const techLogin = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          tenantSlug: "nailsoft-demo",
          email: "staff5@example.test",
          password: "DemoPass123!",
          deviceId: `${run}-tech`,
          deviceName: "Technician",
          platform: "android",
        },
      }),
      techToken = techLogin.json().data.accessToken,
      other = await app.inject({
        method: "GET",
        url: "/v1/service-sessions/77000000-0000-4000-8000-000000000008",
        headers: {
          authorization: `Bearer ${techToken}`,
          "x-tenant-id": tenant,
        },
      });
    expect(other.statusCode).toBe(403);
  });

  it("keeps the granular Sprint 5 role matrix least-privileged", async () => {
    const db = app.get(DatabaseService),
      rows = await db.query<{ role: string; permission_code: string }>(
        "SELECT role,permission_code FROM role_permissions WHERE permission_code IN ('operations.board.read','walkin.priority','appointment.check_in','service_session.start','service_session.complete','appointment.checkout_summary') ORDER BY role,permission_code",
      ),
      matrix = new Map<string, Set<string>>();
    for (const row of rows.rows) {
      if (!matrix.has(row.role)) matrix.set(row.role, new Set());
      matrix.get(row.role)?.add(row.permission_code);
    }
    expect(matrix.get("SALON_OWNER")?.has("walkin.priority")).toBe(true);
    expect(matrix.get("BRANCH_MANAGER")?.has("walkin.priority")).toBe(true);
    expect(matrix.get("RECEPTIONIST")?.has("appointment.check_in")).toBe(true);
    expect(matrix.get("RECEPTIONIST")?.has("service_session.complete")).toBe(
      false,
    );
    expect(matrix.get("NAIL_TECHNICIAN")?.has("service_session.start")).toBe(
      true,
    );
    expect(matrix.get("CASHIER")?.has("appointment.checkout_summary")).toBe(
      true,
    );
    for (const role of ["ACCOUNTANT", "MARKETING", "PLATFORM_SUPER_ADMIN"])
      expect(matrix.has(role)).toBe(false);
  });
  it("protects one open segment per staff and append-only closed history in PostgreSQL", async () => {
    const db = app.get(DatabaseService),
      id = crypto.randomUUID();
    await db.query(
      "INSERT INTO service_session_staff_segments(id,tenant_id,service_session_id,staff_id,segment_role,started_at,created_by_user_id) VALUES($1,$2,'77000000-0000-4000-8000-000000000008','47000000-0000-4000-8000-000000000009','PRIMARY',now(),'30000000-0000-4000-8000-000000000001')",
      [id, tenant],
    );
    await expect(
      db.query(
        "INSERT INTO service_session_staff_segments(tenant_id,service_session_id,staff_id,segment_role,started_at,created_by_user_id) VALUES($1,'77000000-0000-4000-8000-000000000017','47000000-0000-4000-8000-000000000009','PRIMARY',now(),'30000000-0000-4000-8000-000000000001')",
        [tenant],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await db.query(
      "UPDATE service_session_staff_segments SET ended_at=now()+interval '1 second',ended_reason='CANCELLED' WHERE tenant_id=$1 AND id=$2",
      [tenant, id],
    );
    await expect(
      db.query(
        "DELETE FROM service_session_staff_segments WHERE tenant_id=$1 AND id=$2",
        [tenant, id],
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../apps/api/src/infrastructure/database.service";
import { createApp } from "../../apps/api/src/main";

const tenant = "10000000-0000-4000-8000-000000000001",
  branch = "20000000-0000-4000-8000-000000000001",
  sessionId = "77000000-0000-4000-8000-000000000007",
  plannedStaff = "47000000-0000-4000-8000-000000000007",
  targetStaff = "47000000-0000-4000-8000-000000000011",
  run = `s5-closure-auth-${Date.now()}`;
let app: Awaited<ReturnType<typeof createApp>>,
  db: DatabaseService,
  ownerToken = "",
  formerToken = "",
  currentToken = "";

async function login(email: string, suffix: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: {
      tenantSlug: "nailsoft-demo",
      email,
      password: "DemoPass123!",
      deviceId: `${run}-${suffix}`,
      deviceName: "Sprint 5 closure",
      platform: "web",
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().data.accessToken as string;
}
const headers = (token: string, key = crypto.randomUUID()) => ({
  authorization: `Bearer ${token}`,
  "x-tenant-id": tenant,
  "idempotency-key": key,
});

describe.sequential("Sprint 5 closure operational authorization", () => {
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    db = app.get(DatabaseService);
    ownerToken = await login("owner@example.test", "owner");
    formerToken = await login("staff7@example.test", "former");
    currentToken = await login("staff11@example.test", "current");
  });
  afterAll(async () => {
    await db?.query("UPDATE branches SET status='ACTIVE' WHERE id=$1", [
      branch,
    ]);
    await app?.close();
  });

  it("keeps actual staff, assignment, reservation, and execution scope consistent", async () => {
    const alternate = await app.inject({
      method: "POST",
      url: `/v1/service-sessions/${sessionId}/start`,
      headers: headers(ownerToken, `${run}-alternate-start`),
      payload: { version: 1, staffId: targetStaff, overrideReason: "MANAGER" },
    });
    expect(alternate.statusCode, alternate.body).toBe(409);
    expect(alternate.json().error.code).toBe(
      "SERVICE_SESSION_STAFF_NOT_ASSIGNED",
    );

    const started = await app.inject({
      method: "POST",
      url: `/v1/service-sessions/${sessionId}/start`,
      headers: headers(formerToken, `${run}-planned-start`),
      payload: { version: 1, staffId: plannedStaff },
    });
    expect(started.statusCode, started.body).toBe(201);
    const transferred = await app.inject({
      method: "POST",
      url: `/v1/service-sessions/${sessionId}/transfer-staff`,
      headers: headers(ownerToken, `${run}-transfer`),
      payload: {
        version: started.json().data.version,
        targetStaffId: targetStaff,
        reasonCode: "SHIFT_CHANGE",
      },
    });
    expect(transferred.statusCode, transferred.body).toBe(201);
    let current = transferred.json().data;

    const historicalRead = await app.inject({
      method: "GET",
      url: `/v1/service-sessions/${sessionId}`,
      headers: headers(formerToken),
    });
    expect(historicalRead.statusCode, historicalRead.body).toBe(200);
    for (const action of ["pause", "complete"] as const) {
      const denied = await app.inject({
        method: "POST",
        url: `/v1/service-sessions/${sessionId}/${action}`,
        headers: headers(formerToken, `${run}-former-${action}`),
        payload:
          action === "pause"
            ? { version: current.version, reasonCode: "CUSTOMER_BREAK" }
            : { version: current.version },
      });
      expect(denied.statusCode, denied.body).toBe(403);
      expect(denied.json().error.code).toBe("SERVICE_SESSION_SCOPE_DENIED");
    }
    process.env.OBJECT_STORAGE_ENDPOINT = "https://objects.example.test";
    process.env.OBJECT_STORAGE_BUCKET = "private-nailsoft";
    process.env.OBJECT_STORAGE_SECRET_KEY = "closure-test-secret";
    const mediaDenied = await app.inject({
      method: "POST",
      url: `/v1/service-sessions/${sessionId}/media/presign`,
      headers: headers(formerToken, `${run}-former-media`),
      payload: {
        mediaType: "AFTER",
        mimeType: "image/jpeg",
        sizeBytes: 1024,
        checksum: "c".repeat(64),
      },
    });
    expect(mediaDenied.statusCode, mediaDenied.body).toBe(403);

    const paused = await app.inject({
      method: "POST",
      url: `/v1/service-sessions/${sessionId}/pause`,
      headers: headers(currentToken, `${run}-current-pause`),
      payload: { version: current.version, reasonCode: "CUSTOMER_BREAK" },
    });
    expect(paused.statusCode, paused.body).toBe(201);
    current = paused.json().data;
    await db.query("UPDATE branches SET status='INACTIVE' WHERE id=$1", [
      branch,
    ]);
    const inactiveResume = await app.inject({
        method: "POST",
        url: `/v1/service-sessions/${sessionId}/resume`,
        headers: headers(currentToken, `${run}-inactive-resume`),
        payload: { version: current.version, staffId: targetStaff },
      }),
      inactiveWalkIn = await app.inject({
        method: "POST",
        url: "/v1/walk-ins",
        headers: headers(ownerToken, `${run}-inactive-walkin`),
        payload: {
          branchId: branch,
          displayName: "Inactive branch guest",
          items: [
            {
              serviceId: "50000000-0000-4000-8000-000000000001",
              staffPreference: { type: "ANY" },
            },
          ],
        },
      });
    expect(inactiveResume.statusCode, inactiveResume.body).toBe(409);
    expect(inactiveResume.json().error.code).toBe("BRANCH_INACTIVE");
    expect(inactiveWalkIn.statusCode, inactiveWalkIn.body).toBe(409);
    await db.query("UPDATE branches SET status='ACTIVE' WHERE id=$1", [branch]);

    const resumed = await app.inject({
      method: "POST",
      url: `/v1/service-sessions/${sessionId}/resume`,
      headers: headers(currentToken, `${run}-current-resume`),
      payload: { version: current.version, staffId: targetStaff },
    });
    expect(resumed.statusCode, resumed.body).toBe(201);
    current = resumed.json().data;
    const note = await app.inject({
      method: "POST",
      url: `/v1/service-sessions/${sessionId}/notes`,
      headers: headers(currentToken, `${run}-current-note`),
      payload: { visibility: "TECHNICIAN", note: "Current technician note" },
    });
    expect(note.statusCode, note.body).toBe(201);
    const formerEdit = await app.inject({
      method: "PATCH",
      url: `/v1/service-sessions/${sessionId}/notes/${note.json().data.id}`,
      headers: headers(formerToken),
      payload: { version: 1, visibility: "TECHNICIAN", note: "Forbidden" },
    });
    expect(formerEdit.statusCode, formerEdit.body).toBe(403);

    const completed = await app.inject({
      method: "POST",
      url: `/v1/service-sessions/${sessionId}/complete`,
      headers: headers(currentToken, `${run}-current-complete`),
      payload: { version: current.version },
    });
    expect(completed.statusCode, completed.body).toBe(201);
    const evidence = await db.query<{
      assigned_staff: string;
      reserved_staff: string;
      former_closed: boolean;
      current_closed: boolean;
    }>(
      `SELECT
        (SELECT staff_id FROM appointment_item_staff_assignments WHERE tenant_id=$1 AND appointment_item_id=s.appointment_item_id AND assignment_role='PRIMARY' AND status='ACTIVE') assigned_staff,
        (SELECT staff_id FROM staff_schedule_reservations WHERE tenant_id=$1 AND appointment_item_id=s.appointment_item_id AND status='ACTIVE') reserved_staff,
        EXISTS(SELECT 1 FROM service_session_staff_segments WHERE tenant_id=$1 AND service_session_id=s.id AND staff_id=$3 AND ended_reason='TRANSFERRED') former_closed,
        EXISTS(SELECT 1 FROM service_session_staff_segments WHERE tenant_id=$1 AND service_session_id=s.id AND staff_id=$4 AND ended_reason='COMPLETED') current_closed
       FROM service_sessions s WHERE tenant_id=$1 AND id=$2`,
      [tenant, sessionId, plannedStaff, targetStaff],
    );
    expect(evidence.rows[0]).toEqual({
      assigned_staff: targetStaff,
      reserved_staff: targetStaff,
      former_closed: true,
      current_closed: true,
    });
    const audit = await db.query(
      "SELECT 1 FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2 AND action IN ('service_session.staff_transferred','service_session.note_added')",
      [tenant, sessionId],
    );
    expect(audit.rowCount).toBeGreaterThanOrEqual(2);
    delete process.env.OBJECT_STORAGE_ENDPOINT;
    delete process.env.OBJECT_STORAGE_BUCKET;
    delete process.env.OBJECT_STORAGE_SECRET_KEY;
  });
});

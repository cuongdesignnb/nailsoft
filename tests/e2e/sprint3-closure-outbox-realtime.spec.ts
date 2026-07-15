import { expect, test } from "@playwright/test";
import { io, type Socket } from "socket.io-client";
import { authenticated, close } from "./auth/setup";
import { branchA, technicianAStaff } from "./helpers/test-data";

const socketUrl = "http://127.0.0.1:3001/scheduling";

function connect(token: string) {
  const socket = io(socketUrl, {
    transports: ["websocket"],
    auth: { token },
    extraHeaders: { Origin: "http://localhost:3000" },
    reconnection: false,
  });
  return new Promise<Socket>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Socket timeout")), 8_000);
    socket.once("scheduling.connected", () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once("connect_error", reject);
  });
}

function invalidation(socket: Socket, eventType: string) {
  return new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Missing ${eventType} invalidation`)),
      12_000,
    );
    socket.on("availability.invalidated", (payload) => {
      if (payload.sourceEventType === eventType) {
        clearTimeout(timeout);
        resolve(payload);
      }
    });
  });
}

test("shift publish is claimed by Worker, emitted to branch room and refetched by dataVersion", async () => {
  const manager = await authenticated("managerA");
  const headers = {
    authorization: `Bearer ${manager.accessToken}`,
    "x-tenant-id": manager.tenantId,
  };
  const socket = await connect(manager.accessToken);
  let shiftId: string | undefined;
  try {
    const before = await manager.api.get(
      `/v1/availability?branchId=${branchA}&serviceId=50000000-0000-4000-8000-000000000001&dateFrom=2041-02-10&dateTo=2041-02-10&slotIntervalMin=15`,
      { headers },
    );
    const beforeVersion = (await before.json()).data.dataVersion;
    const created = await manager.api.post("/v1/shifts", {
      headers,
      data: {
        branchId: branchA,
        staffId: technicianAStaff,
        startAt: "2041-02-10T02:00:00.000Z",
        endAt: "2041-02-10T10:00:00.000Z",
        breakMinutes: 0,
        source: "IMPORT",
      },
    });
    expect(created.status()).toBe(201);
    shiftId = (await created.json()).data.id;
    const emitted = invalidation(socket, "shift.published");
    const published = await manager.api.post(`/v1/shifts/${shiftId}/publish`, {
      headers,
    });
    expect(published.status()).toBe(201);
    const payload = await emitted;
    expect(payload).toMatchObject({
      tenantId: manager.tenantId,
      branchId: branchA,
      refetch: true,
    });
    expect(payload.eventId).toBeTruthy();
    const after = await manager.api.get(
      `/v1/availability?branchId=${branchA}&serviceId=50000000-0000-4000-8000-000000000001&dateFrom=2041-02-10&dateTo=2041-02-10&slotIntervalMin=15`,
      { headers },
    );
    expect((await after.json()).data.dataVersion).toBeGreaterThan(beforeVersion);
  } finally {
    if (shiftId)
      await manager.api
        .post(`/v1/shifts/${shiftId}/cancel`, { headers })
        .catch(() => undefined);
    socket.disconnect();
    await close(manager);
  }
});

test("leave approval reaches only the technician staff room and calendar refetch reads PostgreSQL", async () => {
  const technician = await authenticated("technicianA");
  const manager = await authenticated("managerA");
  const headers = (session: typeof technician) => ({
    authorization: `Bearer ${session.accessToken}`,
    "x-tenant-id": session.tenantId,
  });
  let leaveId: string | undefined;
  const socket = await connect(technician.accessToken);
  try {
    const created = await technician.api.post("/v1/leave-requests", {
      headers: headers(technician),
      data: {
        staffId: technicianAStaff,
        branchId: branchA,
        leaveType: "PERSONAL",
        startAt: "2041-03-11T02:00:00.000Z",
        endAt: "2041-03-11T10:00:00.000Z",
        reason: "S3 closure leave invalidation",
      },
    });
    leaveId = (await created.json()).data.id;
    await technician.api.post(`/v1/leave-requests/${leaveId}/submit`, {
      headers: headers(technician),
    });
    const emitted = invalidation(socket, "leave.approved");
    const approved = await manager.api.post(
      `/v1/leave-requests/${leaveId}/approve`,
      { headers: headers(manager), data: { reviewNote: "Closure approved" } },
    );
    expect(approved.status()).toBe(201);
    expect((await emitted).staffId).toBe(technicianAStaff);
    const calendar = await technician.api.get(
      `/v1/calendar/events?branchId=${branchA}&from=2041-03-11T00:00:00.000Z&to=2041-03-12T00:00:00.000Z`,
      { headers: headers(technician) },
    );
    const events = (await calendar.json()).data.events;
    expect(events.some((event: any) => event.sourceEntityId === leaveId)).toBe(true);
  } finally {
    if (leaveId)
      await technician.api
        .post(`/v1/leave-requests/${leaveId}/cancel`, {
          headers: headers(technician),
        })
        .catch(() => undefined);
    socket.disconnect();
    await close(technician);
    await close(manager);
  }
});

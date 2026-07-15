import { expect, test } from "@playwright/test";
import { io, type Socket } from "socket.io-client";
import { authenticated, close } from "./auth/setup";
import {
  branchA,
  branchB,
  technicianAStaff,
  technicianBStaff,
} from "./helpers/test-data";
import { cleanupE2E } from "./helpers/database-cleanup";
import { unique } from "./helpers/test-data";

const socketUrl = "http://127.0.0.1:3001/scheduling";
const origin = "http://localhost:3000";

function schedulingSocket(token: string, auth: Record<string, unknown> = {}) {
  return io(socketUrl, {
    autoConnect: false,
    transports: ["websocket"],
    auth: { token, ...auth },
    extraHeaders: { Origin: origin },
    reconnection: false,
  });
}

function once<T = unknown>(socket: Socket, event: string, timeoutMs = 8_000) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timeout waiting for ${event}`)),
      timeoutMs,
    );
    socket.once(event, (value) => {
      clearTimeout(timeout);
      resolve(value as T);
    });
  });
}

test("revoking the current session disconnects its socket and rejects the old token", async () => {
  const owner = await authenticated("owner");
  const headers = {
    authorization: `Bearer ${owner.accessToken}`,
    "x-tenant-id": owner.tenantId,
  };
  const sessions = await owner.api.get("/v1/auth/sessions", { headers });
  const current = (await sessions.json()).data[0];
  const socket = schedulingSocket(owner.accessToken);
  try {
    const connected = once(socket, "scheduling.connected");
    socket.connect();
    await connected;
    const revoked = once(socket, "session.revoked", 10_000);
    const disconnected = once(socket, "disconnect", 10_000);
    const response = await owner.api.post(
      `/v1/auth/sessions/${current.id}/revoke`,
      { headers },
    );
    expect(response.status()).toBe(204);
    await revoked;
    await disconnected;

    const retry = schedulingSocket(owner.accessToken);
    const denied = once<{ code: string }>(retry, "scheduling.denied");
    retry.connect();
    expect((await denied).code).toBe("SESSION_REVOKED");
    retry.disconnect();
  } finally {
    socket.disconnect();
    await close(owner);
  }
});

test("technician fake staffId is ignored and staff-room delivery stays isolated", async () => {
  const prefix = unique("S3-CLOSURE-ROOM");
  const technician = await authenticated("technicianA");
  const owner = await authenticated("owner");
  const ownerHeaders = {
    authorization: `Bearer ${owner.accessToken}`,
    "x-tenant-id": owner.tenantId,
  };
  const socket = schedulingSocket(technician.accessToken, {
    staffId: technicianBStaff,
    tenantId: owner.tenantId,
    roles: ["SALON_OWNER"],
  });
  try {
    const connected = once(socket, "scheduling.connected");
    socket.connect();
    await connected;
    let leaked = false;
    const leakHandler = (payload: { staffId?: string }) => {
      if (payload.staffId === technicianBStaff) leaked = true;
    };
    socket.on("availability.invalidated", leakHandler);
    const other = await owner.api.post("/v1/availability-blocks", {
      headers: ownerHeaders,
      data: {
        branchId: branchB,
        staffId: technicianBStaff,
        blockType: "MANUAL",
        title: `${prefix}-B`,
        startAt: "2043-01-10T09:00:00+07:00",
        endAt: "2043-01-10T09:30:00+07:00",
      },
    });
    expect(other.status()).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(leaked).toBe(false);

    const ownEvent = new Promise<{ staffId?: string }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Own room timeout")), 8_000);
      socket.on("availability.invalidated", (payload) => {
        if (payload.staffId === technicianAStaff) {
          clearTimeout(timeout);
          resolve(payload);
        }
      });
    });
    const own = await owner.api.post("/v1/availability-blocks", {
      headers: ownerHeaders,
      data: {
        branchId: branchA,
        staffId: technicianAStaff,
        blockType: "MANUAL",
        title: `${prefix}-A`,
        startAt: "2043-01-10T10:00:00+07:00",
        endAt: "2043-01-10T10:30:00+07:00",
      },
    });
    expect(own.status()).toBe(201);
    expect((await ownEvent).staffId).toBe(technicianAStaff);
  } finally {
    socket.disconnect();
    await close(technician);
    await close(owner);
    await cleanupE2E(prefix);
  }
});

test("Socket.IO allows configured origin and denies unknown origin and Platform Admin", async () => {
  const owner = await authenticated("owner");
  const platform = await authenticated("platform");
  const allowed = schedulingSocket(owner.accessToken);
  const unknown = io(socketUrl, {
    autoConnect: false,
    transports: ["websocket"],
    auth: { token: owner.accessToken },
    extraHeaders: { Origin: "https://unknown.invalid" },
    reconnection: false,
  });
  const deniedPlatform = schedulingSocket(platform.accessToken);
  try {
    const connected = once(allowed, "scheduling.connected");
    allowed.connect();
    await connected;
    const originDenied = once(unknown, "connect_error");
    unknown.connect();
    await originDenied;
    const platformDenied = once<{ code: string }>(
      deniedPlatform,
      "scheduling.denied",
    );
    deniedPlatform.connect();
    expect((await platformDenied).code).toBe("TENANT_ACCESS_DENIED");
  } finally {
    allowed.disconnect();
    unknown.disconnect();
    deniedPlatform.disconnect();
    await close(owner);
    await close(platform);
  }
});

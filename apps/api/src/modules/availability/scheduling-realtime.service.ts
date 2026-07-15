import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { randomUUID } from "node:crypto";
import { createClient, type RedisClientType } from "redis";
import type { Namespace, Socket } from "socket.io";
import { allowedOrigins } from "../../common/cors-origins.js";
import { DatabaseService } from "../../infrastructure/database.service.js";
import {
  SessionAuthorizationService,
  type ActiveAuthorizationContext,
} from "../identity/session-authorization.service.js";

export const REALTIME_CONTROL_CHANNEL = "nailsoft:realtime:control";
const schedulingOrigins = allowedOrigins();

export type RealtimeControlMessage =
  | {
      type: "DISCONNECT_SESSION";
      tenantId: string;
      sessionId: string;
      reason: string;
    }
  | {
      type: "DISCONNECT_MEMBERSHIP";
      tenantId: string;
      membershipId: string;
      reason: string;
    }
  | { type: "DISCONNECT_USER"; userId: string; reason: string };

@Injectable()
export class SchedulingRealtimeService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SchedulingRealtimeService.name);
  private server?: Namespace;
  private subscriber?: RedisClientType;
  private activeConnections = 0;
  private readonly counters = new Map<string, number>();

  attach(server: Namespace) {
    this.server = server;
  }

  connected(delta: 1 | -1) {
    this.activeConnections = Math.max(0, this.activeConnections + delta);
    if (delta === 1) this.increment("websocket_connection_total");
    this.logger.debug({
      event: "websocket_active_connections",
      value: this.activeConnections,
    });
  }

  denied() {
    this.increment("websocket_connection_denied_total");
  }

  async onModuleInit() {
    try {
      this.subscriber = createClient({
        url: process.env.REDIS_URL ?? "redis://localhost:6379",
        socket: { connectTimeout: 500, reconnectStrategy: false },
      });
      this.subscriber.on("error", (error) =>
        this.logger.warn({
          event: "websocket.control_error",
          message: error.message,
        }),
      );
      await this.subscriber.connect();
      await this.subscriber.subscribe(REALTIME_CONTROL_CHANNEL, (raw) =>
        this.handleControl(raw),
      );
    } catch (error) {
      this.logger.warn({
        event: "websocket.control_unavailable",
        message: error instanceof Error ? error.message : "Redis unavailable",
      });
    }
  }

  async onModuleDestroy() {
    if (this.subscriber?.isOpen) await this.subscriber.quit();
  }

  invalidate(input: {
    tenantId: string;
    branchId: string;
    staffId?: string;
    version?: number;
    event: "created" | "updated" | "removed";
  }) {
    const payload = {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      branchId: input.branchId,
      dataVersion: input.version,
      sourceEventType: `availability.block_${input.event}`,
      refetch: true,
      occurredAt: new Date().toISOString(),
    };
    this.server
      ?.to(`branch:${input.branchId}`)
      .emit("availability.invalidated", payload);
    this.server
      ?.to(`tenant:${input.tenantId}`)
      .emit("availability.invalidated", payload);
    if (input.staffId)
      this.server
        ?.to(`staff:${input.staffId}`)
        .emit("availability.invalidated", payload);
  }

  private handleControl(raw: string) {
    let message: RealtimeControlMessage;
    try {
      message = JSON.parse(raw) as RealtimeControlMessage;
    } catch {
      return;
    }
    if (!validControl(message)) return;
    let disconnected = 0;
    for (const socket of this.server?.sockets.values() ?? []) {
      const auth = socket.data.auth as ActiveAuthorizationContext | undefined;
      if (!auth || !controlMatches(message, auth)) continue;
      const event = message.reason.includes("AUTHORIZATION")
        ? "authorization.changed"
        : "session.revoked";
      socket.emit(event, { reason: message.reason, reconnect: false });
      socket.disconnect(true);
      disconnected += 1;
    }
    if (disconnected)
      this.increment("websocket_forced_disconnect_total", disconnected);
    if (disconnected)
      this.logger.warn({
        event: "websocket.forced_disconnect",
        reason: message.reason,
        count: disconnected,
      });
  }

  private increment(name: string, value = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
    this.logger.debug({ event: name, value: this.counters.get(name) });
  }
}

@WebSocketGateway({
  namespace: "scheduling",
  cors: { origin: schedulingOrigins, credentials: true },
  allowRequest: (request, callback) => {
    const origin = request.headers.origin;
    const allowed = !origin || schedulingOrigins.includes(origin);
    if (!allowed)
      console.warn(
        JSON.stringify({
          event: "websocket.connection_denied",
          reason: "ORIGIN_DENIED",
        }),
      );
    callback(null, allowed);
  },
})
export class SchedulingGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server!: Namespace;
  private readonly logger = new Logger(SchedulingGateway.name);
  constructor(
    @Inject(SessionAuthorizationService)
    private readonly sessions: SessionAuthorizationService,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SchedulingRealtimeService)
    private readonly realtime: SchedulingRealtimeService,
  ) {}

  afterInit() {
    this.realtime.attach(this.server);
  }

  async handleConnection(@ConnectedSocket() socket: Socket) {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== "string" || token.length === 0)
        throw Object.assign(new Error("Authentication required"), {
          response: { code: "AUTH_REQUIRED" },
        });
      const auth = await this.sessions.authorize({ accessToken: token });
      if (auth.roles.includes("PLATFORM_SUPER_ADMIN")) {
        this.realtime.denied();
        await this.recordDenied("websocket.platform_access_denied", auth);
        socket.emit("scheduling.denied", { code: "TENANT_ACCESS_DENIED" });
        socket.disconnect(true);
        return;
      }
      socket.data.auth = auth;
      await socket.join([
        `session:${auth.sessionId}`,
        `membership:${auth.membershipId}`,
        `user:${auth.userId}`,
      ]);
      const businessRooms = await this.businessRooms(auth);
      await socket.join(businessRooms);
      const expiresIn =
        new Date(auth.accessTokenExpiresAt).getTime() - Date.now();
      if (expiresIn <= 0) {
        socket.disconnect(true);
        return;
      }
      socket.data.expiryTimer = setTimeout(() => {
        socket.emit("session.revoked", {
          reason: "ACCESS_TOKEN_EXPIRED",
          reconnect: true,
        });
        socket.disconnect(true);
      }, Math.min(expiresIn, 2_147_483_647));
      this.realtime.connected(1);
      this.logger.log({
        event: "websocket.connected",
        tenantId: auth.tenantId,
        sessionId: auth.sessionId,
        roomCount: businessRooms.length,
      });
      socket.emit("scheduling.connected", {
        tenantId: auth.tenantId,
        branchIds: businessRooms
          .filter((room) => room.startsWith("branch:"))
          .map((room) => room.slice(7)),
        refetch: true,
      });
    } catch (error) {
      this.realtime.denied();
      const code = authorizationCode(error);
      await this.recordDenied(
        code === "INVALID_ACCESS_TOKEN"
          ? "websocket.invalid_token"
          : code === "AUTHORIZATION_CHANGED"
            ? "websocket.authorization_changed"
            : "websocket.session_inactive",
        undefined,
        code,
      );
      this.logger.warn({ event: "websocket.connection_denied", reason: code });
      socket.emit("scheduling.denied", { code });
      socket.disconnect(true);
    }
  }

  handleDisconnect(@ConnectedSocket() socket: Socket) {
    const timer = socket.data.expiryTimer as NodeJS.Timeout | undefined;
    if (timer) clearTimeout(timer);
    if (socket.data.auth) this.realtime.connected(-1);
  }

  private async businessRooms(auth: ActiveAuthorizationContext) {
    if (auth.roles.includes("SALON_OWNER")) {
      const branches = await this.db.query<{ id: string }>(
        "SELECT id FROM branches WHERE tenant_id=$1 AND status='ACTIVE' ORDER BY id",
        [auth.tenantId],
      );
      return [
        `tenant:${auth.tenantId}`,
        ...branches.rows.map((row) => `branch:${row.id}`),
      ];
    }
    if (
      auth.roles.includes("BRANCH_MANAGER") ||
      auth.roles.includes("RECEPTIONIST")
    ) {
      const branches = await this.db.query<{ id: string }>(
        "SELECT id FROM branches WHERE tenant_id=$1 AND status='ACTIVE' AND id=ANY($2::uuid[]) ORDER BY id",
        [auth.tenantId, auth.branchIds],
      );
      return branches.rows.map((row) => `branch:${row.id}`);
    }
    if (auth.roles.includes("NAIL_TECHNICIAN")) {
      if (!auth.ownStaffId) {
        await this.recordDenied("websocket.staff_room_denied", auth);
        throw Object.assign(new Error("Staff profile is required"), {
          response: { code: "SCHEDULING_STAFF_PROFILE_REQUIRED" },
        });
      }
      return [`staff:${auth.ownStaffId}`];
    }
    return [];
  }

  private async recordDenied(
    eventType: string,
    auth?: ActiveAuthorizationContext,
    reason?: string,
  ) {
    try {
      await this.db.query(
        "INSERT INTO security_events(tenant_id,user_id,event_type,details_json) VALUES($1,$2,$3,$4)",
        [
          auth?.tenantId ?? null,
          auth?.userId ?? null,
          eventType,
          JSON.stringify({ reason: reason ?? eventType }),
        ],
      );
    } catch {
      // A security denial must never expose credentials or keep a socket alive.
    }
  }
}

function authorizationCode(error: unknown) {
  if (typeof error === "object" && error !== null) {
    const response = (error as { response?: unknown }).response;
    if (typeof response === "object" && response !== null) {
      const code = (response as { code?: unknown }).code;
      if (typeof code === "string") return code;
    }
  }
  return "INVALID_ACCESS_TOKEN";
}

function validControl(value: unknown): value is RealtimeControlMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  if (typeof message.reason !== "string") return false;
  if (message.type === "DISCONNECT_USER")
    return typeof message.userId === "string";
  if (message.type === "DISCONNECT_SESSION")
    return (
      typeof message.tenantId === "string" &&
      typeof message.sessionId === "string"
    );
  if (message.type === "DISCONNECT_MEMBERSHIP")
    return (
      typeof message.tenantId === "string" &&
      typeof message.membershipId === "string"
    );
  return false;
}

function controlMatches(
  message: RealtimeControlMessage,
  auth: ActiveAuthorizationContext,
) {
  if (message.type === "DISCONNECT_USER") return auth.userId === message.userId;
  if (message.tenantId !== auth.tenantId) return false;
  if (message.type === "DISCONNECT_SESSION")
    return auth.sessionId === message.sessionId;
  return auth.membershipId === message.membershipId;
}

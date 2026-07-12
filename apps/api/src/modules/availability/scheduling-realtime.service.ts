import { Inject, Injectable } from "@nestjs/common";
import {
  ConnectedSocket,
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { TokenService } from "../identity/token.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
@Injectable()
export class SchedulingRealtimeService {
  private server?: Server;
  attach(server: Server) {
    this.server = server;
  }
  invalidate(input: {
    tenantId: string;
    branchId: string;
    staffId?: string;
    version?: number;
    event: "created" | "updated" | "removed";
  }) {
    const payload = {
      tenantId: input.tenantId,
      branchId: input.branchId,
      dataVersion: input.version,
      refetch: true,
    };
    this.server
      ?.to(`branch:${input.branchId}`)
      .emit("availability.invalidated", payload);
    this.server
      ?.to(`tenant:${input.tenantId}`)
      .emit("availability.invalidated", payload);
    this.server
      ?.to(`branch:${input.branchId}`)
      .emit(`calendar.event_${input.event}`, payload);
    if (input.staffId)
      this.server
        ?.to(`staff:${input.staffId}`)
        .emit("availability.invalidated", payload);
  }
}
@WebSocketGateway({
  namespace: "scheduling",
  cors: { origin: true, credentials: true },
})
export class SchedulingGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  constructor(
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(SchedulingRealtimeService)
    private readonly realtime: SchedulingRealtimeService,
  ) {}
  afterInit() {
    this.realtime.attach(this.server);
  }
  async handleConnection(@ConnectedSocket() socket: Socket) {
    try {
      const token = String(
        socket.handshake.auth?.token ??
          socket.handshake.headers.authorization ??
          "",
      ).replace(/^Bearer\s+/i, "");
      const claims: AccessClaims = await this.tokens.verifyAccess(token);
      socket.data.auth = claims;
      if (claims.roles.includes("SALON_OWNER"))
        await socket.join(`tenant:${claims.tenantId}`);
      for (const branch of claims.branchIds)
        await socket.join(`branch:${branch}`);
      const staffId = socket.handshake.auth?.staffId;
      if (typeof staffId === "string") await socket.join(`staff:${staffId}`);
      socket.emit("scheduling.connected", {
        tenantId: claims.tenantId,
        branchIds: claims.branchIds,
        refetch: true,
      });
    } catch {
      socket.disconnect(true);
    }
  }
}

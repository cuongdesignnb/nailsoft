import {
  Inject,
  Injectable,
  UnauthorizedException,
  ConflictException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { PasswordService } from "./password.service.js";
import { TokenService } from "./token.service.js";
const loginSchema = z.object({
  tenantSlug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  deviceId: z.string().min(1).max(128),
  deviceName: z.string().min(1).max(128),
  platform: z.enum(["web", "ios", "android"]),
  appVersion: z.string().max(32).optional(),
});
const refreshSchema = z.object({
  refreshToken: z.string().min(32),
  deviceId: z.string().min(1),
});
interface UserRow {
  id: string;
  tenant_id: string;
  password_hash: string | null;
  failed_login_attempts: number;
  locked_until: Date | null;
  status: string;
}
@Injectable()
export class AuthService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}
  async login(
    input: unknown,
    requestId: string,
    ip?: string,
    userAgent?: string,
  ) {
    const body = loginSchema.parse(input);
    const result = await this.db.query<UserRow>(
      "SELECT u.id,u.tenant_id,u.password_hash,u.failed_login_attempts,u.locked_until,u.status FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE t.slug=$1 AND lower(u.email)=lower($2)",
      [body.tenantSlug, body.email],
    );
    const user = result.rows[0];
    if (
      !user ||
      user.status !== "ACTIVE" ||
      !user.password_hash ||
      (user.locked_until && user.locked_until > new Date()) ||
      !(await this.passwords.verify(body.password, user.password_hash))
    ) {
      if (user)
        await this.db.query(
          "UPDATE users SET failed_login_attempts=failed_login_attempts+1,locked_until=CASE WHEN failed_login_attempts+1>=5 THEN now()+interval '15 minutes' ELSE locked_until END WHERE id=$1 AND tenant_id=$2",
          [user.id, user.tenant_id],
        );
      throw new UnauthorizedException({
        code: "INVALID_CREDENTIALS",
        message: "Invalid credentials",
      });
    }
    return this.db.transaction(async (client) => {
      await client.query(
        "UPDATE users SET failed_login_attempts=0,locked_until=NULL WHERE id=$1 AND tenant_id=$2",
        [user.id, user.tenant_id],
      );
      const scope = await client.query<{
        role: string;
        branch_id: string | null;
      }>(
        "SELECT role,branch_id FROM user_roles WHERE tenant_id=$1 AND user_id=$2",
        [user.tenant_id, user.id],
      );
      const refresh = this.tokens.refresh();
      const sessionId = randomUUID();
      await client.query(
        "INSERT INTO sessions(id,tenant_id,user_id,family_id,refresh_token_hash,device_id,device_name,platform,app_version,ip_address,user_agent,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()+interval '30 days')",
        [
          sessionId,
          user.tenant_id,
          user.id,
          randomUUID(),
          this.tokens.hashRefresh(refresh),
          body.deviceId,
          body.deviceName,
          body.platform,
          body.appVersion ?? null,
          ip ?? null,
          userAgent ?? null,
        ],
      );
      await client.query(
        "INSERT INTO audit_logs(tenant_id,actor_user_id,action,entity_type,entity_id,after_json,request_id,created_at) VALUES($1,$2,'session.login','session',$3,$4,$5,now())",
        [
          user.tenant_id,
          user.id,
          sessionId,
          JSON.stringify({ deviceId: body.deviceId, platform: body.platform }),
          requestId,
        ],
      );
      const claims = {
        userId: user.id,
        tenantId: user.tenant_id,
        sessionId,
        roles: scope.rows.map((x) => x.role) as never,
        branchIds: scope.rows.flatMap((x) =>
          x.branch_id ? [x.branch_id] : [],
        ),
      };
      return {
        accessToken: await this.tokens.access(claims),
        refreshToken: refresh,
        expiresIn: 900,
        tenantId: user.tenant_id,
        userId: user.id,
      };
    });
  }
  async refresh(input: unknown, requestId: string) {
    const body = refreshSchema.parse(input);
    const result = await this.db.transaction(async (client) => {
      const found = await client.query<{
        id: string;
        tenant_id: string;
        user_id: string;
        family_id: string;
        device_id: string;
        revoked_at: Date | null;
      }>(
        "SELECT id,tenant_id,user_id,family_id,device_id,revoked_at FROM sessions WHERE refresh_token_hash=$1 FOR UPDATE",
        [this.tokens.hashRefresh(body.refreshToken)],
      );
      const old = found.rows[0];
      if (!old || old.device_id !== body.deviceId)
        throw new UnauthorizedException({
          code: "INVALID_REFRESH_TOKEN",
          message: "Refresh token is invalid",
        });
      if (old.revoked_at) {
        await client.query(
          "UPDATE sessions SET revoked_at=coalesce(revoked_at,now()),revoke_reason='refresh_reuse_detected' WHERE family_id=$1",
          [old.family_id],
        );
        return { reuse: true as const };
      }
      const refresh = this.tokens.refresh();
      const sessionId = randomUUID();
      await client.query(
        "INSERT INTO sessions(id,tenant_id,user_id,family_id,refresh_token_hash,device_id,device_name,platform,expires_at) SELECT $1,tenant_id,user_id,family_id,$2,device_id,device_name,platform,now()+interval '30 days' FROM sessions WHERE id=$3",
        [sessionId, this.tokens.hashRefresh(refresh), old.id],
      );
      await client.query(
        "UPDATE sessions SET revoked_at=now(),revoke_reason='rotated',replaced_by_session_id=$1 WHERE id=$2",
        [sessionId, old.id],
      );
      const scope = await client.query<{
        role: string;
        branch_id: string | null;
      }>(
        "SELECT role,branch_id FROM user_roles WHERE tenant_id=$1 AND user_id=$2",
        [old.tenant_id, old.user_id],
      );
      await client.query(
        "INSERT INTO audit_logs(tenant_id,actor_user_id,action,entity_type,entity_id,request_id) VALUES($1,$2,'session.rotate','session',$3,$4)",
        [old.tenant_id, old.user_id, sessionId, requestId],
      );
      const claims = {
        userId: old.user_id,
        tenantId: old.tenant_id,
        sessionId,
        roles: scope.rows.map((x) => x.role) as never,
        branchIds: scope.rows.flatMap((x) =>
          x.branch_id ? [x.branch_id] : [],
        ),
      };
      return {
        reuse: false as const,
        accessToken: await this.tokens.access(claims),
        refreshToken: refresh,
        expiresIn: 900,
      };
    });
    if (result.reuse)
      throw new ConflictException({
        code: "REFRESH_TOKEN_REUSE",
        message: "Refresh token reuse detected; token family revoked",
      });
    return result;
  }
  async revoke(
    tenantId: string,
    userId: string,
    sessionId: string,
    requestId: string,
  ) {
    const result = await this.db.query(
      "UPDATE sessions SET revoked_at=coalesce(revoked_at,now()),revoke_reason='user_revoked' WHERE id=$1 AND tenant_id=$2 AND user_id=$3",
      [sessionId, tenantId, userId],
    );
    if (result.rowCount !== 1)
      throw new UnauthorizedException({
        code: "SESSION_NOT_FOUND",
        message: "Session not found",
      });
    await this.db.query(
      "INSERT INTO audit_logs(tenant_id,actor_user_id,action,entity_type,entity_id,request_id) VALUES($1,$2,'session.revoke','session',$3,$4)",
      [tenantId, userId, sessionId, requestId],
    );
  }
}

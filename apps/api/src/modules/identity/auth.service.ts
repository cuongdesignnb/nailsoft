import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { PasswordService } from "./password.service.js";
import { TokenService } from "./token.service.js";

const deviceSchema = z.object({
  deviceId: z.string().min(1).max(128),
  deviceName: z.string().min(1).max(128),
  platform: z.enum(["web", "ios", "android"]),
  appVersion: z.string().max(32).optional(),
});
const loginSchema = deviceSchema.extend({
  tenantSlug: z.string().min(1).optional(),
  email: z.string().email(),
  password: z.string().min(8),
});
const selectSchema = deviceSchema.extend({
  workspaceToken: z.string().min(32),
  membershipId: z.string().uuid(),
});
const refreshSchema = z.object({
  refreshToken: z.string().min(32),
  deviceId: z.string().min(1),
});
interface UserRow {
  id: string;
  password_hash: string | null;
  failed_login_attempts: number;
  locked_until: Date | null;
  status: string;
}
interface MembershipRow {
  id: string;
  tenant_id: string;
  authorization_version: number;
  tenant_name: string;
  tenant_slug: string;
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
    const identifier = body.email.trim().toLowerCase();
    await this.assertRateAllowed(ip, identifier);
    const found = await this.db.query<UserRow>(
      "SELECT id,password_hash,failed_login_attempts,locked_until,status FROM users WHERE lower(email)=lower($1)",
      [identifier],
    );
    const user = found.rows[0];
    const valid =
      !!user &&
      user.status === "ACTIVE" &&
      !!user.password_hash &&
      (!user.locked_until || user.locked_until <= new Date()) &&
      (await this.passwords.verify(body.password, user.password_hash));
    if (!valid) {
      await this.recordFailure(user?.id, identifier, ip, requestId);
      throw new UnauthorizedException({
        code: "INVALID_CREDENTIALS",
        message: "Invalid credentials",
      });
    }
    const memberships = await this.memberships(user.id, body.tenantSlug);
    if (memberships.length === 0) {
      await this.recordSecurity(
        "auth.workspace_denied",
        user.id,
        null,
        identifier,
        ip,
        requestId,
        {},
      );
      throw new UnauthorizedException({
        code: "INVALID_CREDENTIALS",
        message: "Invalid credentials",
      });
    }
    await this.db.query(
      "UPDATE users SET failed_login_attempts=0,locked_until=NULL WHERE id=$1",
      [user.id],
    );
    if (!body.tenantSlug && memberships.length > 1)
      return {
        workspaceSelectionRequired: true,
        workspaceToken: await this.tokens.workspace(user.id),
        workspaces: memberships.map((m) => ({
          membershipId: m.id,
          tenantId: m.tenant_id,
          name: m.tenant_name,
          slug: m.tenant_slug,
        })),
      };
    return this.issueSession(
      user.id,
      memberships[0]!,
      body,
      requestId,
      ip,
      userAgent,
    );
  }

  async selectWorkspace(
    input: unknown,
    requestId: string,
    ip?: string,
    userAgent?: string,
  ) {
    const body = selectSchema.parse(input);
    const userId = await this.tokens.verifyWorkspace(body.workspaceToken);
    const result = await this.db.query<MembershipRow>(
      `SELECT tm.id,tm.tenant_id,tm.authorization_version,t.name tenant_name,t.slug tenant_slug FROM tenant_memberships tm JOIN tenants t ON t.id=tm.tenant_id JOIN users u ON u.id=tm.user_id WHERE tm.id=$1 AND tm.user_id=$2 AND tm.status='ACTIVE' AND t.status='ACTIVE' AND u.status='ACTIVE'`,
      [body.membershipId, userId],
    );
    const membership = result.rows[0];
    if (!membership)
      throw new UnauthorizedException({
        code: "WORKSPACE_ACCESS_DENIED",
        message: "Workspace is not available",
      });
    return this.issueSession(
      userId,
      membership,
      body,
      requestId,
      ip,
      userAgent,
    );
  }

  async refresh(input: unknown, requestId: string, ip?: string) {
    const body = refreshSchema.parse(input);
    const result = await this.db.transaction(async (client) => {
      const found = await client.query<{
        id: string;
        tenant_id: string;
        user_id: string;
        membership_id: string;
        family_id: string;
        device_id: string;
        revoked_at: Date | null;
        expires_at: Date;
        user_status: string;
        membership_status: string;
        tenant_status: string;
        authorization_version: number;
      }>(
        `SELECT ds.id,ds.tenant_id,ds.user_id,ds.membership_id,ds.family_id,ds.device_id,ds.revoked_at,ds.expires_at,u.status user_status,tm.status membership_status,t.status tenant_status,tm.authorization_version FROM device_sessions ds JOIN users u ON u.id=ds.user_id JOIN tenant_memberships tm ON tm.id=ds.membership_id AND tm.tenant_id=ds.tenant_id JOIN tenants t ON t.id=ds.tenant_id WHERE ds.refresh_token_hash=$1 FOR UPDATE OF ds`,
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
          "UPDATE device_sessions SET revoked_at=coalesce(revoked_at,now()),revoke_reason='refresh_reuse_detected' WHERE family_id=$1",
          [old.family_id],
        );
        await this.securityWithClient(
          client,
          "auth.refresh_reuse",
          old.user_id,
          old.tenant_id,
          null,
          ip,
          requestId,
          { familyId: old.family_id },
        );
        return { reuse: true as const };
      }
      if (
        old.expires_at <= new Date() ||
        old.user_status !== "ACTIVE" ||
        old.membership_status !== "ACTIVE" ||
        old.tenant_status !== "ACTIVE"
      ) {
        await client.query(
          "UPDATE device_sessions SET revoked_at=coalesce(revoked_at,now()),revoke_reason='security_state_invalid' WHERE family_id=$1",
          [old.family_id],
        );
        return { invalid: true as const, reuse: false as const };
      }
      const refresh = this.tokens.refresh(),
        sessionId = randomUUID();
      await client.query(
        "INSERT INTO device_sessions(id,tenant_id,user_id,membership_id,family_id,refresh_token_hash,device_id,device_name,platform,expires_at) SELECT $1,tenant_id,user_id,membership_id,family_id,$2,device_id,device_name,platform,now()+interval '30 days' FROM device_sessions WHERE id=$3",
        [sessionId, this.tokens.hashRefresh(refresh), old.id],
      );
      await client.query(
        "UPDATE device_sessions SET revoked_at=now(),revoke_reason='rotated',replaced_by_session_id=$1 WHERE id=$2",
        [sessionId, old.id],
      );
      const scope = await this.scope(client, old.membership_id);
      await client.query(
        "INSERT INTO audit_logs(tenant_id,actor_user_id,action,entity_type,entity_id,request_id) VALUES($1,$2,'session.rotate','device_session',$3,$4)",
        [old.tenant_id, old.user_id, sessionId, requestId],
      );
      return {
        reuse: false as const,
        invalid: false as const,
        accessToken: await this.tokens.access({
          userId: old.user_id,
          tenantId: old.tenant_id,
          membershipId: old.membership_id,
          authorizationVersion: old.authorization_version,
          sessionId,
          roles: scope.roles as never,
          branchIds: scope.branchIds,
        }),
        refreshToken: refresh,
        expiresIn: 900,
        tenantId: old.tenant_id,
        membershipId: old.membership_id,
      };
    });
    if (result.reuse)
      throw new ConflictException({
        code: "REFRESH_TOKEN_REUSE",
        message: "Refresh token reuse detected; token family revoked",
      });
    if (result.invalid)
      throw new UnauthorizedException({
        code: "REFRESH_SESSION_INVALID",
        message: "Session, account or workspace is no longer active",
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
      "UPDATE device_sessions SET revoked_at=coalesce(revoked_at,now()),revoke_reason='user_revoked' WHERE id=$1 AND tenant_id=$2 AND user_id=$3",
      [sessionId, tenantId, userId],
    );
    if (result.rowCount !== 1)
      throw new UnauthorizedException({
        code: "SESSION_NOT_FOUND",
        message: "Session not found",
      });
    await this.db.query(
      "INSERT INTO audit_logs(tenant_id,actor_user_id,action,entity_type,entity_id,request_id) VALUES($1,$2,'session.revoke','device_session',$3,$4)",
      [tenantId, userId, sessionId, requestId],
    );
  }

  private async memberships(userId: string, slug?: string) {
    const result = await this.db.query<MembershipRow>(
      `SELECT tm.id,tm.tenant_id,tm.authorization_version,t.name tenant_name,t.slug tenant_slug FROM tenant_memberships tm JOIN tenants t ON t.id=tm.tenant_id WHERE tm.user_id=$1 AND tm.status='ACTIVE' AND t.status='ACTIVE' AND ($2::text IS NULL OR t.slug=$2) ORDER BY t.name`,
      [userId, slug ?? null],
    );
    return result.rows;
  }
  private async issueSession(
    userId: string,
    membership: MembershipRow,
    device: z.infer<typeof deviceSchema>,
    requestId: string,
    ip?: string,
    userAgent?: string,
  ) {
    return this.db.transaction(async (client) => {
      const refresh = this.tokens.refresh(),
        sessionId = randomUUID();
      await client.query(
        "INSERT INTO device_sessions(id,tenant_id,user_id,membership_id,family_id,refresh_token_hash,device_id,device_name,platform,app_version,ip_address,user_agent,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now()+interval '30 days')",
        [
          sessionId,
          membership.tenant_id,
          userId,
          membership.id,
          randomUUID(),
          this.tokens.hashRefresh(refresh),
          device.deviceId,
          device.deviceName,
          device.platform,
          device.appVersion ?? null,
          ip ?? null,
          userAgent ?? null,
        ],
      );
      const scope = await this.scope(client, membership.id);
      await client.query(
        "INSERT INTO audit_logs(tenant_id,actor_user_id,action,entity_type,entity_id,after_json,request_id) VALUES($1,$2,'session.login','device_session',$3,$4,$5)",
        [
          membership.tenant_id,
          userId,
          sessionId,
          JSON.stringify({
            deviceId: device.deviceId,
            platform: device.platform,
            membershipId: membership.id,
          }),
          requestId,
        ],
      );
      return {
        workspaceSelectionRequired: false,
        accessToken: await this.tokens.access({
          userId,
          tenantId: membership.tenant_id,
          membershipId: membership.id,
          authorizationVersion: membership.authorization_version,
          sessionId,
          roles: scope.roles as never,
          branchIds: scope.branchIds,
        }),
        refreshToken: refresh,
        expiresIn: 900,
        tenantId: membership.tenant_id,
        membershipId: membership.id,
        userId,
      };
    });
  }
  private async scope(
    client: {
      query: <T extends import("pg").QueryResultRow>(
        text: string,
        values?: unknown[],
      ) => Promise<import("pg").QueryResult<T>>;
    },
    membershipId: string,
  ) {
    const roles = await client.query<{ role: string }>(
      "SELECT role FROM membership_roles WHERE membership_id=$1",
      [membershipId],
    );
    const branches = await client.query<{ branch_id: string }>(
      "SELECT branch_id FROM membership_branches WHERE membership_id=$1",
      [membershipId],
    );
    return {
      roles: roles.rows.map((x) => x.role),
      branchIds: branches.rows.map((x) => x.branch_id),
    };
  }
  private hashIdentifier(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
  private async assertRateAllowed(ip: string | undefined, identifier: string) {
    const keys = [
      `ip:${ip ?? "unknown"}`,
      `account:${this.hashIdentifier(identifier)}`,
    ];
    const result = await this.db.query<{ blocked_until: Date }>(
      "SELECT blocked_until FROM auth_rate_limits WHERE bucket_key=ANY($1::text[]) AND blocked_until>now() LIMIT 1",
      [keys],
    );
    if (result.rowCount)
      throw new HttpException(
        {
          code: "AUTH_RATE_LIMITED",
          message: "Too many attempts. Try again later.",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }
  private async recordFailure(
    userId: string | undefined,
    identifier: string,
    ip: string | undefined,
    requestId: string,
  ) {
    const keys = [
      `ip:${ip ?? "unknown"}`,
      `account:${this.hashIdentifier(identifier)}`,
    ];
    for (const key of keys)
      await this.db.query(
        `INSERT INTO auth_rate_limits(bucket_key,attempt_count) VALUES($1,1) ON CONFLICT(bucket_key) DO UPDATE SET attempt_count=CASE WHEN auth_rate_limits.window_started_at<now()-interval '15 minutes' THEN 1 ELSE auth_rate_limits.attempt_count+1 END,window_started_at=CASE WHEN auth_rate_limits.window_started_at<now()-interval '15 minutes' THEN now() ELSE auth_rate_limits.window_started_at END,blocked_until=CASE WHEN auth_rate_limits.attempt_count+1>=10 THEN now()+interval '15 minutes' ELSE auth_rate_limits.blocked_until END,updated_at=now()`,
        [key],
      );
    if (userId)
      await this.db.query(
        "UPDATE users SET failed_login_attempts=failed_login_attempts+1,locked_until=CASE WHEN failed_login_attempts+1>=5 THEN now()+interval '15 minutes' ELSE locked_until END WHERE id=$1",
        [userId],
      );
    await this.recordSecurity(
      "auth.login_failed",
      userId,
      null,
      identifier,
      ip,
      requestId,
      {},
    );
  }
  private async recordSecurity(
    type: string,
    userId: string | undefined,
    tenantId: string | null,
    identifier: string | undefined,
    ip: string | undefined,
    requestId: string,
    details: unknown,
  ) {
    await this.db.query(
      "INSERT INTO security_events(tenant_id,user_id,event_type,identifier_hash,ip_address,details_json,request_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        tenantId,
        userId ?? null,
        type,
        identifier ? this.hashIdentifier(identifier) : null,
        ip ?? null,
        JSON.stringify(details),
        requestId,
      ],
    );
  }
  private async securityWithClient(
    client: { query: (text: string, values?: unknown[]) => Promise<unknown> },
    type: string,
    userId: string,
    tenantId: string,
    identifier: string | null,
    ip: string | undefined,
    requestId: string,
    details: unknown,
  ) {
    await client.query(
      "INSERT INTO security_events(tenant_id,user_id,event_type,identifier_hash,ip_address,details_json,request_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        tenantId,
        userId,
        type,
        identifier ? this.hashIdentifier(identifier) : null,
        ip ?? null,
        JSON.stringify(details),
        requestId,
      ],
    );
  }
}

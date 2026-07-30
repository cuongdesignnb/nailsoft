import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  ForbiddenException,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { SessionAuthorizationService } from "./session-authorization.service.js";
import type { AuthenticatedRequest } from "./auth.types.js";
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(SessionAuthorizationService)
    private readonly sessions: SessionAuthorizationService,
    @Optional() @Inject(DatabaseService) private readonly db?: DatabaseService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    const value = Array.isArray(header) ? header[0] : header;
    if (!value?.startsWith("Bearer "))
      throw new UnauthorizedException({
        code: "AUTH_REQUIRED",
        message: "Authentication required",
      });
    const tenantHeader = req.headers["x-tenant-id"];
    const requested = Array.isArray(tenantHeader)
      ? tenantHeader[0]
      : tenantHeader;
    req.auth = await this.sessions.authorize({
      accessToken: value.slice(7),
      ...(requested ? { requiredTenantId: requested } : {}),
    });
    const supportHeader = req.headers["x-support-session-token"];
    const supportToken = Array.isArray(supportHeader) ? supportHeader[0] : supportHeader;
    if (supportToken && req.auth.roles.includes("PLATFORM_SUPER_ADMIN")) {
      if (!this.db || !requested)
        throw new ForbiddenException({
          code: "SUPPORT_SCOPE_DENIED",
          message: "Support access requires an explicit tenant context",
        });
      const tokenHash = createHash("sha256").update(supportToken).digest("hex");
      const support = (
        await this.db.query<{
          id: string;
          grant_id: string;
          permission_scope_json: string[];
          branch_scope_json: string[];
          data_classification_scope_json: string[];
        }>(
          `SELECT s.id,s.grant_id,g.permission_scope_json,g.branch_scope_json,g.data_classification_scope_json
           FROM platform_support_sessions s
           JOIN platform_support_access_grants g ON g.id=s.grant_id
           WHERE s.tenant_id=$1 AND s.support_user_id=$2 AND s.token_hash=$3
             AND s.state='ACTIVE' AND s.expires_at>now()
             AND g.state='ACTIVE' AND g.expires_at>now()`,
          [requested, req.auth.userId, tokenHash],
        )
      ).rows[0];
      if (!support)
        throw new ForbiddenException({
          code: "SUPPORT_SCOPE_DENIED",
          message: "Support access is unavailable, expired, or revoked",
        });
      req.auth = {
        ...req.auth,
        branchIds: support.branch_scope_json,
        supportAccess: {
          grantId: support.grant_id,
          sessionId: support.id,
          permissions: support.permission_scope_json,
          branchIds: support.branch_scope_json,
          dataClassifications: support.data_classification_scope_json,
        },
      };
      await this.db.query(
        "UPDATE platform_support_sessions SET last_seen_at=now() WHERE id=$1 AND state='ACTIVE'",
        [support.id],
      );
      const supportRequest = req as unknown as { method?: string; url?: string };
      await this.db.query(
        `INSERT INTO audit_logs(tenant_id,actor_user_id,action,entity_type,entity_id,after_json)
         VALUES($1,$2,'support.session.accessed','platform_support_session',$3,$4)`,
        [
          requested,
          req.auth.userId,
          support.id,
          JSON.stringify({
            grantId: support.grant_id,
            method: supportRequest.method ?? "UNKNOWN",
            path: (supportRequest.url ?? "").split("?")[0],
            permissions: support.permission_scope_json,
          }),
        ],
      );
    }
    if (this.db && !req.auth.roles.includes("PLATFORM_SUPER_ADMIN")) {
      const tenant = (await this.db.query<{ access_mode: string }>("SELECT access_mode FROM tenants WHERE id=$1",[req.auth.tenantId])).rows[0];
      const mode=tenant?.access_mode??"TERMINATED", method=(req as unknown as {method?:string}).method??"GET", url=(req as unknown as {url?:string}).url??"";
      const safeRead=method==="GET"&&mode==="READ_ONLY";
      const recovery=url.startsWith("/v1/tenant/billing")||url.startsWith("/v1/tenant/support-access-grants")||url.startsWith("/v1/auth")||url.startsWith("/v1/profile")||url.includes("/exports");
      if (mode!=="FULL"&&mode!=="GRACE"&&!safeRead&&!recovery)
        throw new ForbiddenException({code:mode==="TERMINATED"?"TENANT_TERMINATED":mode==="SUSPENDED"||mode==="BILLING_ONLY"?"TENANT_SUSPENDED":"TENANT_READ_ONLY",message:"Tenant access mode blocks this operation"});
      if (["BILLING_ONLY","SUSPENDED","TERMINATED"].includes(mode)&&!recovery)
        throw new ForbiddenException({code:mode==="TERMINATED"?"TENANT_TERMINATED":"TENANT_SUSPENDED",message:"Only billing, security, export and support recovery are available"});
    }
    return true;
  }
}

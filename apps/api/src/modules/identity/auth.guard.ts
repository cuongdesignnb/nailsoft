import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { TokenService } from "./token.service.js";
import type { AuthenticatedRequest } from "./auth.types.js";
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(DatabaseService) private readonly db: DatabaseService,
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
    const claims = await this.tokens.verifyAccess(value.slice(7));
    const tenantHeader = req.headers["x-tenant-id"];
    const requested = Array.isArray(tenantHeader)
      ? tenantHeader[0]
      : tenantHeader;
    if (requested && requested !== claims.tenantId)
      throw new UnauthorizedException({
        code: "TENANT_CONTEXT_MISMATCH",
        message: "Tenant context does not match the authenticated session",
      });
    const active = await this.db.query<{ authorization_version: number }>(
      `SELECT tm.authorization_version FROM device_sessions ds JOIN tenant_memberships tm ON tm.id=ds.membership_id AND tm.tenant_id=ds.tenant_id JOIN users u ON u.id=ds.user_id JOIN tenants t ON t.id=ds.tenant_id
       WHERE ds.id=$1 AND ds.tenant_id=$2 AND ds.user_id=$3 AND ds.membership_id=$4 AND ds.revoked_at IS NULL AND ds.expires_at>now() AND tm.status='ACTIVE' AND u.status='ACTIVE' AND t.status='ACTIVE' AND tm.authorization_version=$5`,
      [
        claims.sessionId,
        claims.tenantId,
        claims.userId,
        claims.membershipId,
        claims.authorizationVersion,
      ],
    );
    if (active.rowCount !== 1)
      throw new UnauthorizedException({
        code: "SESSION_REVOKED",
        message: "Session is no longer active",
      });
    const roles = await this.db.query<{
      role: AuthenticatedRequest["auth"]["roles"][number];
    }>("SELECT role FROM membership_roles WHERE membership_id=$1", [
      claims.membershipId,
    ]);
    const branches = await this.db.query<{ branch_id: string }>(
      "SELECT branch_id FROM membership_branches WHERE membership_id=$1 AND tenant_id=$2",
      [claims.membershipId, claims.tenantId],
    );
    req.auth = {
      ...claims,
      roles: roles.rows.map((x) => x.role),
      branchIds: branches.rows.map((x) => x.branch_id),
    };
    return true;
  }
}

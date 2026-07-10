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
    const active = await this.db.query(
      "SELECT 1 FROM sessions WHERE id=$1 AND tenant_id=$2 AND user_id=$3 AND revoked_at IS NULL AND expires_at>now()",
      [claims.sessionId, claims.tenantId, claims.userId],
    );
    if (active.rowCount !== 1)
      throw new UnauthorizedException({
        code: "SESSION_REVOKED",
        message: "Session is no longer active",
      });
    req.auth = claims;
    return true;
  }
}

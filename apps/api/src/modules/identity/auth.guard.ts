import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { SessionAuthorizationService } from "./session-authorization.service.js";
import type { AuthenticatedRequest } from "./auth.types.js";
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(SessionAuthorizationService)
    private readonly sessions: SessionAuthorizationService,
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
    return true;
  }
}

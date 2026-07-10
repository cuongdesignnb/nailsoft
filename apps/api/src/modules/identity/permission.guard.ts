import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { PERMISSION_KEY } from "./permission.decorator.js";
import type { AuthenticatedRequest } from "./auth.types.js";
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(DatabaseService) private readonly db: DatabaseService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const permission = this.reflector.getAllAndOverride<string>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!permission) return true;
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const result = await this.db.query(
      "SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role=ur.role WHERE ur.tenant_id=$1 AND ur.user_id=$2 AND rp.permission_code=$3 LIMIT 1",
      [req.auth.tenantId, req.auth.userId, permission],
    );
    if (result.rowCount !== 1)
      throw new ForbiddenException({
        code: "PERMISSION_DENIED",
        message: `Missing permission: ${permission}`,
      });
    return true;
  }
}

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
    const permission = this.reflector.getAllAndOverride<string | string[]>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!permission) return true;
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const required = Array.isArray(permission) ? permission : [permission];
    const result = await this.db.query(
      "SELECT 1 FROM membership_roles mr JOIN role_permissions rp ON rp.role=mr.role WHERE mr.membership_id=$1 AND rp.permission_code=ANY($2::text[]) LIMIT 1",
      [req.auth.membershipId, required],
    );
    if (result.rowCount !== 1)
      throw new ForbiddenException({
        code: "PERMISSION_DENIED",
        message: `Missing permission: ${required.join(" or ")}`,
      });
    return true;
  }
}

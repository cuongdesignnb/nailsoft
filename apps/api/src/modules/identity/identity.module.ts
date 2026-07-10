import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { AuthGuard } from "./auth.guard.js";
import { PasswordService } from "./password.service.js";
import { PermissionGuard } from "./permission.guard.js";
import { TokenService } from "./token.service.js";
import { UserController } from "./user.controller.js";
import { UserService } from "./user.service.js";
import { IdentityLifecycleController } from "./identity-lifecycle.controller.js";
import { IdentityLifecycleService } from "./identity-lifecycle.service.js";
@Module({
  controllers: [AuthController, UserController, IdentityLifecycleController],
  providers: [
    AuthService,
    AuthGuard,
    PermissionGuard,
    PasswordService,
    TokenService,
    UserService,
    IdentityLifecycleService,
  ],
  exports: [AuthGuard, PermissionGuard, TokenService],
})
export class IdentityModule {}

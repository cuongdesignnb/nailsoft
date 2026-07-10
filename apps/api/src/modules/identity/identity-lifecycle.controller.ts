import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "./auth.types.js";
import { AuthGuard } from "./auth.guard.js";
import { IdentityLifecycleService } from "./identity-lifecycle.service.js";
import { RequirePermission } from "./permission.decorator.js";
import { PermissionGuard } from "./permission.guard.js";

type RequestContext = { raw: { requestId?: string }; ip?: string };

@ApiTags("identity lifecycle")
@Controller()
export class IdentityLifecycleController {
  constructor(@Inject(IdentityLifecycleService) private readonly lifecycle: IdentityLifecycleService) {}

  @Post("auth/invitations/inspect") inspect(@Body() body: unknown, @Req() req: RequestContext) {
    return this.wrap(this.lifecycle.inspectInvitation(body), req);
  }
  @Post("auth/invitations/accept") accept(@Body() body: unknown, @Req() req: RequestContext) {
    return this.wrap(this.lifecycle.acceptInvitation(body, req.raw.requestId ?? "unknown"), req);
  }
  @Post("auth/forgot-password") @HttpCode(202) forgot(@Body() body: unknown, @Req() req: RequestContext) {
    return this.wrap(this.lifecycle.forgotPassword(body, req.ip), req);
  }
  @Post("auth/reset-password") reset(@Body() body: unknown, @Req() req: RequestContext) {
    return this.wrap(this.lifecycle.resetPassword(body, req.raw.requestId ?? "unknown"), req);
  }
  @Post("auth/otp/request") requestOtp(@Body() body: unknown, @Req() req: RequestContext) {
    return this.wrap(this.lifecycle.requestOtp(body, req.ip), req);
  }
  @Post("auth/otp/verify") verifyOtp(
    @Body() body: unknown, @Req() req: RequestContext, @Headers("user-agent") userAgent?: string,
  ) {
    return this.wrap(this.lifecycle.verifyOtp(body, req.raw.requestId ?? "unknown", req.ip, userAgent), req);
  }
  @Post("profile/phone/request-verification") @UseGuards(AuthGuard) @ApiBearerAuth()
  requestPhone(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return this.wrap(this.lifecycle.requestOwnPhoneVerification(body, req.ip), req);
  }
  @Post("profile/phone/verify") @UseGuards(AuthGuard) @ApiBearerAuth()
  verifyPhone(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return this.wrap(this.lifecycle.verifyOwnPhone(req.auth, body, req.raw.requestId ?? "unknown"), req);
  }

  @Post("users/invitations") @UseGuards(AuthGuard, PermissionGuard) @ApiBearerAuth() @RequirePermission("user.invite")
  createInvitation(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return this.wrap(this.lifecycle.createInvitation(req.auth, body, req.raw.requestId ?? "unknown"), req);
  }
  @Get("users/invitations") @UseGuards(AuthGuard, PermissionGuard) @ApiBearerAuth() @RequirePermission("user.read")
  listInvitations(@Req() req: AuthenticatedRequest) { return this.wrap(this.lifecycle.listInvitations(req.auth), req); }
  @Get("users/invitations/:id") @UseGuards(AuthGuard, PermissionGuard) @ApiBearerAuth() @RequirePermission("user.read")
  getInvitation(@Param("id") id: string, @Req() req: AuthenticatedRequest) { return this.wrap(this.lifecycle.getInvitation(req.auth, id), req); }
  @Post("users/invitations/:id/resend") @UseGuards(AuthGuard, PermissionGuard) @ApiBearerAuth() @RequirePermission("user.invite")
  resendInvitation(@Param("id") id: string, @Req() req: AuthenticatedRequest) { return this.wrap(this.lifecycle.resendInvitation(req.auth, id, req.raw.requestId ?? "unknown"), req); }
  @Post("users/invitations/:id/revoke") @UseGuards(AuthGuard, PermissionGuard) @ApiBearerAuth() @RequirePermission("user.invite")
  revokeInvitation(@Param("id") id: string, @Req() req: AuthenticatedRequest) { return this.wrap(this.lifecycle.revokeInvitation(req.auth, id, req.raw.requestId ?? "unknown"), req); }

  @Post("auth/mfa/totp/enroll")
  enrollMfa(@Body() body: unknown, @Req() req: RequestContext) { return this.wrap(this.lifecycle.enrollMfaChallenge(body), req); }
  @Post("auth/mfa/totp/confirm")
  confirmMfa(@Body() body: unknown, @Req() req: RequestContext, @Headers("user-agent") userAgent?: string) { return this.wrap(this.lifecycle.confirmMfaChallenge(body, req.raw.requestId ?? "unknown", req.ip, userAgent), req); }
  @Post("auth/mfa/challenge/verify")
  verifyMfa(@Body() body: unknown, @Req() req: RequestContext, @Headers("user-agent") userAgent?: string) { return this.wrap(this.lifecycle.verifyMfaChallenge(body, req.raw.requestId ?? "unknown", req.ip, userAgent), req); }
  @Get("auth/mfa/status") @UseGuards(AuthGuard) @ApiBearerAuth()
  mfaStatus(@Req() req: AuthenticatedRequest) { return this.wrap(this.lifecycle.mfaStatus(req.auth), req); }
  @Post("auth/mfa/recovery/verify")
  verifyRecovery(@Body() body: unknown, @Req() req: RequestContext, @Headers("user-agent") userAgent?: string) { return this.wrap(this.lifecycle.verifyMfaRecoveryChallenge(body, req.raw.requestId ?? "unknown", req.ip, userAgent), req); }
  @Post("auth/mfa/recovery/regenerate") @UseGuards(AuthGuard) @ApiBearerAuth()
  regenerateRecovery(@Req() req: AuthenticatedRequest) { return this.wrap(this.lifecycle.regenerateRecovery(req.auth), req); }
  @Delete("auth/mfa/totp") @UseGuards(AuthGuard) @ApiBearerAuth()
  disableMfa(@Body() body: unknown, @Req() req: AuthenticatedRequest) { return this.wrap(this.lifecycle.disableMfa(req.auth, body), req); }

  private async wrap<T>(work: Promise<T>, req: RequestContext) {
    return { success: true, data: await work, meta: { requestId: req.raw.requestId ?? "unknown", timestamp: new Date().toISOString() } };
  }
}

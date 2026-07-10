import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { DatabaseService } from "../../infrastructure/database.service.js";
import type { AccessClaims } from "./auth.types.js";
import { AuthService } from "./auth.service.js";
import {
  assertPasswordPolicy,
  ControlledFakeOtpProvider,
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  normalizePhone,
  secretHash,
  verifyTotp,
} from "./identity-security.js";
import { PasswordService } from "./password.service.js";
import { TokenService } from "./token.service.js";

const roles = ["SALON_OWNER", "BRANCH_MANAGER", "RECEPTIONIST", "CASHIER", "NAIL_TECHNICIAN", "ACCOUNTANT", "MARKETING"] as const;
const invitationSchema = z.object({
  email: z.string().email().optional(), phone: z.string().optional(), displayName: z.string().min(1).max(160),
  roles: z.array(z.enum(roles)).min(1), branchIds: z.array(z.string().uuid()), expiresInHours: z.number().int().min(1).max(168).default(72),
}).refine((value) => value.email || value.phone, "Email or phone is required");
const deviceSchema = z.object({ deviceId: z.string().min(1).max(128), deviceName: z.string().min(1).max(128), platform: z.enum(["web", "ios", "android"]), appVersion: z.string().max(32).optional() });

@Injectable()
export class IdentityLifecycleService {
  private readonly otpProvider = new ControlledFakeOtpProvider();
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}

  async createInvitation(auth: AccessClaims, input: unknown, requestId: string) {
    const body = invitationSchema.parse(input);
    const email = body.email?.trim().toLowerCase() ?? null;
    const phone = body.phone ? this.phone(body.phone) : null;
    this.assertInvitationScope(auth, body.roles, body.branchIds);
    const duplicate = await this.db.query(
      `SELECT 1 FROM tenant_memberships tm JOIN users u ON u.id=tm.user_id
       WHERE tm.tenant_id=$1 AND tm.status='ACTIVE' AND (($2::text IS NOT NULL AND lower(u.email)=$2) OR ($3::text IS NOT NULL AND u.phone_e164=$3))`,
      [auth.tenantId, email, phone],
    );
    if (duplicate.rowCount) throw new ConflictException({ code: "MEMBERSHIP_EXISTS", message: "An active membership already exists" });
    const rawToken = randomBytes(32).toString("base64url");
    const invitation = await this.db.transaction(async (client) => {
      for (const branchId of body.branchIds) {
        const branch = await client.query("SELECT 1 FROM branches WHERE tenant_id=$1 AND id=$2", [auth.tenantId, branchId]);
        if (!branch.rowCount) throw new ForbiddenException({ code: "INVITATION_SCOPE_DENIED", message: "A branch is outside the authorized tenant" });
      }
      const created = await client.query<{ id: string; expires_at: Date }>(
        `INSERT INTO invitations(tenant_id,email_normalized,phone_e164,display_name,token_hash,expires_at,invited_by_user_id)
         VALUES($1,$2,$3,$4,$5,now()+($6||' hours')::interval,$7) RETURNING id,expires_at`,
        [auth.tenantId, email, phone, body.displayName, secretHash(rawToken, "invitation"), body.expiresInHours, auth.userId],
      );
      const id = created.rows[0]!.id;
      for (const role of new Set(body.roles)) await client.query("INSERT INTO invitation_roles(invitation_id,role) VALUES($1,$2)", [id, role]);
      for (const branchId of new Set(body.branchIds)) await client.query("INSERT INTO invitation_branches(invitation_id,tenant_id,branch_id) VALUES($1,$2,$3)", [id, auth.tenantId, branchId]);
      await this.audit(client, auth.tenantId, auth.userId, "identity.invitation_created", "invitation", id, requestId, { email, phone, roles: body.roles, branchIds: body.branchIds });
      await this.outbox(client, auth.tenantId, "identity.invitation_created", "invitation", id, auth.userId, { invitationId: id, locale: "vi-VN" });
      return { id, expiresAt: created.rows[0]!.expires_at };
    });
    return { ...invitation, ...(process.env.NODE_ENV !== "production" ? { deliveryToken: rawToken } : {}), status: "PENDING" as const };
  }

  async listInvitations(auth: AccessClaims) {
    const result = await this.db.query(
      `SELECT i.id,i.email_normalized "email",i.phone_e164 "phone",i.display_name "displayName",i.status,i.expires_at "expiresAt",i.created_at "createdAt",
       coalesce((SELECT array_agg(role) FROM invitation_roles WHERE invitation_id=i.id),'{}') roles,
       coalesce((SELECT array_agg(branch_id) FROM invitation_branches WHERE invitation_id=i.id),'{}') "branchIds"
       FROM invitations i WHERE i.tenant_id=$1 ORDER BY i.created_at DESC`, [auth.tenantId]);
    return result.rows;
  }

  async getInvitation(auth: AccessClaims, id: string) {
    const rows = await this.listInvitations(auth);
    const invitation = (rows as Array<{ id: string }>).find((item) => item.id === id);
    if (!invitation) throw new GoneException({ code: "INVITATION_NOT_FOUND", message: "Invitation was not found" });
    return invitation;
  }

  async resendInvitation(auth: AccessClaims, id: string, requestId: string) {
    const rawToken = randomBytes(32).toString("base64url");
    const result = await this.db.query<{ expires_at: Date }>(
      `UPDATE invitations SET token_hash=$1,expires_at=now()+interval '72 hours',updated_at=now()
       WHERE id=$2 AND tenant_id=$3 AND status='PENDING' RETURNING expires_at`,
      [secretHash(rawToken, "invitation"), id, auth.tenantId]);
    if (!result.rowCount) throw new GoneException({ code: "INVITATION_NOT_FOUND", message: "Pending invitation was not found" });
    await this.record(auth, "identity.invitation_resent", "invitation", id, requestId);
    return { id, ...(process.env.NODE_ENV !== "production" ? { deliveryToken: rawToken } : {}), expiresAt: result.rows[0]!.expires_at };
  }

  async revokeInvitation(auth: AccessClaims, id: string, requestId: string) {
    const result = await this.db.query("UPDATE invitations SET status='REVOKED',revoked_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2 AND status='PENDING'", [id, auth.tenantId]);
    if (!result.rowCount) throw new GoneException({ code: "INVITATION_NOT_FOUND", message: "Pending invitation was not found" });
    await this.record(auth, "identity.invitation_revoked", "invitation", id, requestId);
    return { id, status: "REVOKED" as const };
  }

  async inspectInvitation(input: unknown) {
    const { token } = z.object({ token: z.string().min(32) }).parse(input);
    const result = await this.db.query(
      `SELECT id,email_normalized "email",phone_e164 "phone",display_name "displayName",status,expires_at "expiresAt",
       coalesce((SELECT array_agg(role) FROM invitation_roles WHERE invitation_id=invitations.id),'{}') roles
       FROM invitations WHERE token_hash=$1`, [secretHash(token, "invitation")]);
    const invitation = result.rows[0] as { status?: string; expiresAt?: Date } | undefined;
    if (!invitation) throw new GoneException({ code: "INVITATION_NOT_FOUND", message: "Invitation was not found" });
    if (invitation.status !== "PENDING") throw new ConflictException({ code: invitation.status === "REVOKED" ? "INVITATION_REVOKED" : "INVITATION_ALREADY_USED", message: "Invitation is no longer available" });
    if (invitation.expiresAt! <= new Date()) throw new GoneException({ code: "INVITATION_EXPIRED", message: "Invitation has expired" });
    return invitation;
  }

  async acceptInvitation(input: unknown, requestId: string) {
    const body = z.object({ token: z.string().min(32), password: z.string().max(128).optional(), displayName: z.string().min(1).max(160).optional(), locale: z.enum(["vi-VN", "en-US"]).default("vi-VN") }).parse(input);
    return this.db.transaction(async (client) => {
      const found = await client.query<{ id: string; tenant_id: string; email_normalized: string | null; phone_e164: string | null; display_name: string; status: string; expires_at: Date }>("SELECT * FROM invitations WHERE token_hash=$1 FOR UPDATE", [secretHash(body.token, "invitation")]);
      const invitation = found.rows[0];
      if (!invitation) throw new GoneException({ code: "INVITATION_NOT_FOUND", message: "Invitation was not found" });
      if (invitation.status !== "PENDING") throw new ConflictException({ code: "INVITATION_ALREADY_USED", message: "Invitation is no longer available" });
      if (invitation.expires_at <= new Date()) {
        await client.query("UPDATE invitations SET status='EXPIRED',updated_at=now() WHERE id=$1", [invitation.id]);
        throw new GoneException({ code: "INVITATION_EXPIRED", message: "Invitation has expired" });
      }
      let user = (await client.query<{ id: string; password_hash: string | null }>("SELECT id,password_hash FROM users WHERE ($1::text IS NOT NULL AND lower(email)=$1) OR ($2::text IS NOT NULL AND phone_e164=$2) FOR UPDATE", [invitation.email_normalized, invitation.phone_e164])).rows[0];
      if (!user) {
        if (!body.password) throw new BadRequestException({ code: "PASSWORD_REQUIRED", message: "A password is required" });
        assertPasswordPolicy(body.password, [invitation.email_normalized ?? "", invitation.phone_e164 ?? ""]);
        user = (await client.query<{ id: string; password_hash: string | null }>(
          `INSERT INTO users(origin_tenant_id,email,phone_e164,display_name,password_hash,locale,phone_verified_at)
           VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $3::text IS NULL THEN NULL ELSE now() END) RETURNING id,password_hash`,
          [invitation.tenant_id, invitation.email_normalized, invitation.phone_e164, body.displayName ?? invitation.display_name, await this.passwords.hash(body.password), body.locale])).rows[0]!;
      }
      const membershipId = randomUUID();
      await client.query("INSERT INTO tenant_memberships(id,tenant_id,user_id,status,joined_at) VALUES($1,$2,$3,'ACTIVE',now())", [membershipId, invitation.tenant_id, user.id]);
      await client.query("INSERT INTO membership_roles(membership_id,role) SELECT $1,role FROM invitation_roles WHERE invitation_id=$2", [membershipId, invitation.id]);
      await client.query("INSERT INTO membership_branches(membership_id,tenant_id,branch_id) SELECT $1,tenant_id,branch_id FROM invitation_branches WHERE invitation_id=$2", [membershipId, invitation.id]);
      await client.query("UPDATE invitations SET status='ACCEPTED',accepted_by_user_id=$2,accepted_at=now(),updated_at=now() WHERE id=$1", [invitation.id, user.id]);
      await this.audit(client, invitation.tenant_id, user.id, "identity.invitation_accepted", "invitation", invitation.id, requestId, { membershipId });
      await this.outbox(client, invitation.tenant_id, "identity.membership_activated", "tenant_membership", membershipId, user.id, { membershipId, userId: user.id });
      return { invitationId: invitation.id, membershipId, userId: user.id, status: "ACTIVE" as const };
    });
  }

  async forgotPassword(input: unknown, ip?: string) {
    const body = z.object({ identifier: z.string().min(3).max(254) }).parse(input);
    const normalized = body.identifier.includes("@") ? body.identifier.trim().toLowerCase() : this.phone(body.identifier);
    const user = (await this.db.query<{ id: string; origin_tenant_id: string | null }>("SELECT id,origin_tenant_id FROM users WHERE lower(email)=$1 OR phone_e164=$1", [normalized])).rows[0];
    if (user) {
      const token = randomBytes(32).toString("base64url");
      await this.db.query("INSERT INTO password_reset_tokens(user_id,token_hash,expires_at,requested_ip) VALUES($1,$2,now()+interval '30 minutes',$3)", [user.id, secretHash(token, "password-reset"), ip ?? null]);
      await this.db.query("INSERT INTO security_events(tenant_id,user_id,event_type,identifier_hash,ip_address,details_json) VALUES($1,$2,'auth.password_reset_requested',$3,$4,'{}')", [user.origin_tenant_id, user.id, secretHash(normalized, "identifier"), ip ?? null]);
      return { accepted: true, ...(process.env.NODE_ENV !== "production" ? { deliveryToken: token } : {}) };
    }
    return { accepted: true };
  }

  async resetPassword(input: unknown, requestId: string) {
    const body = z.object({ token: z.string().min(32), password: z.string().max(128) }).parse(input);
    return this.db.transaction(async (client) => {
      const found = await client.query<{ id: string; user_id: string; expires_at: Date; consumed_at: Date | null }>("SELECT id,user_id,expires_at,consumed_at FROM password_reset_tokens WHERE token_hash=$1 FOR UPDATE", [secretHash(body.token, "password-reset")]);
      const reset = found.rows[0];
      if (!reset) throw new UnauthorizedException({ code: "PASSWORD_RESET_INVALID", message: "Password reset token is invalid" });
      if (reset.consumed_at) throw new ConflictException({ code: "PASSWORD_RESET_ALREADY_USED", message: "Password reset token was already used" });
      if (reset.expires_at <= new Date()) throw new GoneException({ code: "PASSWORD_RESET_EXPIRED", message: "Password reset token has expired" });
      const identity = (await client.query<{ email: string | null; phone_e164: string | null }>("SELECT email,phone_e164 FROM users WHERE id=$1", [reset.user_id])).rows[0]!;
      assertPasswordPolicy(body.password, [identity.email ?? "", identity.phone_e164 ?? ""]);
      await client.query("UPDATE users SET password_hash=$2,security_stamp=gen_random_uuid(),failed_login_attempts=0,locked_until=NULL,updated_at=now() WHERE id=$1", [reset.user_id, await this.passwords.hash(body.password)]);
      await client.query("UPDATE password_reset_tokens SET consumed_at=now() WHERE id=$1", [reset.id]);
      const revoked = await client.query("UPDATE device_sessions SET revoked_at=coalesce(revoked_at,now()),revoke_reason='password_reset' WHERE user_id=$1 AND revoked_at IS NULL", [reset.user_id]);
      const memberships = await client.query<{ tenant_id: string }>("SELECT tenant_id FROM tenant_memberships WHERE user_id=$1", [reset.user_id]);
      for (const membership of memberships.rows) await this.audit(client, membership.tenant_id, reset.user_id, "auth.password_reset_completed", "user", reset.user_id, requestId, { revokedSessions: revoked.rowCount });
      return { reset: true, revokedSessions: revoked.rowCount };
    });
  }

  async requestOtp(input: unknown, ip?: string) {
    const body = z.object({ phone: z.string(), purpose: z.enum(["LOGIN", "VERIFY_PHONE", "ACCEPT_INVITATION", "RECOVERY"]).default("LOGIN"), locale: z.enum(["vi-VN", "en-US"]).default("vi-VN") }).parse(input);
    const phone = this.phone(body.phone);
    const recent = await this.db.query<{ created_at: Date; count: number }>(`SELECT max(created_at) created_at,count(*)::int count FROM phone_verification_challenges WHERE phone_e164=$1 AND created_at>now()-interval '10 minutes'`, [phone]);
    if ((recent.rows[0]?.count ?? 0) >= 5 || (recent.rows[0]?.created_at && Date.now() - recent.rows[0].created_at.getTime() < 60_000))
      throw new ConflictException({ code: "OTP_RATE_LIMITED", message: "Please wait before requesting another code" });
    const id = randomUUID();
    const code = process.env.NODE_ENV === "production" ? randomBytes(4).readUInt32BE(0).toString().slice(0, 6).padStart(6, "0") : "123456";
    await this.db.query(`INSERT INTO phone_verification_challenges(id,phone_e164,purpose,code_hash,expires_at,request_ip) VALUES($1,$2,$3,$4,now()+interval '5 minutes',$5)`, [id, phone, body.purpose, secretHash(`${id}:${code}`, "otp"), ip ?? null]);
    await this.otpProvider.send({ destination: phone, code, locale: body.locale, purpose: body.purpose });
    return { challengeId: id, expiresIn: 300, resendAfter: 60 };
  }

  async verifyOtp(input: unknown, requestId: string, ip?: string, userAgent?: string) {
    const body = z.object({ challengeId: z.string().uuid(), code: z.string().regex(/^[0-9]{6}$/), tenantSlug: z.string().optional() }).and(deviceSchema).parse(input);
    const userId = await this.db.transaction(async (client) => {
      const found = await client.query<{ phone_e164: string; code_hash: string; attempt_count: number; expires_at: Date; consumed_at: Date | null }>("SELECT phone_e164,code_hash,attempt_count,expires_at,consumed_at FROM phone_verification_challenges WHERE id=$1 AND purpose='LOGIN' FOR UPDATE", [body.challengeId]);
      const challenge = found.rows[0];
      if (!challenge) throw new UnauthorizedException({ code: "OTP_INVALID", message: "Verification code is invalid" });
      if (challenge.consumed_at || challenge.expires_at <= new Date()) throw new GoneException({ code: "OTP_EXPIRED", message: "Verification code has expired" });
      if (challenge.attempt_count >= 5) throw new ConflictException({ code: "OTP_ATTEMPTS_EXCEEDED", message: "Too many verification attempts" });
      if (challenge.code_hash !== secretHash(`${body.challengeId}:${body.code}`, "otp")) {
        await client.query("UPDATE phone_verification_challenges SET attempt_count=attempt_count+1,blocked_until=CASE WHEN attempt_count+1>=5 THEN now()+interval '15 minutes' ELSE blocked_until END WHERE id=$1", [body.challengeId]);
        throw new UnauthorizedException({ code: "OTP_INVALID", message: "Verification code is invalid" });
      }
      await client.query("UPDATE phone_verification_challenges SET consumed_at=now() WHERE id=$1", [body.challengeId]);
      const user = (await client.query<{ id: string }>("SELECT id FROM users WHERE phone_e164=$1 AND phone_verified_at IS NOT NULL AND status='ACTIVE'", [challenge.phone_e164])).rows[0];
      if (!user) throw new UnauthorizedException({ code: "INVALID_CREDENTIALS", message: "Invalid credentials" });
      return user.id;
    });
    return this.auth.loginVerifiedIdentity(userId, body.tenantSlug, body, requestId, ip, userAgent);
  }

  requestOwnPhoneVerification(input: unknown, ip?: string) {
    const body = z.object({ phone: z.string(), locale: z.enum(["vi-VN", "en-US"]).default("vi-VN") }).parse(input);
    return this.requestOtp({ ...body, purpose: "VERIFY_PHONE" }, ip);
  }

  async verifyOwnPhone(auth: AccessClaims, input: unknown, requestId: string) {
    const body = z.object({ challengeId: z.string().uuid(), code: z.string().regex(/^[0-9]{6}$/) }).parse(input);
    return this.db.transaction(async (client) => {
      const found = await client.query<{ phone_e164: string; code_hash: string; attempt_count: number; expires_at: Date; consumed_at: Date | null }>("SELECT phone_e164,code_hash,attempt_count,expires_at,consumed_at FROM phone_verification_challenges WHERE id=$1 AND purpose='VERIFY_PHONE' FOR UPDATE", [body.challengeId]);
      const challenge = found.rows[0];
      if (!challenge || challenge.consumed_at || challenge.expires_at <= new Date()) throw new GoneException({ code: "OTP_EXPIRED", message: "Verification code has expired" });
      if (challenge.attempt_count >= 5) throw new ConflictException({ code: "OTP_ATTEMPTS_EXCEEDED", message: "Too many verification attempts" });
      if (challenge.code_hash !== secretHash(`${body.challengeId}:${body.code}`, "otp")) {
        await client.query("UPDATE phone_verification_challenges SET attempt_count=least(attempt_count+1,5) WHERE id=$1", [body.challengeId]);
        throw new UnauthorizedException({ code: "OTP_INVALID", message: "Verification code is invalid" });
      }
      await client.query("UPDATE phone_verification_challenges SET consumed_at=now() WHERE id=$1", [body.challengeId]);
      await client.query("UPDATE users SET phone_e164=$2,phone_verified_at=now(),updated_at=now() WHERE id=$1", [auth.userId, challenge.phone_e164]);
      await this.audit(client, auth.tenantId, auth.userId, "identity.phone_verified", "user", auth.userId, requestId, { phoneE164: challenge.phone_e164 });
      return { phoneE164: challenge.phone_e164, verified: true };
    });
  }

  async enrollMfa(auth: AccessClaims) {
    const existing = await this.db.query("SELECT 1 FROM mfa_methods WHERE user_id=$1 AND status IN ('PENDING','ACTIVE')", [auth.userId]);
    if (existing.rowCount) throw new ConflictException({ code: "MFA_ALREADY_ENABLED", message: "MFA enrollment already exists" });
    const secret = generateTotpSecret();
    const method = await this.db.query<{ id: string }>("INSERT INTO mfa_methods(user_id,type,secret_encrypted) VALUES($1,'TOTP',$2) RETURNING id", [auth.userId, encryptSecret(secret)]);
    return { methodId: method.rows[0]!.id, secret, otpauthUri: `otpauth://totp/Nailsoft:${encodeURIComponent(auth.userId)}?secret=${secret}&issuer=Nailsoft` };
  }

  async enrollMfaChallenge(input: unknown) {
    const { mfaToken } = z.object({ mfaToken: z.string().min(32) }).parse(input);
    const challenge = await this.tokens.verifyMfa(mfaToken);
    if (challenge.state !== "MFA_ENROLLMENT_REQUIRED") throw new ForbiddenException({ code: "MFA_RESET_DENIED", message: "MFA enrollment is not allowed for this challenge" });
    const active = await this.db.query("SELECT 1 FROM mfa_challenges WHERE id=$1 AND user_id=$2 AND consumed_at IS NULL AND expires_at>now()", [challenge.challengeId, challenge.userId]);
    if (!active.rowCount) throw new UnauthorizedException({ code: "MFA_CHALLENGE_EXPIRED", message: "MFA challenge has expired" });
    await this.db.query("UPDATE mfa_methods SET status='DISABLED',disabled_at=now() WHERE user_id=$1 AND status='PENDING'", [challenge.userId]);
    const secret = generateTotpSecret();
    const method = await this.db.query<{ id: string }>("INSERT INTO mfa_methods(user_id,type,secret_encrypted) VALUES($1,'TOTP',$2) RETURNING id", [challenge.userId, encryptSecret(secret)]);
    return { methodId: method.rows[0]!.id, secret, otpauthUri: `otpauth://totp/Nailsoft:${encodeURIComponent(challenge.userId)}?secret=${secret}&issuer=Nailsoft`, mfaToken };
  }

  async confirmMfaChallenge(input: unknown, requestId: string, ip?: string, userAgent?: string) {
    const { mfaToken, code } = z.object({ mfaToken: z.string().min(32), code: z.string().regex(/^[0-9]{6}$/) }).parse(input);
    const challenge = await this.tokens.verifyMfa(mfaToken);
    if (challenge.state !== "MFA_ENROLLMENT_REQUIRED") throw new ForbiddenException({ code: "MFA_RESET_DENIED", message: "MFA enrollment is not allowed" });
    const method = (await this.db.query<{ id: string; secret_encrypted: string }>("SELECT id,secret_encrypted FROM mfa_methods WHERE user_id=$1 AND status='PENDING' ORDER BY created_at DESC LIMIT 1", [challenge.userId])).rows[0];
    if (!method || !verifyTotp(decryptSecret(method.secret_encrypted), code)) throw new UnauthorizedException({ code: "MFA_CHALLENGE_INVALID", message: "MFA code is invalid" });
    const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(8).toString("hex"));
    await this.db.transaction(async (client) => {
      await client.query("UPDATE mfa_methods SET status='ACTIVE',verified_at=now() WHERE id=$1", [method.id]);
      await client.query("DELETE FROM mfa_recovery_codes WHERE user_id=$1", [challenge.userId]);
      for (const recoveryCode of recoveryCodes) await client.query("INSERT INTO mfa_recovery_codes(user_id,code_hash) VALUES($1,$2)", [challenge.userId, secretHash(recoveryCode, "mfa-recovery")]);
    });
    return { ...(await this.auth.completeMfa(mfaToken, requestId, ip, userAgent)), recoveryCodes };
  }

  async verifyMfaChallenge(input: unknown, requestId: string, ip?: string, userAgent?: string) {
    const { mfaToken, code } = z.object({ mfaToken: z.string().min(32), code: z.string().regex(/^[0-9]{6}$/) }).parse(input);
    const challenge = await this.tokens.verifyMfa(mfaToken);
    if (challenge.state !== "MFA_REQUIRED") throw new ForbiddenException({ code: "MFA_ENROLLMENT_REQUIRED", message: "MFA enrollment is required" });
    const method = (await this.db.query<{ secret_encrypted: string }>("SELECT secret_encrypted FROM mfa_methods WHERE user_id=$1 AND status='ACTIVE'", [challenge.userId])).rows[0];
    if (!method || !verifyTotp(decryptSecret(method.secret_encrypted), code)) {
      await this.db.query("UPDATE mfa_challenges SET attempt_count=least(attempt_count+1,5) WHERE id=$1", [challenge.challengeId]);
      throw new UnauthorizedException({ code: "MFA_CHALLENGE_INVALID", message: "MFA code is invalid" });
    }
    return this.auth.completeMfa(mfaToken, requestId, ip, userAgent);
  }

  async verifyMfaRecoveryChallenge(input: unknown, requestId: string, ip?: string, userAgent?: string) {
    const { mfaToken, code } = z.object({ mfaToken: z.string().min(32), code: z.string().min(8) }).parse(input);
    const challenge = await this.tokens.verifyMfa(mfaToken);
    const result = await this.db.query("UPDATE mfa_recovery_codes SET consumed_at=now() WHERE user_id=$1 AND code_hash=$2 AND consumed_at IS NULL", [challenge.userId, secretHash(code, "mfa-recovery")]);
    if (!result.rowCount) throw new UnauthorizedException({ code: "MFA_RECOVERY_CODE_INVALID", message: "Recovery code is invalid" });
    return this.auth.completeMfa(mfaToken, requestId, ip, userAgent);
  }

  async confirmMfa(auth: AccessClaims, input: unknown) {
    const { code } = z.object({ code: z.string().regex(/^[0-9]{6}$/) }).parse(input);
    const method = (await this.db.query<{ id: string; secret_encrypted: string }>("SELECT id,secret_encrypted FROM mfa_methods WHERE user_id=$1 AND status='PENDING' ORDER BY created_at DESC LIMIT 1", [auth.userId])).rows[0];
    if (!method || !verifyTotp(decryptSecret(method.secret_encrypted), code)) throw new UnauthorizedException({ code: "MFA_CHALLENGE_INVALID", message: "MFA code is invalid" });
    const rawCodes = Array.from({ length: 10 }, () => randomBytes(8).toString("hex"));
    await this.db.transaction(async (client) => {
      await client.query("UPDATE mfa_methods SET status='ACTIVE',verified_at=now() WHERE id=$1", [method.id]);
      await client.query("DELETE FROM mfa_recovery_codes WHERE user_id=$1", [auth.userId]);
      for (const recoveryCode of rawCodes) await client.query("INSERT INTO mfa_recovery_codes(user_id,code_hash) VALUES($1,$2)", [auth.userId, secretHash(recoveryCode, "mfa-recovery")]);
    });
    return { enabled: true, recoveryCodes: rawCodes };
  }

  async mfaStatus(auth: AccessClaims) {
    const result = await this.db.query("SELECT type,status,verified_at \"verifiedAt\",created_at \"createdAt\" FROM mfa_methods WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", [auth.userId]);
    return result.rows[0] ?? { status: "NOT_ENROLLED" };
  }

  async verifyRecovery(auth: AccessClaims, input: unknown) {
    const { code } = z.object({ code: z.string().min(8) }).parse(input);
    const result = await this.db.query("UPDATE mfa_recovery_codes SET consumed_at=now() WHERE user_id=$1 AND code_hash=$2 AND consumed_at IS NULL", [auth.userId, secretHash(code, "mfa-recovery")]);
    if (!result.rowCount) throw new UnauthorizedException({ code: "MFA_RECOVERY_CODE_INVALID", message: "Recovery code is invalid" });
    return { verified: true };
  }

  async regenerateRecovery(auth: AccessClaims) {
    const enabled = await this.db.query("SELECT 1 FROM mfa_methods WHERE user_id=$1 AND status='ACTIVE'", [auth.userId]);
    if (!enabled.rowCount) throw new ConflictException({ code: "MFA_NOT_ENABLED", message: "MFA is not enabled" });
    const codes = Array.from({ length: 10 }, () => randomBytes(8).toString("hex"));
    await this.db.transaction(async (client) => {
      await client.query("DELETE FROM mfa_recovery_codes WHERE user_id=$1", [auth.userId]);
      for (const code of codes) await client.query("INSERT INTO mfa_recovery_codes(user_id,code_hash) VALUES($1,$2)", [auth.userId, secretHash(code, "mfa-recovery")]);
    });
    return { recoveryCodes: codes };
  }

  async disableMfa(auth: AccessClaims, input: unknown) {
    const { code } = z.object({ code: z.string().regex(/^[0-9]{6}$/) }).parse(input);
    const method = (await this.db.query<{ id: string; secret_encrypted: string }>("SELECT id,secret_encrypted FROM mfa_methods WHERE user_id=$1 AND status='ACTIVE'", [auth.userId])).rows[0];
    if (!method || !verifyTotp(decryptSecret(method.secret_encrypted), code)) throw new UnauthorizedException({ code: "MFA_CHALLENGE_INVALID", message: "Step-up verification failed" });
    await this.db.query("UPDATE mfa_methods SET status='DISABLED',disabled_at=now() WHERE id=$1", [method.id]);
    await this.db.query("DELETE FROM mfa_recovery_codes WHERE user_id=$1", [auth.userId]);
    return { disabled: true };
  }

  private phone(value: string) {
    try { return normalizePhone(value); } catch { throw new BadRequestException({ code: "PHONE_INVALID", message: "Phone number must be valid E.164" }); }
  }
  private assertInvitationScope(auth: AccessClaims, targetRoles: readonly string[], branchIds: readonly string[]) {
    if (auth.roles.includes("SALON_OWNER")) return;
    if (!auth.roles.includes("BRANCH_MANAGER") || targetRoles.includes("SALON_OWNER") || branchIds.some((id) => !auth.branchIds.includes(id)))
      throw new ForbiddenException({ code: "INVITATION_SCOPE_DENIED", message: "Invitation is outside the authorized scope" });
  }
  private async record(auth: AccessClaims, action: string, type: string, id: string, requestId: string) {
    await this.db.transaction(async (client) => {
      await this.audit(client, auth.tenantId, auth.userId, action, type, id, requestId, {});
      await this.outbox(client, auth.tenantId, action, type, id, auth.userId, { id });
    });
  }
  private audit(client: { query: (text: string, values?: unknown[]) => Promise<unknown> }, tenantId: string, actorId: string, action: string, entityType: string, entityId: string, requestId: string, after: unknown) {
    return client.query("INSERT INTO audit_logs(tenant_id,actor_user_id,action,entity_type,entity_id,after_json,request_id) VALUES($1,$2,$3,$4,$5,$6,$7)", [tenantId, actorId, action, entityType, entityId, JSON.stringify(after), requestId]);
  }
  private outbox(client: { query: (text: string, values?: unknown[]) => Promise<unknown> }, tenantId: string, eventType: string, aggregateType: string, aggregateId: string, actorId: string, payload: unknown) {
    return client.query("INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload_json,actor_json) VALUES($1,$2,$3,$4,$5,$6)", [tenantId, eventType, aggregateType, aggregateId, JSON.stringify(payload), JSON.stringify({ type: "USER", id: actorId })]);
  }
}

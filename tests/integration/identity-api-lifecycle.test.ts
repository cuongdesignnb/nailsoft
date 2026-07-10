import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/main";
import { DatabaseService } from "../../apps/api/src/infrastructure/database.service";
import { totp } from "../../apps/api/src/modules/identity/identity-security";

let app: Awaited<ReturnType<typeof createApp>>;
let ownerToken = "";
let invitationToken = "";
let invitedUserId = "";
let invitedMembershipId = "";
let mfaToken = "";
let mfaSecret = "";
const email = "sprint1.lifecycle@example.test";
const tenantId = "10000000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000001";

describe("Sprint 1 invitation recovery OTP and MFA APIs", () => {
  beforeAll(async () => {
    app = await createApp(); await app.init(); await app.getHttpAdapter().getInstance().ready();
    const db = app.get(DatabaseService);
    await db.query("UPDATE users SET phone_e164='+84901234567',phone_verified_at=now() WHERE email='owner@example.test'");
    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { tenantSlug: "nailsoft-demo", email: "owner@example.test", password: "DemoPass123!", deviceId: "lifecycle-owner", deviceName: "Lifecycle Owner", platform: "android" } });
    ownerToken = login.json().data.accessToken;
  });
  afterAll(async () => {
    const db = app.get(DatabaseService);
    if (invitedUserId) {
      await db.query("DELETE FROM invitations WHERE accepted_by_user_id=$1 OR email_normalized=$2", [invitedUserId, email]);
      await db.query("DELETE FROM password_reset_tokens WHERE user_id=$1", [invitedUserId]);
      await db.query("DELETE FROM device_sessions WHERE user_id=$1", [invitedUserId]);
      await db.query("DELETE FROM mfa_challenges WHERE user_id=$1", [invitedUserId]);
      await db.query("DELETE FROM mfa_methods WHERE user_id=$1", [invitedUserId]);
      await db.query("DELETE FROM tenant_memberships WHERE user_id=$1", [invitedUserId]);
      await db.query("DELETE FROM users WHERE id=$1", [invitedUserId]);
    }
    await db.query("DELETE FROM device_sessions WHERE device_id LIKE 'lifecycle-%'");
    await app.close();
  });

  it("creates and one-time accepts a scoped invitation", async () => {
    const created = await app.inject({ method: "POST", url: "/v1/users/invitations", headers: { authorization: `Bearer ${ownerToken}`, "x-tenant-id": tenantId }, payload: { email, displayName: "Lifecycle Manager", roles: ["BRANCH_MANAGER"], branchIds: [branchId] } });
    expect(created.statusCode).toBe(201);
    invitationToken = created.json().data.deliveryToken;
    const accepted = await app.inject({ method: "POST", url: "/v1/auth/invitations/accept", payload: { token: invitationToken, password: "Lifecycle passphrase 2026!" } });
    expect(accepted.statusCode).toBe(201);
    invitedUserId = accepted.json().data.userId;
    invitedMembershipId = accepted.json().data.membershipId;
    const reuse = await app.inject({ method: "POST", url: "/v1/auth/invitations/accept", payload: { token: invitationToken, password: "Lifecycle passphrase 2026!" } });
    expect(reuse.statusCode).toBe(409);
    expect(reuse.json().error.code).toBe("INVITATION_ALREADY_USED");
  });

  it("uses a neutral forgot response and consumes reset tokens once", async () => {
    const unknown = await app.inject({ method: "POST", url: "/v1/auth/forgot-password", payload: { identifier: "unknown.lifecycle@example.test" } });
    const known = await app.inject({ method: "POST", url: "/v1/auth/forgot-password", payload: { identifier: email } });
    expect(unknown.statusCode).toBe(202); expect(unknown.json().data.accepted).toBe(true);
    expect(known.statusCode).toBe(202); expect(known.json().data.accepted).toBe(true);
    const resetToken = known.json().data.deliveryToken;
    const reset = await app.inject({ method: "POST", url: "/v1/auth/reset-password", payload: { token: resetToken, password: "Updated lifecycle passphrase 2026!" } });
    expect(reset.statusCode).toBe(201);
    const reuse = await app.inject({ method: "POST", url: "/v1/auth/reset-password", payload: { token: resetToken, password: "Another lifecycle passphrase 2026!" } });
    expect(reuse.statusCode).toBe(409);
  });

  it("authenticates a verified E.164 phone with controlled OTP", async () => {
    const requested = await app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone: "090 123 4567", purpose: "LOGIN" } });
    expect(requested.statusCode).toBe(201);
    const verified = await app.inject({ method: "POST", url: "/v1/auth/otp/verify", payload: { challengeId: requested.json().data.challengeId, code: "123456", tenantSlug: "nailsoft-demo", deviceId: "lifecycle-otp", deviceName: "OTP Test", platform: "android" } });
    expect(verified.statusCode).toBe(201);
    expect(verified.json().data.tenantId).toBe(tenantId);
  });

  it("enforces Manager MFA after grace and issues a session only after TOTP", async () => {
    const db = app.get(DatabaseService);
    await db.query("UPDATE tenant_memberships SET joined_at=now()-interval '2 days' WHERE id=$1", [invitedMembershipId]);
    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { tenantSlug: "nailsoft-demo", email, password: "Updated lifecycle passphrase 2026!", deviceId: "lifecycle-manager", deviceName: "Lifecycle Manager", platform: "android" } });
    expect(login.json().data.authenticationState).toBe("MFA_ENROLLMENT_REQUIRED");
    mfaToken = login.json().data.mfaToken;
    expect(login.json().data.accessToken).toBeUndefined();
    const enrollment = await app.inject({ method: "POST", url: "/v1/auth/mfa/totp/enroll", payload: { mfaToken } });
    expect(enrollment.statusCode).toBe(201); mfaSecret = enrollment.json().data.secret;
    const confirmed = await app.inject({ method: "POST", url: "/v1/auth/mfa/totp/confirm", payload: { mfaToken, code: totp(mfaSecret) } });
    expect(confirmed.statusCode).toBe(201);
    expect(confirmed.json().data.accessToken).toBeTruthy();
    expect(confirmed.json().data.recoveryCodes).toHaveLength(10);
  });
});

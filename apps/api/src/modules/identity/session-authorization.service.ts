import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Role } from "@nailsoft/domain-types";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { TokenService } from "./token.service.js";

export type ActiveAuthorizationContext = {
  userId: string;
  tenantId: string;
  membershipId: string;
  sessionId: string;
  authorizationVersion: number;
  roles: Role[];
  branchIds: string[];
  ownStaffId?: string;
  accessTokenExpiresAt: string;
};

export interface SessionAuthorizationInput {
  accessToken: string;
  requiredTenantId?: string;
}

@Injectable()
export class SessionAuthorizationService {
  constructor(
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(DatabaseService) private readonly db: DatabaseService,
  ) {}

  async authorize(
    input: SessionAuthorizationInput,
  ): Promise<ActiveAuthorizationContext> {
    const claims = await this.tokens.verifyAccess(input.accessToken);
    if (input.requiredTenantId && input.requiredTenantId !== claims.tenantId)
      this.denied(
        "TENANT_CONTEXT_MISMATCH",
        "Tenant context does not match the authenticated session",
      );

    const session = (
      await this.db.query<{
        tenant_id: string;
        user_id: string;
        membership_id: string;
        revoked_at: Date | null;
        expires_at: Date;
      }>(
        "SELECT tenant_id,user_id,membership_id,revoked_at,expires_at FROM device_sessions WHERE id=$1",
        [claims.sessionId],
      )
    ).rows[0];
    if (
      !session ||
      session.revoked_at ||
      session.expires_at <= new Date() ||
      session.tenant_id !== claims.tenantId ||
      session.user_id !== claims.userId ||
      session.membership_id !== claims.membershipId
    )
      this.denied("SESSION_REVOKED", "Session is no longer active");

    const membership = (
      await this.db.query<{
        status: string;
        authorization_version: number;
        user_id: string;
        tenant_id: string;
      }>(
        "SELECT status,authorization_version,user_id,tenant_id FROM tenant_memberships WHERE id=$1",
        [claims.membershipId],
      )
    ).rows[0];
    if (
      !membership ||
      membership.status !== "ACTIVE" ||
      membership.user_id !== claims.userId ||
      membership.tenant_id !== claims.tenantId
    )
      this.denied("MEMBERSHIP_NOT_ACTIVE", "Membership is not active");
    if (membership.authorization_version !== claims.authorizationVersion)
      this.denied(
        "AUTHORIZATION_CHANGED",
        "Authorization has changed; reconnect with a new session",
      );

    const user = (
      await this.db.query<{ status: string }>(
        "SELECT status FROM users WHERE id=$1",
        [claims.userId],
      )
    ).rows[0];
    if (!user || user.status !== "ACTIVE")
      this.denied("USER_NOT_ACTIVE", "User is not active");

    const tenant = (
      await this.db.query<{ status: string }>(
        "SELECT status FROM tenants WHERE id=$1",
        [claims.tenantId],
      )
    ).rows[0];
    if (!tenant || tenant.status !== "ACTIVE")
      this.denied("TENANT_NOT_ACTIVE", "Tenant is not active");

    const [roleRows, branchRows, staffRows] = await Promise.all([
      this.db.query<{ role: Role }>(
        "SELECT role FROM membership_roles WHERE membership_id=$1 ORDER BY role",
        [claims.membershipId],
      ),
      this.db.query<{ branch_id: string }>(
        "SELECT branch_id FROM membership_branches WHERE membership_id=$1 AND tenant_id=$2 ORDER BY branch_id",
        [claims.membershipId, claims.tenantId],
      ),
      this.db.query<{ id: string }>(
        "SELECT id FROM staff_profiles WHERE tenant_id=$1 AND membership_id=$2 ORDER BY created_at LIMIT 1",
        [claims.tenantId, claims.membershipId],
      ),
    ]);
    const ownStaffId = staffRows.rows[0]?.id;
    return {
      userId: claims.userId,
      tenantId: claims.tenantId,
      membershipId: claims.membershipId,
      sessionId: claims.sessionId,
      authorizationVersion: membership.authorization_version,
      roles: roleRows.rows.map((row) => row.role),
      branchIds: branchRows.rows.map((row) => row.branch_id),
      ...(ownStaffId ? { ownStaffId } : {}),
      accessTokenExpiresAt:
        claims.accessTokenExpiresAt ?? new Date(Date.now() + 1).toISOString(),
    };
  }

  private denied(code: string, message: string): never {
    throw new UnauthorizedException({ code, message });
  }
}

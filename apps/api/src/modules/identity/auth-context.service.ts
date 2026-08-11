import { Inject, Injectable } from "@nestjs/common";
import type { AuthContext } from "@nailsoft/domain-types";
import { DatabaseService } from "../../infrastructure/database.service.js";
import type { AccessClaims } from "./auth.types.js";

@Injectable()
export class AuthContextService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async get(auth: AccessClaims): Promise<AuthContext> {
    const platformWithoutGrant = auth.roles.includes("PLATFORM_SUPER_ADMIN") && !auth.supportAccess;
    const [identity, workspace, permissionRows, capability] = await Promise.all([
      this.db.query<{ id: string; display_name: string; locale: "vi-VN" | "en-US" }>(
        'SELECT id,display_name,locale FROM users WHERE id=$1', [auth.userId],
      ),
      this.db.query<{ tenant_id: string; tenant_name: string; tenant_slug: string; membership_id: string; access_mode: string }>(
        `SELECT t.id tenant_id,t.name tenant_name,t.slug tenant_slug,tm.id membership_id,t.access_mode
         FROM tenant_memberships tm JOIN tenants t ON t.id=tm.tenant_id
         WHERE tm.id=$1 AND tm.tenant_id=$2`, [auth.membershipId, auth.tenantId],
      ),
      auth.supportAccess
        ? Promise.resolve({ rows: auth.supportAccess.permissions.map((permission_code) => ({ permission_code })) })
        : this.db.query<{ permission_code: string }>(
            `SELECT DISTINCT rp.permission_code FROM membership_roles mr
             JOIN role_permissions rp ON rp.role=mr.role
             WHERE mr.membership_id=$1 ORDER BY rp.permission_code`, [auth.membershipId],
          ),
      this.db.query<{ entitlement_code: string; enabled: boolean | null }>(
        `SELECT entitlement_code,enabled FROM platform_entitlement_projections
         WHERE tenant_id=$1 AND entitlement_code IN ('owner_mobile.enabled','staff_mobile.enabled')`,
        [auth.tenantId],
      ),
    ]);
    const user = identity.rows[0]!;
    const current = workspace.rows[0]!;
    const allowedBranchIds = platformWithoutGrant
      ? []
      : auth.supportAccess?.branchIds ?? auth.branchIds;
    const ownerHasTenantScope = auth.roles.includes("SALON_OWNER") && !auth.supportAccess;
    const branches = platformWithoutGrant
      ? []
      : (await this.db.query<{ id: string; name: string; status: string }>(
          `SELECT id,name,status FROM branches WHERE tenant_id=$1
           AND status<>'ARCHIVED' AND ($2::boolean OR id=ANY($3::uuid[])) ORDER BY name,id`,
          [auth.tenantId, ownerHasTenantScope, allowedBranchIds],
        )).rows;
    const effectiveBranchIds = ownerHasTenantScope ? branches.map((branch) => branch.id) : allowedBranchIds;
    return {
      user: { id: user.id, displayName: user.display_name, locale: user.locale },
      workspace: {
        tenantId: current.tenant_id,
        tenantName: platformWithoutGrant ? "Platform workspace" : current.tenant_name,
        tenantSlug: platformWithoutGrant ? "platform" : current.tenant_slug,
        membershipId: current.membership_id,
        accessMode: current.access_mode,
      },
      authorization: {
        roles: auth.roles,
        permissions: permissionRows.rows.map((row) => row.permission_code),
        branchIds: effectiveBranchIds,
        ...(auth.ownStaffId ? { ownStaffId: auth.ownStaffId } : {}),
      },
      branches,
      capabilities: {
        ownerMobileEnabled: !platformWithoutGrant && capability.rows.some((row) => row.entitlement_code === "owner_mobile.enabled" && row.enabled === true),
        staffMobileEnabled: !platformWithoutGrant && capability.rows.some((row) => row.entitlement_code === "staff_mobile.enabled" && row.enabled === true),
      },
      ...(auth.supportAccess ? { supportAccess: { grantId: auth.supportAccess.grantId, permissions: auth.supportAccess.permissions, branchIds: auth.supportAccess.branchIds } } : {}),
    };
  }
}

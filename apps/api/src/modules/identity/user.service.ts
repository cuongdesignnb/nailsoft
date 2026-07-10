import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DatabaseService } from "../../infrastructure/database.service.js";
import type { AccessClaims } from "./auth.types.js";
import { PasswordService } from "./password.service.js";
const createUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(160),
  password: z.string().min(10).max(128),
  locale: z.enum(["vi-VN", "en-US"]).default("vi-VN"),
  role: z.enum([
    "SALON_OWNER",
    "BRANCH_MANAGER",
    "RECEPTIONIST",
    "CASHIER",
    "NAIL_TECHNICIAN",
    "ACCOUNTANT",
    "MARKETING",
  ]),
  branchId: z.string().uuid().nullable(),
});
const updateAccessSchema = z.object({
  roles: z
    .array(
      z.enum([
        "SALON_OWNER",
        "BRANCH_MANAGER",
        "RECEPTIONIST",
        "CASHIER",
        "NAIL_TECHNICIAN",
        "ACCOUNTANT",
        "MARKETING",
      ]),
    )
    .min(1),
  branchIds: z.array(z.string().uuid()),
  status: z.enum(["ACTIVE", "SUSPENDED", "REVOKED"]),
});
@Injectable()
export class UserService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
  ) {}
  async list(auth: AccessClaims) {
    const owner = auth.roles.includes("SALON_OWNER");
    const result = await this.db.query(
      `SELECT u.id,tm.id "membershipId",u.email,u.display_name "displayName",u.locale,u.status,tm.status "membershipStatus",tm.authorization_version "authorizationVersion",coalesce((SELECT json_agg(json_build_object('role',mr.role)) FROM membership_roles mr WHERE mr.membership_id=tm.id),'[]') roles,coalesce((SELECT json_agg(mb.branch_id) FROM membership_branches mb WHERE mb.membership_id=tm.id),'[]') "branchIds" FROM tenant_memberships tm JOIN users u ON u.id=tm.user_id WHERE tm.tenant_id=$1 AND ($2 OR EXISTS(SELECT 1 FROM membership_branches mb WHERE mb.membership_id=tm.id AND mb.branch_id=ANY($3::uuid[]))) ORDER BY u.display_name`,
      [auth.tenantId, owner, auth.branchIds],
    );
    return result.rows;
  }
  async create(auth: AccessClaims, input: unknown, requestId: string) {
    const body = createUserSchema.parse(input);
    if (body.role !== "SALON_OWNER" && !body.branchId)
      throw new ConflictException({
        code: "BRANCH_REQUIRED",
        message: "A branch is required for this role",
      });
    return this.db.transaction(async (client) => {
      if (body.branchId) {
        const branch = await client.query(
          "SELECT 1 FROM branches WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, body.branchId],
        );
        if (branch.rowCount !== 1)
          throw new ConflictException({
            code: "INVALID_BRANCH",
            message: "Branch does not belong to the tenant",
          });
      }
      let user = (
        await client.query<{ id: string }>(
          "SELECT id FROM users WHERE lower(email)=lower($1)",
          [body.email],
        )
      ).rows[0];
      if (!user) {
        const id = randomUUID(),
          passwordHash = await this.passwords.hash(body.password);
        user = (
          await client.query<{ id: string }>(
            "INSERT INTO users(id,origin_tenant_id,email,display_name,password_hash,locale) VALUES($1,$2,lower($3),$4,$5,$6) RETURNING id",
            [
              id,
              auth.tenantId,
              body.email,
              body.displayName,
              passwordHash,
              body.locale,
            ],
          )
        ).rows[0]!;
      }
      const exists = await client.query(
        "SELECT 1 FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2",
        [auth.tenantId, user.id],
      );
      if (exists.rowCount)
        throw new ConflictException({
          code: "MEMBERSHIP_EXISTS",
          message: "User already belongs to this workspace",
        });
      const membershipId = randomUUID();
      await client.query(
        "INSERT INTO tenant_memberships(id,tenant_id,user_id,status,joined_at) VALUES($1,$2,$3,'ACTIVE',now())",
        [membershipId, auth.tenantId, user.id],
      );
      await client.query(
        "INSERT INTO membership_roles(membership_id,role) VALUES($1,$2)",
        [membershipId, body.role],
      );
      if (body.branchId)
        await client.query(
          "INSERT INTO membership_branches(membership_id,tenant_id,branch_id) VALUES($1,$2,$3)",
          [membershipId, auth.tenantId, body.branchId],
        );
      await client.query(
        "INSERT INTO audit_logs(tenant_id,branch_id,actor_user_id,action,entity_type,entity_id,after_json,request_id) VALUES($1,$2,$3,'membership.create','tenant_membership',$4,$5,$6)",
        [
          auth.tenantId,
          body.branchId,
          auth.userId,
          membershipId,
          JSON.stringify({
            userId: user.id,
            email: body.email,
            role: body.role,
          }),
          requestId,
        ],
      );
      return {
        id: user.id,
        membershipId,
        email: body.email,
        displayName: body.displayName,
        locale: body.locale,
        status: "ACTIVE",
        roles: [{ role: body.role }],
        branchIds: body.branchId ? [body.branchId] : [],
      };
    });
  }
  async sessions(auth: AccessClaims, membershipId: string) {
    await this.assertTargetScope(auth, membershipId);
    const result = await this.db.query(
      `SELECT id,device_id "deviceId",device_name "deviceName",platform,app_version "appVersion",ip_address "ipAddress",last_seen_at "lastSeenAt",expires_at "expiresAt",created_at "createdAt" FROM device_sessions WHERE tenant_id=$1 AND membership_id=$2 AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC`,
      [auth.tenantId, membershipId],
    );
    return result.rows;
  }
  async updateAccess(
    auth: AccessClaims,
    membershipId: string,
    input: unknown,
    requestId: string,
  ) {
    const body = updateAccessSchema.parse(input);
    const owner = auth.roles.includes("SALON_OWNER");
    if (!owner) {
      if (membershipId === auth.membershipId)
        throw new ForbiddenException({ code: "ROLE_ASSIGNMENT_DENIED", message: "Self elevation is not allowed" });
      await this.assertTargetScope(auth, membershipId);
      if (body.roles.some((role) => role === "SALON_OWNER" || role === "BRANCH_MANAGER"))
        throw new ForbiddenException({ code: "ROLE_ASSIGNMENT_DENIED", message: "A Manager cannot assign Owner or Manager" });
      if (body.branchIds.some((branchId) => !auth.branchIds.includes(branchId)))
        throw new ForbiddenException({ code: "BRANCH_ASSIGNMENT_DENIED", message: "A branch is outside Manager scope" });
    }
    return this.db.transaction(async (client) => {
      const target = await client.query<{ user_id: string; status: string }>(
        "SELECT user_id,status FROM tenant_memberships WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
        [membershipId, auth.tenantId],
      );
      if (!target.rows[0])
        throw new ForbiddenException({
          code: "TARGET_SCOPE_DENIED",
          message: "Target user is outside tenant scope",
        });
      for (const branchId of body.branchIds) {
        const branch = await client.query(
          "SELECT 1 FROM branches WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, branchId],
        );
        if (branch.rowCount !== 1)
          throw new ConflictException({
            code: "INVALID_BRANCH",
            message: "A branch belongs to another tenant",
          });
      }
      const oldRoles = await client.query<{ role: string }>(
        "SELECT role FROM membership_roles WHERE membership_id=$1",
        [membershipId],
      );
      if (
        oldRoles.rows.some((x) => x.role === "SALON_OWNER") &&
        !body.roles.includes("SALON_OWNER")
      ) {
        const owners = await client.query(
          "SELECT count(*)::int count FROM tenant_memberships tm JOIN membership_roles mr ON mr.membership_id=tm.id WHERE tm.tenant_id=$1 AND tm.status='ACTIVE' AND mr.role='SALON_OWNER'",
          [auth.tenantId],
        );
        if (owners.rows[0].count <= 1)
          throw new ConflictException({
            code: "LAST_OWNER_CANNOT_BE_REMOVED",
            message: "The final active owner cannot be removed",
          });
      }
      await client.query(
        "DELETE FROM membership_roles WHERE membership_id=$1",
        [membershipId],
      );
      for (const role of new Set(body.roles))
        await client.query(
          "INSERT INTO membership_roles(membership_id,role) VALUES($1,$2)",
          [membershipId, role],
        );
      await client.query(
        "DELETE FROM membership_branches WHERE membership_id=$1",
        [membershipId],
      );
      for (const branchId of new Set(body.branchIds))
        await client.query(
          "INSERT INTO membership_branches(membership_id,tenant_id,branch_id) VALUES($1,$2,$3)",
          [membershipId, auth.tenantId, branchId],
        );
      const updated = await client.query(
        "UPDATE tenant_memberships SET status=$3,authorization_version=authorization_version+1,updated_at=now(),suspended_at=CASE WHEN $3='SUSPENDED' THEN now() ELSE suspended_at END,revoked_at=CASE WHEN $3='REVOKED' THEN now() ELSE revoked_at END WHERE id=$1 AND tenant_id=$2 RETURNING authorization_version \"authorizationVersion\",status",
        [membershipId, auth.tenantId, body.status],
      );
      await client.query(
        "UPDATE device_sessions SET revoked_at=coalesce(revoked_at,now()),revoke_reason='authorization_changed' WHERE membership_id=$1",
        [membershipId],
      );
      await client.query(
        "INSERT INTO audit_logs(tenant_id,actor_user_id,action,entity_type,entity_id,before_json,after_json,request_id) VALUES($1,$2,'membership.access.update','tenant_membership',$3,$4,$5,$6)",
        [
          auth.tenantId,
          auth.userId,
          membershipId,
          JSON.stringify({
            roles: oldRoles.rows.map((x) => x.role),
            status: target.rows[0].status,
          }),
          JSON.stringify(body),
          requestId,
        ],
      );
      return {
        membershipId,
        ...updated.rows[0],
        roles: body.roles,
        branchIds: body.branchIds,
      };
    });
  }
  async revokeSession(
    auth: AccessClaims,
    membershipId: string,
    sessionId: string,
    requestId: string,
  ) {
    const target = await this.assertTargetScope(auth, membershipId);
    const result = await this.db.query(
      "UPDATE device_sessions SET revoked_at=coalesce(revoked_at,now()),revoke_reason='admin_revoked' WHERE id=$1 AND tenant_id=$2 AND membership_id=$3",
      [sessionId, auth.tenantId, membershipId],
    );
    if (result.rowCount !== 1)
      throw new ConflictException({
        code: "SESSION_NOT_FOUND",
        message: "Session not found",
      });
    await this.db.query(
      "INSERT INTO audit_logs(tenant_id,actor_user_id,action,entity_type,entity_id,after_json,request_id) VALUES($1,$2,'session.admin_revoke','device_session',$3,$4,$5)",
      [
        auth.tenantId,
        auth.userId,
        sessionId,
        JSON.stringify({
          targetUserId: target.userId,
          targetMembershipId: membershipId,
        }),
        requestId,
      ],
    );
  }
  async revokeAllSessions(
    auth: AccessClaims,
    membershipId: string,
    requestId: string,
  ) {
    const target = await this.assertTargetScope(auth, membershipId);
    const result = await this.db.query(
      "UPDATE device_sessions SET revoked_at=coalesce(revoked_at,now()),revoke_reason='admin_revoked_all' WHERE tenant_id=$1 AND membership_id=$2 AND revoked_at IS NULL",
      [auth.tenantId, membershipId],
    );
    await this.db.query(
      "INSERT INTO audit_logs(tenant_id,actor_user_id,action,entity_type,entity_id,after_json,request_id) VALUES($1,$2,'session.admin_revoke_all','tenant_membership',$3,$4,$5)",
      [
        auth.tenantId,
        auth.userId,
        membershipId,
        JSON.stringify({
          targetUserId: target.userId,
          revokedCount: result.rowCount,
        }),
        requestId,
      ],
    );
    return { revokedCount: result.rowCount };
  }
  private async assertTargetScope(auth: AccessClaims, membershipId: string) {
    const result = await this.db.query<{
      user_id: string;
      roles: string[];
      branches: string[];
    }>(
      `SELECT tm.user_id,coalesce((SELECT array_agg(role) FROM membership_roles WHERE membership_id=tm.id),'{}') roles,coalesce((SELECT array_agg(branch_id::text) FROM membership_branches WHERE membership_id=tm.id),'{}') branches FROM tenant_memberships tm WHERE (tm.id=$1 OR tm.user_id=$1) AND tm.tenant_id=$2`,
      [membershipId, auth.tenantId],
    );
    const target = result.rows[0];
    if (!target)
      throw new ForbiddenException({
        code: "TARGET_SCOPE_DENIED",
        message: "Target user is outside tenant scope",
      });
    if (auth.roles.includes("SALON_OWNER")) return { userId: target.user_id };
    if (
      !auth.roles.includes("BRANCH_MANAGER") ||
      target.roles.includes("SALON_OWNER") ||
      target.branches.length === 0 ||
      !target.branches.some((branch) => auth.branchIds.includes(branch))
    )
      throw new ForbiddenException({
        code: "TARGET_SCOPE_DENIED",
        message: "Target user is outside branch scope",
      });
    return { userId: target.user_id };
  }
}

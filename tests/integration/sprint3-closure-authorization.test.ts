import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "../../apps/api/src/infrastructure/database.service.js";
import { TokenService } from "../../apps/api/src/modules/identity/token.service.js";
import { SessionAuthorizationService } from "../../apps/api/src/modules/identity/session-authorization.service.js";

const tenantId = "10000000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000001";
const userId = randomUUID();
const membershipId = randomUUID();
const sessionId = randomUUID();
const db = new DatabaseService();
const tokens = new TokenService();
const authorization = new SessionAuthorizationService(tokens, db);
let accessToken = "";

describe("Sprint 3 closure shared active-session authorization", () => {
  beforeAll(async () => {
    await db.query(
      "INSERT INTO users(id,origin_tenant_id,email,display_name,status) VALUES($1,$2,$3,'Closure Auth','ACTIVE')",
      [userId, tenantId, `closure-${userId}@example.test`],
    );
    await db.query(
      "INSERT INTO tenant_memberships(id,tenant_id,user_id,status,authorization_version) VALUES($1,$2,$3,'ACTIVE',1)",
      [membershipId, tenantId, userId],
    );
    await db.query(
      "INSERT INTO membership_roles(membership_id,role) VALUES($1,'RECEPTIONIST')",
      [membershipId],
    );
    await db.query(
      "INSERT INTO membership_branches(membership_id,tenant_id,branch_id) VALUES($1,$2,$3)",
      [membershipId, tenantId, branchId],
    );
    await db.query(
      "INSERT INTO device_sessions(id,tenant_id,user_id,membership_id,family_id,refresh_token_hash,device_id,device_name,platform,expires_at) VALUES($1,$2,$3,$4,$5,$6,'closure-auth','Closure Auth','web',now()+interval '1 day')",
      [sessionId, tenantId, userId, membershipId, randomUUID(), randomUUID()],
    );
    accessToken = await tokens.access({
      userId,
      tenantId,
      membershipId,
      sessionId,
      authorizationVersion: 1,
      roles: ["SALON_OWNER"],
      branchIds: [],
    });
  });

  afterAll(async () => {
    await db.query("DELETE FROM device_sessions WHERE id=$1", [sessionId]);
    await db.query("DELETE FROM membership_branches WHERE membership_id=$1", [
      membershipId,
    ]);
    await db.query("DELETE FROM membership_roles WHERE membership_id=$1", [
      membershipId,
    ]);
    await db.query("DELETE FROM tenant_memberships WHERE id=$1", [membershipId]);
    await db.query("DELETE FROM users WHERE id=$1", [userId]);
    await db.onModuleDestroy();
  });

  it("reloads roles and branches from PostgreSQL rather than JWT scope", async () => {
    const active = await authorization.authorize({ accessToken });
    expect(active.roles).toEqual(["RECEPTIONIST"]);
    expect(active.branchIds).toEqual([branchId]);
  });

  it("rejects tenant mismatch consistently", async () => {
    await expect(
      authorization.authorize({
        accessToken,
        requiredTenantId: randomUUID(),
      }),
    ).rejects.toMatchObject({ response: { code: "TENANT_CONTEXT_MISMATCH" } });
  });

  it("rejects revoked and expired sessions", async () => {
    await db.query("UPDATE device_sessions SET revoked_at=now() WHERE id=$1", [
      sessionId,
    ]);
    await expect(
      authorization.authorize({ accessToken }),
    ).rejects.toMatchObject({ response: { code: "SESSION_REVOKED" } });
    await db.query(
      "UPDATE device_sessions SET revoked_at=NULL,expires_at=now()-interval '1 second' WHERE id=$1",
      [sessionId],
    );
    await expect(
      authorization.authorize({ accessToken }),
    ).rejects.toMatchObject({ response: { code: "SESSION_REVOKED" } });
    await db.query(
      "UPDATE device_sessions SET expires_at=now()+interval '1 day' WHERE id=$1",
      [sessionId],
    );
  });

  it("rejects changed authorization, suspended membership and user", async () => {
    await db.query(
      "UPDATE tenant_memberships SET authorization_version=2 WHERE id=$1",
      [membershipId],
    );
    await expect(
      authorization.authorize({ accessToken }),
    ).rejects.toMatchObject({ response: { code: "AUTHORIZATION_CHANGED" } });
    await db.query(
      "UPDATE tenant_memberships SET authorization_version=1,status='SUSPENDED' WHERE id=$1",
      [membershipId],
    );
    await expect(
      authorization.authorize({ accessToken }),
    ).rejects.toMatchObject({ response: { code: "MEMBERSHIP_NOT_ACTIVE" } });
    await db.query("UPDATE tenant_memberships SET status='ACTIVE' WHERE id=$1", [
      membershipId,
    ]);
    await db.query("UPDATE users SET status='SUSPENDED' WHERE id=$1", [userId]);
    await expect(
      authorization.authorize({ accessToken }),
    ).rejects.toMatchObject({ response: { code: "USER_NOT_ACTIVE" } });
    await db.query("UPDATE users SET status='ACTIVE' WHERE id=$1", [userId]);
  });
});

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft" });

describe("Sprint 1 identity lifecycle schema", () => {
  beforeAll(async () => client.connect());
  afterAll(async () => client.end());

  it("applies the immutable 0004 migration with durable recovery and MFA state", async () => {
    const result = await client.query(`SELECT
      to_regclass('invitations') invitations,
      to_regclass('password_reset_tokens') resets,
      to_regclass('phone_verification_challenges') otp,
      to_regclass('mfa_methods') mfa,
      to_regclass('mfa_challenges') challenges,
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='phone_e164') phone_e164`);
    expect(result.rows[0]).toEqual({ invitations: "invitations", resets: "password_reset_tokens", otp: "phone_verification_challenges", mfa: "mfa_methods", challenges: "mfa_challenges", phone_e164: true });
  });

  it("rejects invitation branch assignment across tenants", async () => {
    await client.query("BEGIN");
    try {
      const tenant = (await client.query("INSERT INTO tenants(name,slug) VALUES('Isolation','identity-isolation') RETURNING id")).rows[0].id;
      const invitation = (await client.query(`INSERT INTO invitations(tenant_id,email_normalized,display_name,token_hash,expires_at,invited_by_user_id)
        VALUES($1,'isolation@example.test','Isolation','integration-hash',now()+interval '1 hour','30000000-0000-4000-8000-000000000001') RETURNING id`, [tenant])).rows[0].id;
      await expect(client.query("INSERT INTO invitation_branches(invitation_id,tenant_id,branch_id) VALUES($1,$2,'20000000-0000-4000-8000-000000000001')", [invitation, tenant])).rejects.toMatchObject({ code: "23503" });
    } finally { await client.query("ROLLBACK"); }
  });

  it("stores only token hashes and enforces one-time consumption state", async () => {
    await client.query("BEGIN");
    try {
      const reset = await client.query(`INSERT INTO password_reset_tokens(user_id,token_hash,expires_at)
        VALUES('30000000-0000-4000-8000-000000000001','one-time-hash',now()+interval '5 minutes') RETURNING token_hash,consumed_at`);
      expect(reset.rows[0]).toEqual({ token_hash: "one-time-hash", consumed_at: null });
      const first = await client.query("UPDATE password_reset_tokens SET consumed_at=now() WHERE token_hash='one-time-hash' AND consumed_at IS NULL");
      const second = await client.query("UPDATE password_reset_tokens SET consumed_at=now() WHERE token_hash='one-time-hash' AND consumed_at IS NULL");
      expect(first.rowCount).toBe(1);
      expect(second.rowCount).toBe(0);
    } finally { await client.query("ROLLBACK"); }
  });
});

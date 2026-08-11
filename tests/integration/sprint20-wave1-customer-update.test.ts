import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiApp, command, login, pool, tenant } from "./sprint12-closure-helpers";

const customerId = "60000000-0000-4000-8000-000000000101";
const duplicateCustomerId = "60000000-0000-4000-8000-000000000102";
const crossTenantId = "60000000-0000-4000-8000-000000000199";
const crossTenantTenant = "10000000-0000-4000-8000-000000000199";
const crossTenantSlug = `s20-customer-update-${Date.now()}`;
const db = pool();
let app: Awaited<ReturnType<typeof apiApp>>;

describe("Sprint 20 Wave 1 customer update contract", () => {
  beforeAll(async () => {
    app = await apiApp();
    await db.query(
      `INSERT INTO customers(id,tenant_id,display_name,phone_normalized,email_normalized,preferred_locale,is_guest)
       VALUES
         ($1,$3,'Wave 1 customer','+84907000001','wave1-customer@example.test','vi-VN',false),
         ($2,$3,'Wave 1 duplicate candidate','+84907000002','wave1-duplicate@example.test','en-US',false)
       ON CONFLICT (id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id,display_name=EXCLUDED.display_name,
         phone_normalized=EXCLUDED.phone_normalized,email_normalized=EXCLUDED.email_normalized,
         preferred_locale=EXCLUDED.preferred_locale,status='ACTIVE',version=1,contact_verification_version=1`,
      [customerId, duplicateCustomerId, tenant],
    );
    await db.query(
      `INSERT INTO tenants(id,name,slug) VALUES($1,'Wave 1 cross tenant',$2)
       ON CONFLICT (id) DO NOTHING`,
      [crossTenantTenant, crossTenantSlug],
    );
    await db.query(
      `INSERT INTO customers(id,tenant_id,display_name,phone_normalized,email_normalized,preferred_locale,is_guest)
       VALUES($1,$2,'Cross tenant customer','+84907000199','cross-wave1@example.test','en-US',false)
       ON CONFLICT (id) DO NOTHING`,
      [crossTenantId, crossTenantTenant],
    );
  });

  afterAll(async () => {
    await db.query("DELETE FROM outbox_events WHERE aggregate_id = ANY($1::uuid[])", [[customerId, duplicateCustomerId]]);
    await db.query("DELETE FROM audit_logs WHERE entity_id = ANY($1::uuid[])", [[customerId, duplicateCustomerId]]);
    await db.query("DELETE FROM idempotency_keys WHERE tenant_id=$1", [tenant]);
    await db.query("DELETE FROM customers WHERE id = ANY($1::uuid[])", [[customerId, duplicateCustomerId]]);
    await db.query("DELETE FROM customers WHERE tenant_id=$1", [crossTenantTenant]);
    await db.query("DELETE FROM tenants WHERE id=$1", [crossTenantTenant]);
    await app.close();
    await db.end();
  });

  it("updates allowed fields with versioning, contact verification and safe audit evidence", async () => {
    const owner = await login(app, "owner@example.test");
    const key = "s20-customer-update-0001";
    const response = await app.inject({
      method: "PATCH",
      url: `/v1/customers/${customerId}`,
      headers: command(owner, key),
      payload: {
        version: 1,
        displayName: "Updated Wave 1 customer",
        phone: "0907000003",
        email: "updated-wave1@example.test",
        preferredLocale: "en-US",
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data).toMatchObject({
      id: customerId,
      displayName: "Updated Wave 1 customer",
      phone: "+84907000003",
      email: "updated-wave1@example.test",
      locale: "en-US",
      version: 2,
      idempotencyReplayed: false,
    });

    const row = await db.query(
      "SELECT contact_verification_version FROM customers WHERE id=$1",
      [customerId],
    );
    expect(row.rows[0].contact_verification_version).toBe(2);

    const audit = await db.query(
      "SELECT before_json,after_json,request_id FROM audit_logs WHERE entity_id=$1 AND action='customer.updated'",
      [customerId],
    );
    expect(audit.rowCount).toBe(1);
    const auditText = JSON.stringify(audit.rows[0]);
    expect(auditText).toContain("phoneFingerprint");
    expect(auditText).not.toContain("0907000003");
    expect(auditText).not.toContain("updated-wave1@example.test");

    const event = await db.query(
      "SELECT payload_json FROM outbox_events WHERE aggregate_id=$1 AND event_type='customer.updated'",
      [customerId],
    );
    expect(event.rowCount).toBe(1);
    expect(JSON.stringify(event.rows[0])).not.toContain("updated-wave1@example.test");
  });

  it("replays the same intent once and rejects stale or reused keys", async () => {
    const owner = await login(app, "owner@example.test");
    const key = "s20-customer-update-0002";
    const payload = { version: 2, displayName: "Replay-safe name" };
    const first = await app.inject({ method: "PATCH", url: `/v1/customers/${customerId}`, headers: command(owner, key), payload });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().data.version).toBe(3);
    const replay = await app.inject({ method: "PATCH", url: `/v1/customers/${customerId}`, headers: command(owner, key), payload });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().data).toMatchObject({ version: 3, idempotencyReplayed: true });
    const displayOnly = await app.inject({
      method: "PATCH",
      url: `/v1/customers/${customerId}`,
      headers: command(owner, "s20-customer-update-0008"),
      payload: { version: 3, displayName: "Display-only update" },
    });
    expect(displayOnly.statusCode, displayOnly.body).toBe(200);
    expect(displayOnly.json().data.version).toBe(4);
    const unchangedContactVersion = await db.query(
      "SELECT contact_verification_version FROM customers WHERE id=$1",
      [customerId],
    );
    expect(unchangedContactVersion.rows[0].contact_verification_version).toBe(2);
    const reused = await app.inject({ method: "PATCH", url: `/v1/customers/${customerId}`, headers: command(owner, key), payload: { version: 2, displayName: "Different intent" } });
    expect(reused.statusCode, reused.body).toBe(409);
    expect(reused.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");

    const stale = await app.inject({ method: "PATCH", url: `/v1/customers/${customerId}`, headers: command(owner, "s20-customer-update-0003"), payload: { version: 3, preferredLocale: "vi-VN" } });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json().error.code).toBe("VERSION_CONFLICT");
  });

  it("rejects duplicate contacts, strict fields, unauthorized actors and cross-tenant IDs", async () => {
    const owner = await login(app, "owner@example.test");
    const duplicate = await app.inject({
      method: "PATCH",
      url: `/v1/customers/${duplicateCustomerId}`,
      headers: command(owner, "s20-customer-update-0004"),
      payload: { version: 1, phone: "+84907000003" },
    });
    expect(duplicate.statusCode, duplicate.body).toBe(409);
    expect(duplicate.json().error.code).toBe("CUSTOMER_DUPLICATE_CONFLICT");

    const unknown = await app.inject({
      method: "PATCH",
      url: `/v1/customers/${duplicateCustomerId}`,
      headers: command(owner, "s20-customer-update-0005"),
      payload: { version: 1, internalNote: "must be rejected" },
    });
    expect(unknown.statusCode, unknown.body).toBe(400);

    const missingKey = await app.inject({
      method: "PATCH",
      url: `/v1/customers/${duplicateCustomerId}`,
      headers: owner,
      payload: { version: 1, displayName: "Missing key" },
    });
    expect(missingKey.statusCode, missingKey.body).toBe(409);
    expect(missingKey.json().error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");

    const technician = await login(app, "staff5@example.test");
    const forbidden = await app.inject({
      method: "PATCH",
      url: `/v1/customers/${duplicateCustomerId}`,
      headers: command(technician, "s20-customer-update-0006"),
      payload: { version: 1, displayName: "No access" },
    });
    expect(forbidden.statusCode, forbidden.body).toBe(403);

    const crossTenant = await app.inject({
      method: "PATCH",
      url: `/v1/customers/${crossTenantId}`,
      headers: command(owner, "s20-customer-update-0007"),
      payload: { version: 1, displayName: "No cross tenant" },
    });
    expect(crossTenant.statusCode, crossTenant.body).toBe(404);
    expect(crossTenant.json().error.code).toBe("CUSTOMER_NOT_FOUND");
  });
});

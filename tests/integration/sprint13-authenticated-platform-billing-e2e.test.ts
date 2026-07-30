import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiApp,
  command,
  login,
  pool,
  tenant,
} from "./sprint12-closure-helpers";

const db = pool();
let app: Awaited<ReturnType<typeof apiApp>>;
describe("Sprint 13 authenticated tenant and platform billing E2E", () => {
  beforeAll(async () => {
    app = await apiApp();
  });
  afterAll(async () => {
    await app.close();
    await db.end();
  });
  it("keeps legacy tenant active, fully entitled and free", async () => {
    const owner = await login(app, "owner@example.test"),
      response = await app.inject({
        method: "GET",
        url: "/v1/tenant/billing/subscription",
        headers: owner,
      });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data).toMatchObject({
      status: "ACTIVE",
      collectionMode: "DISABLED",
      planCode: "LEGACY_INTERNAL",
    });
    const entitlements = await app.inject({
      method: "GET",
      url: "/v1/tenant/billing/entitlements",
      headers: owner,
    });
    expect(entitlements.statusCode).toBe(200);
    expect(entitlements.json().data).toHaveLength(20);
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM platform_invoices WHERE tenant_id=$1",
          [tenant],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("separates tenant Owner from platform administration and platform from salon data", async () => {
    const owner = await login(app, "owner@example.test"),
      platform = await login(app, "platform-e2e@example.test");
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/platform/plans",
          headers: owner,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/platform/plans",
          headers: platform,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/appointments",
          headers: platform,
        })
      ).statusCode,
    ).toBe(403);
  });
  it("converts explicit Owner trial without auto charging and changes plan with exact proration", async () => {
    const owner = await login(app, "owner@example.test"),
      trial = await app.inject({
        method: "POST",
        url: "/v1/tenant/billing/subscription/start-trial",
        headers: command(owner, "s13-owner-start-trial"),
        payload: {
          planId: "13000000-0000-4000-8000-000000000011",
          trialDays: 14,
          collectionMode: "MANUAL_INVOICE",
        },
      });
    expect(trial.statusCode, trial.body).toBe(201);
    expect(trial.json().data.status).toBe("TRIALING");
    const current = trial.json().data,
      change = await app.inject({
        method: "POST",
        url: "/v1/tenant/billing/subscription/change-plan",
        headers: command(owner, "s13-owner-upgrade-plan"),
        payload: {
          planId: "13000000-0000-4000-8000-000000000012",
          version: current.version,
          effectiveMode: "IMMEDIATE",
          changeType: "UPGRADE",
        },
      });
    expect(change.statusCode, change.body).toBe(201);
    expect(BigInt(change.json().data.prorationMinor)).toBeGreaterThan(0n);
    expect(
      (
        await db.query(
          "SELECT status FROM platform_subscriptions WHERE id=$1",
          [current.id],
        )
      ).rows[0].status,
    ).toBe("ACTIVE");
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM platform_subscription_history WHERE subscription_id=$1 AND from_status='TRIALING' AND to_status='ACTIVE'",
          [current.id],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM platform_invoices WHERE tenant_id=$1",
          [tenant],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("requires independent platform approval and unique evidence for manual payment", async () => {
    const platform = await login(app, "platform-e2e@example.test"),
      url =
        "/v1/platform/invoices/13000000-0000-4000-8000-000000000952/manual-payments",
      payload = {
        tenantId: "13000000-0000-4000-8000-000000000902",
        amountMinor: "9900",
        currency: "USD",
        evidenceReference: "WIRE-QA-S13-0001",
        reason: "Deterministic independent evidence",
      };
    const selfApproval = await app.inject({
      method: "POST",
      url,
      headers: command(platform, "s13-manual-payment-self"),
      payload: {
        ...payload,
        approvedByUserId: "30000000-0000-4000-8000-000000000015",
      },
    });
    expect(selfApproval.statusCode, selfApproval.body).toBe(403);
    const approved = await app.inject({
      method: "POST",
      url,
      headers: command(platform, "s13-manual-payment-approved"),
      payload: {
        ...payload,
        approvedByUserId: "30000000-0000-4000-8000-000000000018",
      },
    });
    expect(approved.statusCode, approved.body).toBe(201);
    expect(
      (
        await db.query(
          "SELECT status FROM platform_invoices WHERE id='13000000-0000-4000-8000-000000000952'",
        )
      ).rows[0].status,
    ).toBe("PAID");
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM platform_payment_intents WHERE evidence_hash IS NOT NULL AND provider='MANUAL'",
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("requires tenant approval, binds support token and revokes server-side", async () => {
    const owner = await login(app, "owner@example.test"),
      platform = await login(app, "platform-e2e@example.test"),
      supportUser = "30000000-0000-4000-8000-000000000015";
    const request = await app.inject({
      method: "POST",
      url: "/v1/platform/support-access-grants",
      headers: command(platform, "s13-support-request"),
      payload: {
        tenantId: tenant,
        supportUserId: supportUser,
        ticketReference: "SUP-1301",
        reason: "Investigate approved booking issue",
        permissionScope: ["appointment.read"],
        branchScope: ["20000000-0000-4000-8000-000000000001"],
        dataClassificationScope: ["OPERATIONAL"],
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        sessionTtlSeconds: 600,
      },
    });
    expect(request.statusCode, request.body).toBe(201);
    const grant = request.json().data;
    const approve = await app.inject({
      method: "POST",
      url: `/v1/tenant/support-access-grants/${grant.id}/approve`,
      headers: command(owner, "s13-support-approve"),
      payload: { reason: "Tenant approved ticket" },
    });
    expect(approve.statusCode, approve.body).toBe(201);
    expect(approve.json().data.state).toBe("APPROVED");
    const session = await app.inject({
      method: "POST",
      url: `/v1/platform/support-access-grants/${grant.id}/start-session`,
      headers: command(platform, "s13-support-start"),
      payload: {},
    });
    expect(session.statusCode, session.body).toBe(201);
    expect(session.json().data.sessionToken).toBeTruthy();
    expect(
      (
        await db.query(
          "SELECT token_hash FROM platform_support_sessions WHERE id=$1",
          [session.json().data.id],
        )
      ).rows[0].token_hash,
    ).not.toBe(session.json().data.sessionToken);
    const supportHeaders = {
      ...platform,
      "x-support-session-token": session.json().data.sessionToken,
    };
    const scopedRead = await app.inject({
      method: "GET",
      url: "/v1/appointments?branchId=20000000-0000-4000-8000-000000000001",
      headers: supportHeaders,
    });
    expect(scopedRead.statusCode, scopedRead.body).toBe(200);
    const revoke = await app.inject({
      method: "POST",
      url: `/v1/tenant/support-access-grants/${grant.id}/revoke`,
      headers: command(owner, "s13-support-revoke"),
      payload: { reason: "Issue resolved" },
    });
    expect(revoke.statusCode, revoke.body).toBe(201);
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM platform_support_sessions WHERE grant_id=$1 AND state='ACTIVE'",
          [grant.id],
        )
      ).rows[0].n,
    ).toBe(0);
    const revokedRead = await app.inject({
      method: "GET",
      url: "/v1/appointments",
      headers: supportHeaders,
    });
    expect(revokedRead.statusCode, revokedRead.body).toBe(403);
  });
});

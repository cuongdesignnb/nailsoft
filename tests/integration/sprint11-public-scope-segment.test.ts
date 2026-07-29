import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../apps/api/src/infrastructure/database.service";
import { BookingIdempotencyService } from "../../apps/api/src/modules/booking/booking-idempotency.service";
import { CommunicationService } from "../../apps/api/src/modules/engagement/communication.service";
import { PublicEngagementController } from "../../apps/api/src/modules/engagement/engagement.controller";
import { signPublicToken } from "../../apps/api/src/modules/engagement/engagement-domain";
import { MarketingService } from "../../apps/api/src/modules/engagement/marketing.service";

const url = process.env.DATABASE_URL ?? "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft";
const tenant = "10000000-0000-4000-8000-000000000001";
const branch = "20000000-0000-4000-8000-000000000001";
const otherBranch = "20000000-0000-4000-8000-000000000002";
const customer = "60000000-0000-4000-8000-000000000001";
const owner = {
  tenantId: tenant,
  userId: "30000000-0000-4000-8000-000000000001",
  membershipId: "owner",
  authorizationVersion: 1,
  sessionId: "closure",
  roles: ["SALON_OWNER"] as any,
  branchIds: [branch],
};
const manager = {
  ...owner,
  userId: "30000000-0000-4000-8000-000000000004",
  membershipId: "manager",
  roles: ["BRANCH_MANAGER"] as any,
};

describe.sequential("Sprint 11 public unsubscribe, branch scope and segment contract", () => {
  const pool = new pg.Pool({ connectionString: url });
  const db = new DatabaseService();
  const communications = new CommunicationService(db, new BookingIdempotencyService());
  const marketing = new MarketingService(communications);
  const publicController = new PublicEngagementController(communications, null as any);
  afterAll(async () => {
    await db.onModuleDestroy();
    await pool.end();
  });

  it("persists valid unsubscribe without Idempotency-Key and replays duplicate clicks", async () => {
    process.env.COMMUNICATION_TOKEN_SECRET = "closure-public-token-secret";
    const token = signPublicToken(
      { tenantId: tenant, customerId: customer, purpose: "MARKETING_EMAIL", exp: Math.floor(Date.now() / 1000) + 3600 },
      process.env.COMMUNICATION_TOKEN_SECRET,
    );
    await publicController.unsubscribe({ token });
    await publicController.unsubscribe({ token });
    const state = (await pool.query("SELECT state FROM customer_consent_states WHERE tenant_id=$1 AND customer_id=$2 AND purpose='MARKETING_EMAIL'", [tenant, customer])).rows[0];
    const evidence = (await pool.query("SELECT count(*)::int n FROM customer_consent_events WHERE tenant_id=$1 AND customer_id=$2 AND purpose='MARKETING_EMAIL' AND source='UNSUBSCRIBE_LINK'", [tenant, customer])).rows[0].n;
    expect(state.state).toBe("WITHDRAWN");
    expect(evidence).toBe(1);
  });

  it("returns generic success for invalid or wrong-purpose tokens without mutation", async () => {
    const before = (await pool.query("SELECT count(*)::int n FROM customer_consent_events WHERE tenant_id=$1", [tenant])).rows[0].n;
    expect((await publicController.unsubscribe({ token: "invalid" })).data).toEqual({ accepted: true });
    const wrong = signPublicToken(
      { tenantId: tenant, customerId: customer, purpose: "REVIEW_REQUEST", exp: Math.floor(Date.now() / 1000) + 3600 },
      process.env.COMMUNICATION_TOKEN_SECRET!,
    );
    expect((await publicController.unsubscribe({ token: wrong })).data).toEqual({ accepted: true });
    const after = (await pool.query("SELECT count(*)::int n FROM customer_consent_events WHERE tenant_id=$1", [tenant])).rows[0].n;
    expect(after).toBe(before);
  });

  it("denies tenant-wide segments to Manager and hides Owner global objects", async () => {
    expect(() =>
      marketing.createSegment(manager, { name: "Manager global", filters: { marketingConsent: true } }, "manager-global-key-0001", "closure"),
    ).toThrow("Tenant-wide marketing objects require Salon Owner");
    const global = await marketing.createSegment(owner, { name: "Owner global closure", filters: { marketingConsent: true } }, "owner-global-key-000001", "closure");
    expect(global.branch_id).toBeNull();
    expect((await marketing.segments(manager)).map((x: any) => x.id)).not.toContain(global.id);
  });

  it("rejects every advertised filter that has no SQL semantics", async () => {
    expect(() =>
      marketing.createSegment(owner, { branchId: branch, name: "Unsupported filter closure", filters: { serviceId: "90000000-0000-4000-8000-000000000001" } }, "unsupported-filter-key-1", "closure"),
    ).toThrow("Command conflicts with current state");
    const supported = await marketing.createSegment(owner, { branchId: branch, name: "Supported filter closure", filters: { branchVisited: branch, locale: "vi-VN", contactable: true, marketingConsent: true } }, "supported-filter-key-001", "closure");
    const preview = await marketing.previewSegment(owner, supported.id);
    expect(preview.count).toBeGreaterThanOrEqual(0);
    expect(() =>
      marketing.createSegment(
        manager,
        { branchId: branch, name: "Cross-branch filter closure", filters: { branchVisited: otherBranch } },
        "cross-branch-filter-key-1",
        "closure",
      ),
    ).toThrow("Branch is outside membership scope");
  });
});

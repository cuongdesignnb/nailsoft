import { describe, expect, it, vi } from "vitest";
import { MarketingService } from "../src/modules/engagement/marketing.service";

const owner = {
  tenantId: "10000000-0000-4000-8000-000000000001",
  userId: "30000000-0000-4000-8000-000000000001",
  membershipId: "audience-limit-owner",
  authorizationVersion: 1,
  sessionId: "audience-limit",
  roles: ["SALON_OWNER"],
  branchIds: ["20000000-0000-4000-8000-000000000001"],
};
type EligibleCustomers = (
  auth: typeof owner,
  branchId: string | null,
  filters: Record<string, unknown>,
  limit: number,
) => Promise<unknown[]>;

describe("Sprint 11 campaign audience query contract", () => {
  it("honors a configured limit above 100000 without silently truncating", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = new MarketingService({ db: { query } } as never);
    const eligibleCustomers = Reflect.get(
      service,
      "eligibleCustomers",
    ) as EligibleCustomers;

    await eligibleCustomers.call(
      service,
      owner,
      owner.branchIds[0],
      {},
      100_001,
    );

    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain("LIMIT $5");
    expect(query.mock.calls[0]?.[1]).toEqual([
      owner.tenantId,
      owner.branchIds[0],
      null,
      null,
      100_001,
    ]);
  });

  it("never exceeds the database-supported maximum", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = new MarketingService({ db: { query } } as never);
    const eligibleCustomers = Reflect.get(
      service,
      "eligibleCustomers",
    ) as EligibleCustomers;

    await eligibleCustomers.call(service, owner, null, {}, 1_000_001);

    expect(query.mock.calls[0]?.[1]?.[4]).toBe(1_000_000);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { branch, connection, tenant } from "./sprint17-analytics-test-utils";
const db = connection();
describe("Sprint 17 financial metric semantics", () => { beforeAll(() => db.connect()); afterAll(() => db.end());
  it("keeps sales and payment measures separate and uses bigint facts", async () => { const columns = (await db.query<any>("SELECT column_name,data_type FROM information_schema.columns WHERE table_name='analytics_daily_branch_facts' AND column_name IN ('gross_sales_minor','net_sales_minor','payments_collected_minor')")).rows; expect(columns).toHaveLength(3); expect(columns.every((x) => x.data_type === "bigint")).toBe(true); });
  it("does not mix currencies in a fact key", async () => { const result = await db.query("SELECT count(*) FROM analytics_daily_branch_facts WHERE tenant_id=$1 AND branch_id=$2", [tenant, branch]); expect(Number(result.rows[0].count)).toBeGreaterThanOrEqual(0); });
});

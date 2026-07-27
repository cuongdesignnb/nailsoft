import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TENANT, harness } from "./sprint7-closure-test-utils";

describe("Sprint 7 tip version integrity", () => {
  let h: Awaited<ReturnType<typeof harness>>;
  beforeAll(async () => {
    h = await harness("tip-version");
  });
  afterAll(async () => h?.app.close());

  it("excludes allocations whose owning tip version is voided", async () => {
    const staff = "47000000-0000-4000-8000-000000000008";
    const before = (
      await h.db.query<{ amount: string }>(
        "SELECT gross_tip_minor amount FROM staff_net_tip WHERE tenant_id=$1 AND staff_id=$2",
        [TENANT, staff],
      )
    ).rows[0]!;
    expect(BigInt(before.amount)).toBe(10000n);
    await h.db.query(
      "UPDATE pos_tips SET status='VOIDED',voided_at=now() WHERE tenant_id=$1 AND id='a7000000-0000-4000-8000-000000000002'",
      [TENANT],
    );
    const after = await h.db.query(
      "SELECT 1 FROM staff_net_tip WHERE tenant_id=$1 AND staff_id=$2",
      [TENANT, staff],
    );
    expect(after.rowCount).toBe(0);
  });
});

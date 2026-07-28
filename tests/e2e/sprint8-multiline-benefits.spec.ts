import { expect, test } from "@playwright/test";
import { close, login } from "./helpers/api-client";
import {
  addSecondServiceLine,
  applyPackage,
  closeClosureDb,
  createPackage,
  dbRow,
  finalizeAndPay,
  firstLineId,
  orderId,
  secondLineId,
} from "./helpers/sprint8-closure";

test.afterAll(closeClosureDb);

test("one entitlement can cover two distinct order lines with immutable allocations", async () => {
  const owner = await login("owner@example.test");
  try {
    await addSecondServiceLine(owner, 110_000);
    const entitlement = await createPackage(owner, 2);
    await applyPackage(
      owner,
      entitlement.id,
      firstLineId,
      "s8-close-package-a",
    );
    await applyPackage(
      owner,
      entitlement.id,
      secondLineId,
      "s8-close-package-b",
    );
    const paid = await finalizeAndPay(owner);
    expect(paid.status).toBe("PAID");
    expect(paid.totalMinor).toBe(0);
    const allocations = await dbRow<{ count: string; units: string }>(
      `SELECT count(*) count,COALESCE(sum(allocated_units),0) units
       FROM benefit_application_allocations WHERE pos_order_id=$1`,
      [orderId],
    );
    expect(Number(allocations.count)).toBe(2);
    expect(Number(allocations.units)).toBe(2);
    const balance = await dbRow<{
      consumed_units: number;
      reserved_units: number;
    }>(
      "SELECT consumed_units,reserved_units FROM customer_package_entitlements WHERE id=$1",
      [entitlement.id],
    );
    expect(Number(balance.consumed_units)).toBe(2);
    expect(Number(balance.reserved_units)).toBe(0);
  } finally {
    await close(owner);
  }
});

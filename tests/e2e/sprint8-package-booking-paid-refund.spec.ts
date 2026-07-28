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
  refundLine,
} from "./helpers/sprint8-closure";

test.afterAll(closeClosureDb);

test("package reservation commits on paid order and restores the covered line", async () => {
  const owner = await login("owner@example.test");
  try {
    await addSecondServiceLine(owner, 110_000);
    const entitlement = await createPackage(owner, 1);
    await applyPackage(
      owner,
      entitlement.id,
      firstLineId,
      "s8-close-package-first",
    );
    const paid = await finalizeAndPay(owner);
    const consumed = await dbRow<{
      available_units: number;
      consumed_units: number;
    }>(
      "SELECT available_units,consumed_units FROM customer_package_entitlements WHERE id=$1",
      [entitlement.id],
    );
    expect(Number(consumed.consumed_units)).toBe(1);
    await refundLine(owner, paid, firstLineId, 110_000);
    const restored = await dbRow<{
      available_units: number;
      consumed_units: number;
    }>(
      "SELECT available_units,consumed_units FROM customer_package_entitlements WHERE id=$1",
      [entitlement.id],
    );
    expect(Number(restored.available_units)).toBe(1);
    expect(Number(restored.consumed_units)).toBe(0);
  } finally {
    await close(owner);
  }
});

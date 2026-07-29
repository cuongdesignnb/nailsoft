import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";
import { database, get, tenant } from "./helpers/sprint12-closure";

test("replayed payout creation returns one batch and one stable item intent", async () => {
  const accountant = await login("accountant@example.test");
  const db = database();
  try {
    await db.query(
      `UPDATE payout_batches SET state='DRAFT',approved_by_user_id=NULL
       WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000095'`,
      [tenant],
    );
    const key = "s12-e2e-payout-submit";
    const request = () =>
      accountant.api.post(
        "/v1/payout-batches/f1200000-0000-4000-8000-000000000095/submit",
        {
          headers: headers(accountant, key),
          data: { reason: "Authenticated payout submission" },
        },
      );
    const first = await request();
    const second = await request();
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(first.status(), JSON.stringify(firstBody)).toBe(201);
    expect(second.status(), JSON.stringify(secondBody)).toBe(201);
    const firstData = firstBody.data;
    const secondData = secondBody.data;
    expect(secondData.id).toBe(firstData.id);
    expect(secondData.idempotencyReplayed).toBe(true);
    const items = await get(
      accountant,
      `/v1/payout-batches/${firstData.id}/items`,
    );
    expect(items).toHaveLength(1);
    expect(items[0].providerRequestKey).toBe(`payout:${tenant}:${items[0].id}`);
  } finally {
    await db.end();
    await close(accountant);
  }
});

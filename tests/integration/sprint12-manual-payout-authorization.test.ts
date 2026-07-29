import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiApp,
  batch,
  command,
  login,
  pool,
  tenant,
} from "./sprint12-closure-helpers";

const db = pool();
let app: Awaited<ReturnType<typeof apiApp>>;

describe.sequential("Sprint 12 manual payout authorization", () => {
  beforeAll(async () => {
    app = await apiApp();
  });
  afterAll(async () => {
    await app.close();
    await db.end();
  });
  it("requires approved dual-control workflow, staff-owned method, and exact evidence", async () => {
    await batch(
      db,
      `INSERT INTO staff_payment_methods(id,tenant_id,staff_id,method_type,status,is_primary)
       VALUES
       ('f1240000-0000-4000-8000-000000000300',$1,'47000000-0000-4000-8000-000000000003','MANUAL_OTHER','ACTIVE',true),
       ('f1240000-0000-4000-8000-000000000301',$1,'47000000-0000-4000-8000-000000000005','MANUAL_OTHER','ACTIVE',true);
       UPDATE payout_batches SET state='DRAFT',requested_by_user_id='30000000-0000-4000-8000-000000000001',approved_by_user_id='30000000-0000-4000-8000-000000000002'
       WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000095';
       UPDATE payout_items SET state='PENDING',payment_method_id='f1240000-0000-4000-8000-000000000300',confirmed_minor=NULL,provider_reference=NULL,manual_evidence_json=NULL,paid_at=NULL
       WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000096'`,
      [tenant],
    );
    const accountant = await login(app, "accountant@example.test");
    const payload = {
      confirmedMinor: "375000",
      currency: "VND",
      externalReference: "MANUAL-CLOSE-1",
      evidence: { approvedVoucher: "safe-reference" },
    };
    const denied = await app.inject({
      method: "POST",
      url: "/v1/payout-items/f1200000-0000-4000-8000-000000000096/record-manual-payment",
      headers: command(accountant, "s12-manual-before-approval"),
      payload,
    });
    expect(denied.statusCode).toBe(409);
    expect(denied.json().error.code).toBe("PAYOUT_BATCH_NOT_APPROVED");
    await db.query(
      "UPDATE payout_batches SET state='APPROVED' WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000095'",
      [tenant],
    );
    const paid = await app.inject({
      method: "POST",
      url: "/v1/payout-items/f1200000-0000-4000-8000-000000000096/record-manual-payment",
      headers: command(accountant, "s12-manual-approved"),
      payload,
    });
    expect(paid.statusCode, paid.body).toBe(201);
    expect(paid.json().data.manualEvidenceHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      db.query(
        `UPDATE payout_items SET payment_method_id=(
           'f1240000-0000-4000-8000-000000000301'
         ) WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000096'`,
        [tenant],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });
});

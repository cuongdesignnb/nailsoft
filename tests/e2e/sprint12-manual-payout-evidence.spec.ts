import { expect, test } from "@playwright/test";
import { close, login } from "./helpers/api-client";
import {
  database,
  get,
  post,
  staff3,
  statements,
  tenant,
} from "./helpers/sprint12-closure";

test("manual payout requires approved batch and stores hashed evidence", async () => {
  const accountant = await login("accountant@example.test");
  const db = database();
  try {
    await statements(
      db,
      `INSERT INTO staff_payment_methods(id,tenant_id,staff_id,method_type,status,is_primary)
       VALUES('f1250000-0000-4000-8000-000000000500',$1,$2,'MANUAL_OTHER','ACTIVE',true);
       UPDATE payout_batches SET state='APPROVED',requested_by_user_id='30000000-0000-4000-8000-000000000001',approved_by_user_id='30000000-0000-4000-8000-000000000002'
       WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000095';
       UPDATE payout_items SET state='PENDING',payment_method_id='f1250000-0000-4000-8000-000000000500',confirmed_minor=NULL,provider_reference=NULL,manual_evidence_json=NULL,paid_at=NULL
       WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000096'`,
      [tenant, staff3],
    );
    const paid = await post(
      accountant,
      "/v1/payout-items/f1200000-0000-4000-8000-000000000096/record-manual-payment",
      {
        confirmedMinor: "375000",
        currency: "VND",
        externalReference: "E2E-MANUAL-001",
        evidence: { approvedVoucher: "non-PII-evidence-reference" },
      },
      "s12-e2e-manual-paid",
    );
    expect(paid.manualEvidenceHash).toMatch(/^[a-f0-9]{64}$/);
    const item = await get(
      accountant,
      "/v1/payout-items/f1200000-0000-4000-8000-000000000096",
    );
    expect(item.state).toBe("PAID");
    expect(item.providerReference).toBe("E2E-MANUAL-001");
  } finally {
    await db.end();
    await close(accountant);
  }
});

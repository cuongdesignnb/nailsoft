import { afterAll, describe, expect, it } from "vitest";
import { WorkforceProcessor } from "../../apps/worker/src/workforce.processor";
import { batch, pool, tenant } from "./sprint12-closure-helpers";

const db = pool();
const processor = new WorkforceProcessor();

describe.sequential(
  "Sprint 12 payout stable idempotency and unknown reconciliation",
  () => {
    afterAll(async () => {
      await processor.onModuleDestroy();
      await db.end();
    });
    it("creates one provider intent under 20 processors and reconciles lost response", async () => {
      process.env.NODE_ENV = "test";
      process.env.PAYOUT_PROVIDER_MODE = "FAKE";
      process.env.PAYOUT_FAKE_RESULT = "LOST_RESPONSE";
      await batch(
        db,
        `INSERT INTO staff_payment_methods(id,tenant_id,staff_id,method_type,status,is_primary)
       VALUES('f1240000-0000-4000-8000-000000000200',$1,'47000000-0000-4000-8000-000000000003','EXTERNAL_PAYROLL_PROVIDER','ACTIVE',true);
       INSERT INTO payout_batches(id,tenant_id,payroll_run_id,state,method,provider_code,currency,total_minor,item_count,requested_by_user_id,approved_by_user_id)
       VALUES('f1240000-0000-4000-8000-000000000201',$1,'f1200000-0000-4000-8000-000000000090','PROCESSING','EXTERNAL_PAYROLL_PROVIDER','FAKE','VND',375000,1,'30000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000001');
       UPDATE payout_items SET batch_id='f1240000-0000-4000-8000-000000000201',state='PROCESSING',payment_method_id='f1240000-0000-4000-8000-000000000200',confirmed_minor=NULL,provider_reference=NULL,manual_evidence_json=NULL,paid_at=NULL
       WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000096'`,
        [tenant],
      );
      await Promise.all(
        Array.from({ length: 20 }, () => processor.processPayouts()),
      );
      let item = (
        await db.query(
          "SELECT state,provider_request_key FROM payout_items WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000096'",
          [tenant],
        )
      ).rows[0];
      expect(item.state).toBe("UNKNOWN");
      expect(item.provider_request_key).toBe(
        `payout:${tenant}:f1200000-0000-4000-8000-000000000096`,
      );
      expect(
        (
          await db.query(
            "SELECT count(*)::int n,count(DISTINCT provider_request_key)::int keys FROM payout_attempts WHERE tenant_id=$1 AND payout_item_id='f1200000-0000-4000-8000-000000000096'",
            [tenant],
          )
        ).rows[0],
      ).toEqual({ n: 1, keys: 1 });
      await processor.processPayouts();
      item = (
        await db.query(
          "SELECT state,confirmed_minor::text FROM payout_items WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000096'",
          [tenant],
        )
      ).rows[0];
      expect(item).toEqual({ state: "PAID", confirmed_minor: "375000" });
    });
  },
);

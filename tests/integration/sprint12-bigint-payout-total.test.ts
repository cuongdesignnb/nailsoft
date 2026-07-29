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

describe.sequential("Sprint 12 exact bigint payout total", () => {
  beforeAll(async () => {
    app = await apiApp();
  });
  afterAll(async () => {
    await app.close();
    await db.end();
  });
  it("sums values above Number.MAX_SAFE_INTEGER exactly in PostgreSQL", async () => {
    await batch(
      db,
      `INSERT INTO payroll_runs(id,tenant_id,payroll_period_id,run_type,state,currency,prepared_by_user_id,finalized_at)
       VALUES('f1240000-0000-4000-8000-000000000100',$1,'f1200000-0000-4000-8000-000000000081','REGULAR','FINALIZED','VND','30000000-0000-4000-8000-000000000004',now());
       INSERT INTO payroll_run_workers(id,tenant_id,payroll_run_id,staff_id,pay_profile_version_json,policy_version_json,source_fingerprint,gross_pay_minor,net_pay_minor,currency,state) VALUES
       ('f1240000-0000-4000-8000-000000000101',$1,'f1240000-0000-4000-8000-000000000100','47000000-0000-4000-8000-000000000003','{}','{}','big-a',9007199254740993,9007199254740993,'VND','FINALIZED'),
       ('f1240000-0000-4000-8000-000000000102',$1,'f1240000-0000-4000-8000-000000000100','47000000-0000-4000-8000-000000000005','{}','{}','big-b',9007199254740995,9007199254740995,'VND','FINALIZED');
       INSERT INTO pay_statements(id,tenant_id,payroll_run_id,payroll_worker_id,staff_id,employer_snapshot_json,statement_json,net_pay_minor,currency) VALUES
       ('f1240000-0000-4000-8000-000000000103',$1,'f1240000-0000-4000-8000-000000000100','f1240000-0000-4000-8000-000000000101','47000000-0000-4000-8000-000000000003','{}','{}',9007199254740993,'VND'),
       ('f1240000-0000-4000-8000-000000000104',$1,'f1240000-0000-4000-8000-000000000100','f1240000-0000-4000-8000-000000000102','47000000-0000-4000-8000-000000000005','{}','{}',9007199254740995,'VND');
       INSERT INTO staff_payment_methods(tenant_id,staff_id,method_type,status,is_primary) VALUES
       ($1,'47000000-0000-4000-8000-000000000003','MANUAL_OTHER','ACTIVE',true),
       ($1,'47000000-0000-4000-8000-000000000005','MANUAL_OTHER','ACTIVE',true)`,
      [tenant],
    );
    const owner = await login(app, "owner@example.test");
    const result = await app.inject({
      method: "POST",
      url: "/v1/payout-batches",
      headers: command(owner, "s12-bigint-batch"),
      payload: {
        payrollRunId: "f1240000-0000-4000-8000-000000000100",
        method: "MANUAL_OTHER",
      },
    });
    expect(result.statusCode, result.body).toBe(201);
    expect(result.json().data.totalMinor).toBe("18014398509481988");
    const exact = (
      await db.query(
        `SELECT b.total_minor::text batch_total,sum(i.requested_minor)::text item_total
         FROM payout_batches b JOIN payout_items i ON i.tenant_id=b.tenant_id AND i.batch_id=b.id
         WHERE b.tenant_id=$1 AND b.id=$2 GROUP BY b.id`,
        [tenant, result.json().data.id],
      )
    ).rows[0];
    expect(exact.batch_total).toBe(exact.item_total);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiApp,
  command,
  login,
  pool,
  tenant,
} from "./sprint12-closure-helpers";

const db = pool();
let app: Awaited<ReturnType<typeof apiApp>>;
describe("Sprint 12 tip payroll disposition", () => {
  beforeAll(async () => {
    app = await apiApp();
  });
  afterAll(async () => {
    await app.close();
    await db.end();
  });

  it("claims payroll-managed tips for a non-commission profile and excludes direct-paid tips", async () => {
    await db.query(
      `UPDATE pos_orders SET paid_at='2026-08-05' WHERE tenant_id=$1 AND id='a4000000-0000-4000-8000-000000000004'`,
      [tenant],
    );
    await db.query(
      `UPDATE staff_pay_profiles SET profile_type='SALARY',status='ACTIVE',currency='VND',effective_from='2026-01-01' WHERE tenant_id=$1 AND staff_id='47000000-0000-4000-8000-000000000008'`,
      [tenant],
    );
    await db.query(
      `INSERT INTO staff_pay_rate_versions(tenant_id,pay_profile_id,component_type,amount_minor,currency,effective_from,version,fingerprint,created_by_user_id) SELECT $1,id,'SALARY_PERIOD_AMOUNT',500000,'VND','2026-01-01',1,'salary-tip','30000000-0000-4000-8000-000000000001' FROM staff_pay_profiles WHERE tenant_id=$1 AND staff_id='47000000-0000-4000-8000-000000000008'`,
      [tenant],
    );
    await db.query(
      `INSERT INTO pos_tip_allocations(id,tenant_id,pos_tip_id,staff_id,amount_minor,allocation_basis,contribution_snapshot_json)
       VALUES
       ('a8000000-0000-4000-8000-000000000104',$1,'a7000000-0000-4000-8000-000000000002','47000000-0000-4000-8000-000000000006',1000,'MANUAL','{}'),
       ('a8000000-0000-4000-8000-000000000105',$1,'a7000000-0000-4000-8000-000000000002','47000000-0000-4000-8000-000000000007',1000,'MANUAL','{}')`,
      [tenant],
    );
    await db.query(
      `UPDATE staff_pay_profiles SET profile_type='SALARY',status='ACTIVE',currency='VND',effective_from='2026-01-01'
       WHERE tenant_id=$1 AND staff_id IN('47000000-0000-4000-8000-000000000006','47000000-0000-4000-8000-000000000007')`,
      [tenant],
    );
    await db.query(
      `INSERT INTO staff_pay_rate_versions(tenant_id,pay_profile_id,component_type,amount_minor,currency,effective_from,version,fingerprint,created_by_user_id)
       SELECT $1,id,'SALARY_PERIOD_AMOUNT',500000,'VND','2026-01-01',1,'tip-exclusion-'||staff_id,'30000000-0000-4000-8000-000000000001'
       FROM staff_pay_profiles WHERE tenant_id=$1 AND staff_id IN('47000000-0000-4000-8000-000000000006','47000000-0000-4000-8000-000000000007')`,
      [tenant],
    );
    const accountant = await login(app, "accountant@example.test");
    for (const [tipId, disposition] of [
      ["a8000000-0000-4000-8000-000000000003", "PAYROLL_PENDING"],
      ["a8000000-0000-4000-8000-000000000002", "PAID_DIRECT"],
      ["a8000000-0000-4000-8000-000000000104", "REVERSED"],
      ["a8000000-0000-4000-8000-000000000105", "PAID_DIRECT"],
    ] as const) {
      const set = await app.inject({
        method: "POST",
        url: `/v1/payroll/tips/${tipId}/disposition`,
        headers: command(accountant, `tip-${tipId.slice(-4)}-${disposition}`),
        payload: { disposition, reason: "Verified payout evidence" },
      });
      expect(set.statusCode, set.body).toBe(201);
    }
    const calculated = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs/f1200000-0000-4000-8000-000000000091/calculate",
      headers: command(accountant, "tip-profile-independent"),
      payload: {},
    });
    expect(calculated.statusCode, calculated.body).toBe(201);
    const tips = (
      await db.query(
        `SELECT l.source_id,l.amount_minor::text FROM payroll_earning_lines l JOIN payroll_run_workers w ON w.tenant_id=l.tenant_id AND w.id=l.payroll_worker_id WHERE w.tenant_id=$1 AND w.payroll_run_id='f1200000-0000-4000-8000-000000000091' AND l.earning_type='TIP' ORDER BY l.source_id`,
        [tenant],
      )
    ).rows;
    expect(tips).toContainEqual({
      source_id: "a8000000-0000-4000-8000-000000000003",
      amount_minor: "10000",
    });
    expect(
      tips.some(
        (tip) => tip.source_id === "a8000000-0000-4000-8000-000000000002",
      ),
    ).toBe(false);
    expect(
      tips.some((tip) =>
        [
          "a8000000-0000-4000-8000-000000000104",
          "a8000000-0000-4000-8000-000000000105",
        ].includes(tip.source_id),
      ),
    ).toBe(false);

    const lockedDisposition = await app.inject({
      method: "POST",
      url: "/v1/payroll/tips/a8000000-0000-4000-8000-000000000003/disposition",
      headers: command(accountant, "tip-claimed-cannot-change"),
      payload: { disposition: "PAID_DIRECT", reason: "Late evidence" },
    });
    expect(lockedDisposition.statusCode, lockedDisposition.body).toBe(409);

    await db.query(
      `INSERT INTO role_permissions(role,permission_code) VALUES('BRANCH_MANAGER','payroll.run.approve') ON CONFLICT DO NOTHING`,
    );
    const manager = await login(app, "staff2@example.test");
    const owner = await login(app, "owner@example.test");
    for (const [actor, transition] of [
      [accountant, "submit"],
      [manager, "approve"],
      [owner, "finalize"],
    ] as const) {
      const transitioned = await app.inject({
        method: "POST",
        url: `/v1/payroll/runs/f1200000-0000-4000-8000-000000000091/${transition}`,
        headers: command(actor, `tip-run-${transition}`),
        payload: { reason: `Independent ${transition}` },
      });
      expect(transitioned.statusCode, transitioned.body).toBe(201);
    }
    expect(
      (
        await db.query(
          `SELECT payroll_disposition,claimed_by_payroll_run_id,payroll_paid_at IS NOT NULL paid
           FROM pos_tip_allocations WHERE tenant_id=$1 AND id='a8000000-0000-4000-8000-000000000003'`,
          [tenant],
        )
      ).rows[0],
    ).toEqual({
      payroll_disposition: "PAYROLL_PAID",
      claimed_by_payroll_run_id: "f1200000-0000-4000-8000-000000000091",
      paid: true,
    });
    expect(
      (
        await db.query(
          `SELECT state FROM payroll_source_allocations WHERE tenant_id=$1 AND source_type='LOCKED_TIP_ALLOCATIONS' AND source_id='a8000000-0000-4000-8000-000000000003'`,
          [tenant],
        )
      ).rows[0],
    ).toEqual({ state: "CONSUMED" });

    await db.query(
      `INSERT INTO pos_tip_allocations(id,tenant_id,pos_tip_id,staff_id,appointment_item_id,amount_minor,allocation_basis,contribution_snapshot_json)
       VALUES('a8000000-0000-4000-8000-000000000106',$1,'a7000000-0000-4000-8000-000000000002',
         '47000000-0000-4000-8000-000000000008','72000000-0000-4000-8000-000000000017',500,'MANUAL','{}')`,
      [tenant],
    );
    const secondPending = await app.inject({
      method: "POST",
      url: "/v1/payroll/tips/a8000000-0000-4000-8000-000000000106/disposition",
      headers: command(accountant, "tip-second-pending"),
      payload: { disposition: "PAYROLL_PENDING", reason: "Payroll managed" },
    });
    expect(secondPending.statusCode, secondPending.body).toBe(201);
    await db.query(
      `INSERT INTO payroll_runs(id,tenant_id,payroll_period_id,run_type,state,currency,prepared_by_user_id)
       VALUES('f1200000-0000-4000-8000-000000000199',$1,'f1200000-0000-4000-8000-000000000082','OFF_CYCLE','DRAFT','VND','30000000-0000-4000-8000-000000000004')`,
      [tenant],
    );
    const secondCalculated = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs/f1200000-0000-4000-8000-000000000199/calculate",
      headers: command(accountant, "tip-second-calculate"),
      payload: {},
    });
    expect(secondCalculated.statusCode, secondCalculated.body).toBe(201);
    await db.query(
      `UPDATE pos_tip_allocations SET payroll_disposition='REVERSED',claimed_by_payroll_run_id=NULL,payroll_paid_at=NULL,
         payroll_disposition_evidence_json=payroll_disposition_evidence_json||'{"reversedAfterClaim":true}'::jsonb
       WHERE tenant_id=$1 AND id='a8000000-0000-4000-8000-000000000106'`,
      [tenant],
    );
    for (const [actor, transition] of [
      [accountant, "submit"],
      [manager, "approve"],
    ] as const) {
      const transitioned = await app.inject({
        method: "POST",
        url: `/v1/payroll/runs/f1200000-0000-4000-8000-000000000199/${transition}`,
        headers: command(actor, `tip-second-${transition}`),
        payload: { reason: `Independent ${transition}` },
      });
      expect(transitioned.statusCode, transitioned.body).toBe(201);
    }
    const invalidated = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs/f1200000-0000-4000-8000-000000000199/finalize",
      headers: command(owner, "tip-second-finalize"),
      payload: { reason: "Must revalidate disposition" },
    });
    expect(invalidated.statusCode, invalidated.body).toBe(409);
    expect(invalidated.json().error.code).toBe(
      "PAYROLL_SOURCE_FINGERPRINT_CHANGED",
    );
  });
});

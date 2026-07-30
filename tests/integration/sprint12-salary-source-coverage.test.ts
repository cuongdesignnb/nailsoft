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

describe("Sprint 12 salary source coverage", () => {
  beforeAll(async () => {
    app = await apiApp();
  });
  afterAll(async () => {
    await app.close();
    await db.end();
  });

  it("covers salary-only, salary-plus-commission, range, missing-rate, and currency branches without attendance", async () => {
    await db.query(
      `UPDATE staff_pay_profiles SET
         profile_type=CASE WHEN staff_id='47000000-0000-4000-8000-000000000007' THEN 'SALARY_PLUS_COMMISSION' ELSE 'SALARY' END,
         status='ACTIVE',currency=CASE WHEN staff_id='47000000-0000-4000-8000-000000000010' THEN 'USD' ELSE 'VND' END,
         effective_from='2026-01-01',effective_to=CASE WHEN staff_id='47000000-0000-4000-8000-000000000009' THEN '2026-07-31'::date ELSE NULL END
       WHERE tenant_id=$1 AND staff_id IN(
         '47000000-0000-4000-8000-000000000006','47000000-0000-4000-8000-000000000007',
         '47000000-0000-4000-8000-000000000008','47000000-0000-4000-8000-000000000009',
         '47000000-0000-4000-8000-000000000010')`,
      [tenant],
    );
    await db.query(
      `INSERT INTO staff_pay_rate_versions(tenant_id,pay_profile_id,component_type,amount_minor,currency,effective_from,version,fingerprint,created_by_user_id)
       SELECT $1,id,'SALARY_PERIOD_AMOUNT',
         CASE staff_id WHEN '47000000-0000-4000-8000-000000000006' THEN 900000 ELSE 700000 END,
         CASE WHEN staff_id='47000000-0000-4000-8000-000000000010' THEN 'USD' ELSE 'VND' END,
         '2026-01-01',1,'salary-coverage-'||staff_id,'30000000-0000-4000-8000-000000000001'
       FROM staff_pay_profiles WHERE tenant_id=$1 AND staff_id IN(
         '47000000-0000-4000-8000-000000000006','47000000-0000-4000-8000-000000000007',
         '47000000-0000-4000-8000-000000000009','47000000-0000-4000-8000-000000000010')`,
      [tenant],
    );
    await db.query(
      `INSERT INTO commission_entries(
         tenant_id,branch_id,staff_id,invoice_id,invoice_line_id,entry_type,business_date,currency,
         base_minor,commission_minor,contribution_basis_json,rule_snapshot_json,source_snapshot_json,generation_key,status
       ) VALUES($1,'20000000-0000-4000-8000-000000000001','47000000-0000-4000-8000-000000000007',
         'a9000000-0000-4000-8000-000000000002','aa000000-0000-4000-8000-000000000001','EARNING',
         '2026-08-05','VND',100000,15000,'{}','{}','{}','salary-plus-commission-coverage','LOCKED')`,
      [tenant],
    );
    const accountant = await login(app, "accountant@example.test");
    const response = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs/f1200000-0000-4000-8000-000000000091/calculate",
      headers: command(accountant, "salary-source-coverage"),
      payload: {},
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(
      (
        await db.query(
          `SELECT amount_minor::text FROM payroll_earning_lines l JOIN payroll_run_workers w ON w.tenant_id=l.tenant_id AND w.id=l.payroll_worker_id WHERE w.tenant_id=$1 AND w.staff_id='47000000-0000-4000-8000-000000000006' AND l.earning_type='SALARY'`,
          [tenant],
        )
      ).rows[0],
    ).toEqual({ amount_minor: "900000" });
    expect(
      (
        await db.query(
          `SELECT exception_type FROM payroll_exceptions e JOIN payroll_run_workers w ON w.tenant_id=e.tenant_id AND w.id=e.payroll_worker_id WHERE w.tenant_id=$1 AND w.staff_id='47000000-0000-4000-8000-000000000008'`,
          [tenant],
        )
      ).rows[0],
    ).toEqual({ exception_type: "MISSING_PAY_RATE" });
    expect(
      (
        await db.query(
          `SELECT earning_type,amount_minor::text FROM payroll_earning_lines l
           JOIN payroll_run_workers w ON w.tenant_id=l.tenant_id AND w.id=l.payroll_worker_id
           WHERE w.tenant_id=$1 AND w.staff_id='47000000-0000-4000-8000-000000000007'
           ORDER BY earning_type`,
          [tenant],
        )
      ).rows,
    ).toEqual([
      { earning_type: "SALARY", amount_minor: "700000" },
      { earning_type: "SERVICE_COMMISSION", amount_minor: "15000" },
    ]);
    expect(
      (
        await db.query(
          `SELECT count(*)::int count FROM payroll_run_workers WHERE tenant_id=$1 AND payroll_run_id='f1200000-0000-4000-8000-000000000091' AND staff_id='47000000-0000-4000-8000-000000000009'`,
          [tenant],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (
        await db.query(
          `SELECT count(*)::int count FROM payroll_exceptions e JOIN payroll_run_workers w ON w.tenant_id=e.tenant_id AND w.id=e.payroll_worker_id WHERE w.tenant_id=$1 AND w.staff_id='47000000-0000-4000-8000-000000000010' AND e.exception_type='CURRENCY_MISMATCH'`,
          [tenant],
        )
      ).rows[0].count,
    ).toBeGreaterThan(0);
  });
});

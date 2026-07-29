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

describe.sequential("Sprint 12 payroll recalculation", () => {
  beforeAll(async () => {
    app = await apiApp();
  });
  afterAll(async () => {
    await app.close();
    await db.end();
  });

  it("deletes children in FK order and rebuilds without duplicate source claims", async () => {
    await batch(
      db,
      `UPDATE staff_timesheets SET state='LOCKED',regular_seconds=14400,payable_seconds=14400,fingerprint='recalc-source',
         projection_input_fingerprint='recalc-input',projected_at=now(),submitted_fingerprint='recalc-source',approved_fingerprint='recalc-source',locked_fingerprint='recalc-source'
       WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000061';
       DELETE FROM timesheet_day_entries WHERE tenant_id=$1 AND timesheet_id='f1200000-0000-4000-8000-000000000061';
       INSERT INTO timesheet_day_entries(tenant_id,timesheet_id,local_date,branch_id,regular_seconds,payable_seconds,fingerprint)
       VALUES($1,'f1200000-0000-4000-8000-000000000061','2026-08-05','20000000-0000-4000-8000-000000000001',14400,14400,'recalc-day');
       UPDATE staff_pay_profiles SET profile_type='HOURLY' WHERE tenant_id=$1 AND staff_id='47000000-0000-4000-8000-000000000005'`,
      [tenant],
    );
    const accountant = await login(app, "accountant@example.test");
    for (const [path, key] of [
      ["calculate", "s12-calc-first"],
      ["recalculate", "s12-calc-second"],
    ]) {
      const result = await app.inject({
        method: "POST",
        url: `/v1/payroll/runs/f1200000-0000-4000-8000-000000000091/${path}`,
        headers: command(accountant, key),
        payload: {},
      });
      expect(result.statusCode, result.body).toBe(201);
    }
    const evidence = (
      await db.query(
        `SELECT r.calculation_generation,r.worker_count,
          (SELECT count(*) FROM payroll_source_allocations s WHERE s.tenant_id=r.tenant_id AND s.payroll_run_id=r.id)::int allocations,
          (SELECT count(*) FROM payroll_run_workers w WHERE w.tenant_id=r.tenant_id AND w.payroll_run_id=r.id)::int workers
         FROM payroll_runs r WHERE r.tenant_id=$1 AND r.id='f1200000-0000-4000-8000-000000000091'`,
        [tenant],
      )
    ).rows[0];
    expect(evidence).toMatchObject({
      calculation_generation: 2,
      worker_count: 1,
      allocations: 1,
      workers: 1,
    });
    await expect(
      app.inject({
        method: "POST",
        url: "/v1/payroll/runs/f1200000-0000-4000-8000-000000000090/recalculate",
        headers: command(accountant, "s12-final-recalc-denied"),
        payload: {},
      }),
    ).resolves.toMatchObject({ statusCode: 409 });
  });
});

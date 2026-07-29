import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
  max: 24,
});
const tenant = "10000000-0000-4000-8000-000000000001",
  branch = "20000000-0000-4000-8000-000000000001";
describe.sequential(
  "Sprint 12 PostgreSQL workforce and payroll invariants",
  () => {
    beforeAll(async () => void (await pool.query("SELECT 1")));
    afterAll(async () => pool.end());
    it("migrates every required aggregate and deterministic fixture", async () => {
      const row = (
        await pool.query(
          `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version='0023_time_clock_payroll_payout_workforce_compliance') migrated,(SELECT count(*)::int FROM time_clock_events WHERE tenant_id=$1) events,(SELECT count(*)::int FROM staff_timesheets WHERE tenant_id=$1) timesheets,(SELECT count(*)::int FROM payroll_runs WHERE tenant_id=$1) runs,(SELECT count(*)::int FROM payout_items WHERE tenant_id=$1) payouts`,
          [tenant],
        )
      ).rows[0];
      expect(row).toEqual({
        migrated: true,
        events: 5,
        timesheets: 2,
        runs: 2,
        payouts: 1,
      });
    });
    it("keeps time clock event ledger append-only", async () => {
      await expect(
        pool.query(
          "UPDATE time_clock_events SET note='tamper' WHERE id='f1200000-0000-4000-8000-000000000020'",
        ),
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        pool.query(
          "DELETE FROM time_clock_events WHERE id='f1200000-0000-4000-8000-000000000020'",
        ),
      ).rejects.toMatchObject({ code: "55000" });
    });
    it("allows independent clock events without a worker generation key", async () => {
      await pool.query(
        `INSERT INTO time_clock_events(id,tenant_id,branch_id,staff_id,event_type,branch_timezone_snapshot,source,actor_user_id,idempotency_key_hash,request_id)
         VALUES
         ('f1220000-0000-4000-8000-000000000001',$1,$2,'47000000-0000-4000-8000-000000000006','CLOCK_IN','Asia/Ho_Chi_Minh','API','30000000-0000-4000-8000-000000000001','null-generation-1','null-generation-1'),
         ('f1220000-0000-4000-8000-000000000002',$1,$2,'47000000-0000-4000-8000-000000000006','CLOCK_OUT','Asia/Ho_Chi_Minh','API','30000000-0000-4000-8000-000000000001','null-generation-2','null-generation-2')`,
        [tenant, branch],
      );
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM time_clock_events WHERE id IN ('f1220000-0000-4000-8000-000000000001','f1220000-0000-4000-8000-000000000002')",
          )
        ).rows[0].n,
      ).toBe(2);
    });
    it("allows one active session under twenty concurrent clock-ins", async () => {
      const staff = "47000000-0000-4000-8000-000000000006";
      const eventIds = Array.from(
        { length: 20 },
        (_, i) => `f1210000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      );
      for (const [i, id] of eventIds.entries())
        await pool.query(
          `INSERT INTO time_clock_events(id,tenant_id,branch_id,staff_id,event_type,branch_timezone_snapshot,source,actor_user_id,idempotency_key_hash,generation_key,request_id) VALUES($1,$2,$3,$4,'CLOCK_IN','Asia/Ho_Chi_Minh','API','30000000-0000-4000-8000-000000000001',$5,$6,$6)`,
          [
            id,
            tenant,
            branch,
            staff,
            `s12-concurrent-${i}`,
            `s12:concurrent:${i}`,
          ],
        );
      const attempts = await Promise.allSettled(
        eventIds.map((eventId, i) =>
          pool.query(
            `INSERT INTO attendance_sessions(tenant_id,branch_id,staff_id,clock_in_event_id,started_at,state,fingerprint) VALUES($1,$2,$3,$4,now(),'OPEN',$5)`,
            [tenant, branch, staff, eventId, `concurrent-${i}`],
          ),
        ),
      );
      expect(attempts.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM attendance_sessions WHERE tenant_id=$1 AND staff_id=$2 AND state='OPEN'",
            [tenant, staff],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("allows one open break under twenty concurrent requests", async () => {
      const session = "f1200000-0000-4000-8000-000000000031",
        event = "f1200000-0000-4000-8000-000000000024";
      const attempts = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) =>
          pool.query(
            `INSERT INTO attendance_breaks(tenant_id,session_id,start_event_id,break_type,state,started_at) VALUES($1,$2,$3,'OTHER','OPEN',now()+($4||' milliseconds')::interval)`,
            [tenant, session, event, i],
          ),
        ),
      );
      expect(attempts.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    });
    it("deduplicates payroll source usage across competing runs", async () => {
      const attempts = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) =>
          pool.query(
            `INSERT INTO payroll_source_allocations(tenant_id,payroll_run_id,payroll_worker_id,source_type,source_id,earning_usage_key,source_fingerprint,allocated_minor,currency) VALUES($1,'f1200000-0000-4000-8000-000000000090','f1200000-0000-4000-8000-000000000092','LOCKED_TIMESHEET','f1200000-0000-4000-8000-000000000060','CONCURRENCY_QA','seed-timesheet-locked',$2,'VND')`,
            [tenant, String(100 + i)],
          ),
        ),
      );
      expect(attempts.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    });
    it("makes finalized payroll immutable and requires real payout evidence", async () => {
      await expect(
        pool.query(
          "UPDATE payroll_runs SET gross_pay_minor=1 WHERE id='f1200000-0000-4000-8000-000000000090'",
        ),
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        pool.query(
          "UPDATE payout_items SET provider_reference=NULL,manual_evidence_json=NULL WHERE id='f1200000-0000-4000-8000-000000000096'",
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
    it("deduplicates provider event replay and denies Platform Sprint 12 permissions", async () => {
      const attempts = await Promise.allSettled(
        Array.from({ length: 20 }, () =>
          pool.query(
            `INSERT INTO payout_provider_events(tenant_id,provider_code,provider_event_id,event_type,payload_hash,signature_verified) VALUES($1,'FAKE','evt-replay-1','paid','hash',true)`,
            [tenant],
          ),
        ),
      );
      expect(attempts.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM role_permissions WHERE role='PLATFORM_SUPER_ADMIN' AND (permission_code LIKE 'time_clock.%' OR permission_code LIKE 'timesheet.%' OR permission_code LIKE 'workforce.%' OR permission_code LIKE 'payroll.%' OR permission_code LIKE 'payout.%')",
          )
        ).rows[0].n,
      ).toBe(0);
    });
  },
);

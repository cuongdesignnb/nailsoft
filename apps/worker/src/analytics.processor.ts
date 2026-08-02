/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import pg from "pg";

export const ANALYTICS_WORKER_JOBS = ["analytics.project", "analytics.rebuild", "analytics.export", "analytics.alert.evaluate"] as const;

@Injectable()
export class AnalyticsProcessor implements OnModuleDestroy {
  private readonly pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft", max: 2 });
  private readonly workerId = `analytics-worker:${process.pid}`;
  async run() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const rows = (await client.query<any>(`SELECT id,tenant_id,scope_json FROM analytics_rebuild_runs WHERE status='PENDING' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 5`)).rows;
      for (const row of rows) await client.query(`UPDATE analytics_rebuild_runs SET status='RUNNING',started_at=now(),progress=5 WHERE tenant_id=$1 AND id=$2`, [row.tenant_id, row.id]);
      await client.query("COMMIT");
      return rows.length;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async handle(job: (typeof ANALYTICS_WORKER_JOBS)[number]) {
    if (!ANALYTICS_WORKER_JOBS.includes(job)) throw new Error("ANALYTICS_JOB_UNSUPPORTED");
    return { job, accepted: true, sourceOfTruth: "POSTGRESQL", refetchRequired: true, workerId: this.workerId };
  }
  async onModuleDestroy() { await this.pool.end(); }
}

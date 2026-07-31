/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import pg from "pg";

/** Fail-closed posting candidate lease. Mapping/adapters must produce an approved journal before posting. */
@Injectable()
export class AccountingPostingProcessor implements OnModuleDestroy {
  private readonly pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft", max: 2 });
  async run() {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const candidates = (await c.query<any>(`SELECT * FROM accounting_posting_candidates WHERE state IN ('PENDING','FAILED') AND (lease_expires_at IS NULL OR lease_expires_at<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 25`)).rows;
      for (const candidate of candidates) {
        await c.query(`UPDATE accounting_posting_candidates SET state='MAPPING',lease_owner=$2,lease_expires_at=now()+interval '60 seconds',retry_count=retry_count+1,updated_at=now() WHERE id=$1`, [candidate.id, `accounting-posting-worker:${process.pid}`]);
      }
      await c.query("COMMIT");
      return candidates.length;
    } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
  }
  async onModuleDestroy() { await this.pool.end(); }
}

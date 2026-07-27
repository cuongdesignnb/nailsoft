/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import pg, { type PoolClient } from "pg";

@Injectable()
export class BenefitMaintenanceProcessor implements OnModuleDestroy {
  private readonly pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
    max: 2,
  });
  async run() {
    return (
      await Promise.all([
        this.jobs(),
        this.expireVoucherReservations(),
        this.expireLoyaltyReservations(),
        this.expirePackageReservations(),
        this.expireVoucherCodes(),
        this.expireLoyaltyLots(),
        this.expirePackages(),
      ])
    ).reduce((a, b) => a + b, 0);
  }
  async jobs() {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const rows = (
        await c.query<any>(
          `SELECT * FROM benefit_jobs WHERE status IN('PENDING','FAILED') AND run_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY run_at,id FOR UPDATE SKIP LOCKED LIMIT 25`,
        )
      ).rows;
      for (const job of rows) {
        await c.query(
          "UPDATE benefit_jobs SET status='PROCESSING',lease_until=now()+interval '2 minutes',attempts=attempts+1,updated_at=now() WHERE id=$1",
          [job.id],
        );
        try {
          if (job.job_type === "LOYALTY_SETTLEMENT") await this.settle(c, job);
          else if (job.job_type === "MEMBERSHIP_EVALUATION")
            await this.membership(c, job);
          await c.query(
            "UPDATE benefit_jobs SET status='COMPLETED',lease_until=NULL,updated_at=now() WHERE id=$1",
            [job.id],
          );
        } catch (error) {
          await c.query(
            "UPDATE benefit_jobs SET status='FAILED',lease_until=NULL,run_at=now()+interval '1 minute',payload_json=payload_json||$2::jsonb,updated_at=now() WHERE id=$1",
            [
              job.id,
              JSON.stringify({
                lastError: error instanceof Error ? error.message : "unknown",
              }),
            ],
          );
        }
      }
      await c.query("COMMIT");
      return rows.length;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  private async settle(c: PoolClient, job: any) {
    const source = (
      await c.query<any>(
        "SELECT * FROM loyalty_ledger_entries WHERE tenant_id=$1 AND generation_key=$2 FOR SHARE",
        [job.tenant_id, job.payload_json.earnGeneration],
      )
    ).rows[0];
    if (!source) return;
    const points = BigInt(job.payload_json.points),
      generation = `loyalty-available:${job.aggregate_id}`;
    const inserted = (
      await c.query<any>(
        `INSERT INTO loyalty_ledger_entries(tenant_id,account_id,customer_id,program_id,pos_order_id,invoice_id,entry_type,pending_delta,available_delta,expires_at,policy_snapshot_json,generation_key) VALUES($1,$2,$3,$4,$5,$6,'EARN_AVAILABLE',$7,$8,$9,$10,$11) ON CONFLICT(tenant_id,generation_key) DO NOTHING RETURNING id`,
        [
          job.tenant_id,
          source.account_id,
          source.customer_id,
          source.program_id,
          source.pos_order_id,
          source.invoice_id,
          (-points).toString(),
          points.toString(),
          source.expires_at,
          JSON.stringify(source.policy_snapshot_json),
          generation,
        ],
      )
    ).rows[0];
    if (!inserted) return;
    await c.query(
      "UPDATE loyalty_accounts SET pending_points=pending_points-$3,available_points=available_points+$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [job.tenant_id, source.account_id, points.toString()],
    );
    await c.query(
      "INSERT INTO loyalty_point_lots(tenant_id,account_id,source_ledger_entry_id,original_points,available_points,expires_at) VALUES($1,$2,$3,$4,$4,$5)",
      [
        job.tenant_id,
        source.account_id,
        inserted.id,
        points.toString(),
        source.expires_at,
      ],
    );
    await this.outbox(
      c,
      job.tenant_id,
      "loyalty.updated",
      "loyalty_account",
      source.account_id,
    );
  }
  private async membership(c: PoolClient, job: any) {
    const customerId = job.payload_json.customerId ?? job.aggregate_id,
      metrics = (
        await c.query<any>(
          "SELECT * FROM customer_membership_metrics WHERE tenant_id=$1 AND customer_id=$2 FOR UPDATE",
          [job.tenant_id, customerId],
        )
      ).rows[0];
    if (!metrics) return;
    const tier = (
      await c.query<any>(
        `SELECT * FROM membership_tiers WHERE tenant_id=$1 AND status='ACTIVE' AND effective_from<=now() AND (effective_to IS NULL OR effective_to>now()) AND ((qualification_type='ROLLING_SPEND' AND qualification_threshold<=$3) OR (qualification_type='VISIT_COUNT' AND qualification_threshold<=$4)) ORDER BY priority DESC LIMIT 1`,
        [
          job.tenant_id,
          customerId,
          metrics.rolling_spend_minor,
          metrics.visit_count,
        ],
      )
    ).rows[0];
    if (!tier) return;
    const current = (
      await c.query<any>(
        "SELECT * FROM customer_membership_assignments WHERE tenant_id=$1 AND customer_id=$2 AND status='ACTIVE' ORDER BY effective_from DESC LIMIT 1 FOR UPDATE",
        [job.tenant_id, customerId],
      )
    ).rows[0];
    if (current?.tier_id === tier.id) return;
    if (current)
      await c.query(
        "UPDATE customer_membership_assignments SET status='SUPERSEDED',effective_to=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [job.tenant_id, current.id],
      );
    const created = (
      await c.query<any>(
        `INSERT INTO customer_membership_assignments(tenant_id,customer_id,tier_id,status,effective_from,benefit_snapshot_json,qualification_snapshot_json,supersedes_assignment_id,reason_code) VALUES($1,$2,$3,'ACTIVE',now(),$4,$5,$6,'WORKER_EVALUATION') RETURNING id`,
        [
          job.tenant_id,
          customerId,
          tier.id,
          JSON.stringify(tier.benefits_json),
          JSON.stringify({
            qualificationType: tier.qualification_type,
            threshold: String(tier.qualification_threshold),
            metrics: {
              rollingSpendMinor: String(metrics.rolling_spend_minor),
              visitCount: String(metrics.visit_count),
            },
          }),
          current?.id ?? null,
        ],
      )
    ).rows[0];
    await c.query(
      "UPDATE customer_membership_metrics SET last_evaluated_at=now(),version=version+1 WHERE tenant_id=$1 AND customer_id=$2",
      [job.tenant_id, customerId],
    );
    await this.outbox(
      c,
      job.tenant_id,
      "membership.updated",
      "membership_assignment",
      created.id,
    );
  }
  async expireVoucherReservations() {
    return this.expire(
      `SELECT * FROM voucher_reservations WHERE status='ACTIVE' AND expires_at<=now() ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT 50`,
      async (c, row) => {
        await c.query(
          "UPDATE voucher_reservations SET status='EXPIRED',version=version+1,updated_at=now() WHERE id=$1",
          [row.id],
        );
        await c.query(
          "UPDATE voucher_codes SET reserved_count=reserved_count-1,status=CASE WHEN used_count=0 THEN 'AVAILABLE' ELSE 'PARTIALLY_USED' END,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [row.tenant_id, row.voucher_code_id],
        );
        await c.query(
          "UPDATE voucher_campaigns SET reserved_count=reserved_count-1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [row.tenant_id, row.campaign_id],
        );
        await c.query(
          "UPDATE pos_order_benefit_applications SET status='RELEASED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND reservation_id=$2 AND status='RESERVED'",
          [row.tenant_id, row.id],
        );
        await this.outbox(
          c,
          row.tenant_id,
          "voucher.updated",
          "voucher_reservation",
          row.id,
        );
      },
    );
  }
  async expireLoyaltyReservations() {
    return this.expire(
      `SELECT * FROM loyalty_reservations WHERE status='ACTIVE' AND expires_at<=now() ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT 50`,
      async (c, row) => {
        await c.query(
          "UPDATE loyalty_reservations SET status='EXPIRED',version=version+1,updated_at=now() WHERE id=$1",
          [row.id],
        );
        await c.query(
          "UPDATE loyalty_accounts SET reserved_points=reserved_points-$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [row.tenant_id, row.account_id, row.points],
        );
        await c.query(
          `INSERT INTO loyalty_ledger_entries(tenant_id,account_id,customer_id,reservation_id,pos_order_id,entry_type,reserved_delta,policy_snapshot_json,generation_key) VALUES($1,$2,$3,$4,$5,'REDEEM_RELEASE',$6,$7,$8) ON CONFLICT DO NOTHING`,
          [
            row.tenant_id,
            row.account_id,
            row.customer_id,
            row.id,
            row.pos_order_id,
            -Number(row.points),
            JSON.stringify(row.policy_snapshot_json),
            `loyalty-expire:${row.id}`,
          ],
        );
        await c.query(
          "UPDATE pos_order_benefit_applications SET status='RELEASED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND reservation_id=$2 AND status='RESERVED'",
          [row.tenant_id, row.id],
        );
        await this.outbox(
          c,
          row.tenant_id,
          "loyalty.updated",
          "loyalty_account",
          row.account_id,
        );
      },
    );
  }
  async expirePackageReservations() {
    return this.expire(
      `SELECT * FROM package_reservations WHERE status='ACTIVE' AND expires_at<=now() ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT 50`,
      async (c, row) => {
        await c.query(
          "UPDATE package_reservations SET status='EXPIRED',version=version+1,updated_at=now() WHERE id=$1",
          [row.id],
        );
        await c.query(
          "UPDATE customer_package_entitlements SET available_units=available_units+$3,reserved_units=reserved_units-$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [row.tenant_id, row.entitlement_id, row.units],
        );
        await c.query(
          `INSERT INTO package_ledger_entries(tenant_id,entitlement_id,customer_id,reservation_id,pos_order_id,appointment_id,entry_type,available_delta,reserved_delta,policy_snapshot_json,generation_key) VALUES($1,$2,$3,$4,$5,$6,'RELEASE',$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
          [
            row.tenant_id,
            row.entitlement_id,
            row.customer_id,
            row.id,
            row.pos_order_id,
            row.appointment_id,
            row.units,
            -Number(row.units),
            JSON.stringify(row.policy_snapshot_json),
            `package-expire-reservation:${row.id}`,
          ],
        );
        await c.query(
          "UPDATE pos_order_benefit_applications SET status='RELEASED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND reservation_id=$2 AND status='RESERVED'",
          [row.tenant_id, row.id],
        );
        await this.outbox(
          c,
          row.tenant_id,
          "package.updated",
          "package_entitlement",
          row.entitlement_id,
        );
      },
    );
  }
  async expireVoucherCodes() {
    return this.expire(
      `SELECT * FROM voucher_codes WHERE status IN('AVAILABLE','PARTIALLY_USED') AND expires_at<=now() ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT 50`,
      async (c, row) => {
        await c.query(
          "UPDATE voucher_codes SET status='EXPIRED',version=version+1,updated_at=now() WHERE id=$1",
          [row.id],
        );
        await this.outbox(
          c,
          row.tenant_id,
          "voucher.updated",
          "voucher_code",
          row.id,
        );
      },
    );
  }
  async expireLoyaltyLots() {
    return this.expire(
      `SELECT l.*,a.customer_id FROM loyalty_point_lots l JOIN loyalty_accounts a ON a.tenant_id=l.tenant_id AND a.id=l.account_id WHERE l.status='AVAILABLE' AND l.available_points>0 AND l.expires_at<=now() ORDER BY l.expires_at FOR UPDATE OF l SKIP LOCKED LIMIT 50`,
      async (c, row) => {
        const points = BigInt(row.available_points);
        await c.query(
          "UPDATE loyalty_point_lots SET available_points=0,status='EXPIRED',updated_at=now() WHERE id=$1",
          [row.id],
        );
        await c.query(
          "UPDATE loyalty_accounts SET available_points=available_points-$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [row.tenant_id, row.account_id, points.toString()],
        );
        await c.query(
          `INSERT INTO loyalty_ledger_entries(tenant_id,account_id,customer_id,entry_type,available_delta,policy_snapshot_json,generation_key) VALUES($1,$2,$3,'EXPIRE',$4,$5,$6) ON CONFLICT DO NOTHING`,
          [
            row.tenant_id,
            row.account_id,
            row.customer_id,
            (-points).toString(),
            JSON.stringify({ lotId: row.id, expiresAt: row.expires_at }),
            `loyalty-expire-lot:${row.id}`,
          ],
        );
        await this.outbox(
          c,
          row.tenant_id,
          "loyalty.updated",
          "loyalty_account",
          row.account_id,
        );
      },
    );
  }
  async expirePackages() {
    return this.expire(
      `SELECT * FROM customer_package_entitlements WHERE status='ACTIVE' AND reserved_units=0 AND expires_at<=now() ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT 50`,
      async (c, row) => {
        const units = Number(row.available_units);
        await c.query(
          "UPDATE customer_package_entitlements SET available_units=0,status='EXPIRED',version=version+1,updated_at=now() WHERE id=$1",
          [row.id],
        );
        if (units)
          await c.query(
            `INSERT INTO package_ledger_entries(tenant_id,entitlement_id,customer_id,entry_type,available_delta,policy_snapshot_json,generation_key) VALUES($1,$2,$3,'EXPIRE',$4,$5,$6) ON CONFLICT DO NOTHING`,
            [
              row.tenant_id,
              row.id,
              row.customer_id,
              -units,
              JSON.stringify(row.policy_snapshot_json),
              `package-expire:${row.id}`,
            ],
          );
        await this.outbox(
          c,
          row.tenant_id,
          "package.updated",
          "package_entitlement",
          row.id,
        );
      },
    );
  }
  private async expire(
    sql: string,
    work: (c: PoolClient, row: any) => Promise<void>,
  ) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const rows = (await c.query<any>(sql)).rows;
      for (const row of rows) await work(c, row);
      await c.query("COMMIT");
      return rows.length;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  private outbox(
    c: PoolClient,
    tenantId: string,
    event: string,
    type: string,
    id: string,
  ) {
    return c.query(
      "INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload_json,source,metadata_json) VALUES($1,$2,$3,$4,$5,'worker',$6)",
      [
        tenantId,
        event,
        type,
        id,
        JSON.stringify({ aggregateId: id, refetch: true }),
        JSON.stringify({ schemaVersion: 1, pii: false }),
      ],
    );
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}

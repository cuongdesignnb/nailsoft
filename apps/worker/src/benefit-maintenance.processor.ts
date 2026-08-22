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
    const claim = await this.pool.connect();
    let rows: any[] = [];
    try {
      await claim.query("BEGIN");
      rows = (
        await claim.query<any>(
          `SELECT * FROM benefit_jobs
           WHERE status IN('PENDING','FAILED') AND run_at<=now()
             AND (lease_until IS NULL OR lease_until<now()) AND attempts<max_attempts
           ORDER BY run_at,id FOR UPDATE SKIP LOCKED LIMIT 25`,
        )
      ).rows;
      for (const job of rows) {
        await claim.query(
          "UPDATE benefit_jobs SET status='PROCESSING',lease_until=now()+interval '2 minutes',attempts=attempts+1,updated_at=now() WHERE id=$1",
          [job.id],
        );
        job.attempts = Number(job.attempts) + 1;
      }
      await claim.query("COMMIT");
    } catch (e) {
      await claim.query("ROLLBACK");
      throw e;
    } finally {
      claim.release();
    }
    for (const job of rows) {
      const c = await this.pool.connect();
      try {
        await c.query("BEGIN");
        const leased = (
          await c.query<any>(
            "SELECT * FROM benefit_jobs WHERE id=$1 AND status='PROCESSING' FOR UPDATE",
            [job.id],
          )
        ).rows[0];
        if (!leased) {
          await c.query("ROLLBACK");
          continue;
        }
        try {
          if (leased.job_type === "LOYALTY_SETTLEMENT")
            await this.settle(c, leased);
          else if (leased.job_type === "MEMBERSHIP_EVALUATION")
            await this.membership(c, leased);
          else throw new Error(`UNSUPPORTED_BENEFIT_JOB:${leased.job_type}`);
          await c.query(
            "UPDATE benefit_jobs SET status='COMPLETED',lease_until=NULL,completed_at=now(),last_error_code=NULL,last_error_message=NULL,updated_at=now() WHERE id=$1",
            [leased.id],
          );
          await c.query("COMMIT");
        } catch (error) {
          await c.query("ROLLBACK");
          const message =
            error instanceof Error ? error.message.slice(0, 500) : "unknown";
          await this.pool.query(
            `UPDATE benefit_jobs
             SET status=CASE WHEN attempts>=max_attempts THEN 'DEAD_LETTER' ELSE 'FAILED' END,
                 lease_until=NULL,run_at=now()+make_interval(secs=>LEAST(300,attempts*attempts*15)),
                 last_error_code=$2,last_error_message=$3,updated_at=now()
             WHERE id=$1`,
            [
              leased.id,
              (message.split(":")[0] ?? "UNKNOWN").slice(0, 100),
              message,
            ],
          );
        }
      } finally {
        c.release();
      }
    }
    return rows.length;
  }
  private async settle(c: PoolClient, job: any) {
    const source = (
      await c.query<any>(
        "SELECT * FROM loyalty_ledger_entries WHERE tenant_id=$1 AND generation_key=$2 FOR SHARE",
        [job.tenant_id, job.payload_json.earnGeneration],
      )
    ).rows[0];
    if (!source) return;
    const net = (
      await c.query<any>(
        `SELECT $3::bigint+COALESCE(sum(pending_delta),0) points
         FROM loyalty_ledger_entries
         WHERE tenant_id=$1 AND entry_type='REFUND_REVERSAL'
           AND policy_snapshot_json->>'sourceEarnLedgerEntryId'=$2`,
        [job.tenant_id, source.id, source.pending_delta],
      )
    ).rows[0];
    const points = BigInt(net.points),
      generation = `loyalty-available:${job.aggregate_id}`;
    if (points <= 0n) {
      await c.query(
        "UPDATE benefit_jobs SET payload_json=payload_json||$2::jsonb WHERE id=$1",
        [job.id, JSON.stringify({ settlementResult: "NO_REMAINING_POINTS" })],
      );
      return;
    }
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
          JSON.stringify({
            ...source.policy_snapshot_json,
            sourceEarnLedgerEntryId: source.id,
            settlementResult: "SETTLED_NET_POINTS",
          }),
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
    await c.query(
      "UPDATE benefit_jobs SET payload_json=payload_json||$2::jsonb WHERE id=$1",
      [
        job.id,
        JSON.stringify({
          settlementResult: "SETTLED_NET_POINTS",
          settledPoints: points.toString(),
        }),
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
    const customerId = job.payload_json.customerId ?? job.aggregate_id;
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `membership-evaluation:${job.tenant_id}:${customerId}`,
    ]);
    const maxWindow = Number(
        (
          await c.query<any>(
            `SELECT COALESCE(max(rolling_window_days),365) days FROM membership_tiers
             WHERE tenant_id=$1 AND status='ACTIVE' AND rolling_window_days IS NOT NULL`,
            [job.tenant_id],
          )
        ).rows[0].days,
      ),
      rolling = (
        await c.query<any>(
          "SELECT * FROM sprint8_membership_metrics($1,$2,now(),$3)",
          [job.tenant_id, customerId, maxWindow],
        )
      ).rows[0],
      lifetime = (
        await c.query<any>(
          "SELECT * FROM sprint8_membership_metrics($1,$2,now(),NULL)",
          [job.tenant_id, customerId],
        )
      ).rows[0];
    const lifetimePoints = (
      await c.query<any>(
        "SELECT COALESCE(lifetime_earned_points,0)::bigint lifetime_earned_points FROM loyalty_accounts WHERE tenant_id=$1 AND customer_id=$2",
        [job.tenant_id, customerId],
      )
    ).rows[0]?.lifetime_earned_points ?? 0;
    await c.query(
      `INSERT INTO customer_membership_metrics(
         tenant_id,customer_id,rolling_spend_minor,lifetime_spend_minor,visit_count,points_earned,window_started_at,last_evaluated_at)
       VALUES($1,$2,$3,$4,$5,$6,now()-make_interval(days=>$7),now())
       ON CONFLICT(tenant_id,customer_id) DO UPDATE SET
         rolling_spend_minor=EXCLUDED.rolling_spend_minor,lifetime_spend_minor=EXCLUDED.lifetime_spend_minor,
         visit_count=EXCLUDED.visit_count,points_earned=EXCLUDED.points_earned,window_started_at=EXCLUDED.window_started_at,last_evaluated_at=now(),
         version=customer_membership_metrics.version+1`,
      [
        job.tenant_id,
        customerId,
        rolling.spend_minor,
        lifetime.spend_minor,
        rolling.visit_count,
        lifetimePoints,
        maxWindow,
      ],
    );
    const tier = (
      await c.query<any>(
        `SELECT t.*,m.spend_minor evaluated_spend,m.visit_count evaluated_visits
         FROM membership_tiers t
         CROSS JOIN LATERAL sprint8_membership_metrics(
           $1,$2,now(),CASE WHEN t.qualification_type IN('ROLLING_SPEND','VISIT_COUNT') THEN COALESCE(t.rolling_window_days,365) ELSE NULL END
         ) m
         WHERE t.tenant_id=$1 AND t.status='ACTIVE' AND t.qualification_type<>'MANUAL'
           AND t.effective_from<=now() AND (t.effective_to IS NULL OR t.effective_to>now())
           AND ((t.qualification_type IN('ROLLING_SPEND','LIFETIME_SPEND') AND t.qualification_threshold<=m.spend_minor)
             OR (t.qualification_type='VISIT_COUNT' AND t.qualification_threshold<=m.visit_count)
             OR (t.qualification_type='POINTS_EARNED' AND t.qualification_threshold<=COALESCE((SELECT lifetime_earned_points FROM loyalty_accounts WHERE tenant_id=$1 AND customer_id=$2),0)))
         ORDER BY t.priority DESC,t.qualification_threshold DESC LIMIT 1`,
        [job.tenant_id, customerId],
      )
    ).rows[0];
    const current = (
      await c.query<any>(
        `SELECT a.*,t.priority FROM customer_membership_assignments a
         JOIN membership_tiers t ON t.tenant_id=a.tenant_id AND t.id=a.tier_id
          WHERE a.tenant_id=$1 AND a.customer_id=$2 AND a.status='ACTIVE'
            AND a.effective_from<=now() AND (a.effective_to IS NULL OR a.effective_to>now())
         ORDER BY a.effective_from DESC LIMIT 1 FOR UPDATE OF a`,
        [job.tenant_id, customerId],
      )
    ).rows[0];
    if (current?.assignment_source === "MANUAL") return;
    if (tier && current?.tier_id === tier.id) return;
    if (
      current?.grace_until &&
      new Date(current.grace_until) > new Date() &&
      (!tier || Number(tier.priority) < Number(current.priority ?? 0))
    )
      return;
    if (current)
      await c.query(
        "UPDATE customer_membership_assignments SET status='SUPERSEDED',effective_to=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [job.tenant_id, current.id],
      );
    if (!tier) {
      if (current)
        await this.outbox(
          c,
          job.tenant_id,
          "membership.updated",
          "membership_assignment",
          current.id,
        );
      return;
    }
    const created = (
      await c.query<any>(
        `INSERT INTO customer_membership_assignments(tenant_id,customer_id,tier_id,status,effective_from,benefit_snapshot_json,qualification_snapshot_json,supersedes_assignment_id,reason_code,assignment_source) VALUES($1,$2,$3,'ACTIVE',now(),$4,$5,$6,$7,'AUTOMATIC') RETURNING id`,
        [
          job.tenant_id,
          customerId,
          tier.id,
          JSON.stringify(tier.benefits_json),
          JSON.stringify({
            qualificationType: tier.qualification_type,
            threshold: String(tier.qualification_threshold),
            metrics: {
              rollingSpendMinor: String(tier.evaluated_spend),
              visitCount: String(tier.evaluated_visits),
              pointsEarned: String(lifetimePoints),
            },
          }),
          current?.id ?? null,
          current
            ? Number(tier.priority) > Number(current.priority ?? 0)
              ? "AUTOMATIC_UPGRADE"
              : "AUTOMATIC_DOWNGRADE"
            : "AUTOMATIC_ASSIGN",
        ],
      )
    ).rows[0];
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
          "UPDATE voucher_customer_usage SET active_reservations=GREATEST(active_reservations-1,0),version=version+1,updated_at=now() WHERE tenant_id=$1 AND campaign_id=$2 AND customer_id=$3",
          [row.tenant_id, row.campaign_id, row.customer_id],
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
        const allocations = (
          await c.query<any>(
            `SELECT a.*,l.expires_at FROM loyalty_redemption_lot_allocations a
             JOIN loyalty_point_lots l ON l.tenant_id=a.tenant_id AND l.id=a.lot_id
             WHERE a.tenant_id=$1 AND a.reservation_id=$2 AND a.status='RESERVED'
             ORDER BY a.created_at,a.id FOR UPDATE OF a,l`,
            [row.tenant_id, row.id],
          )
        ).rows;
        let expiredPoints = 0n;
        for (const allocation of allocations) {
          const points = BigInt(allocation.points),
            valid =
              !allocation.expires_at ||
              new Date(allocation.expires_at) > new Date();
          await c.query(
            `UPDATE loyalty_point_lots SET reserved_points=reserved_points-$3,
               available_points=available_points+CASE WHEN $4 THEN $3 ELSE 0 END,
               status=CASE WHEN $4 THEN 'AVAILABLE' WHEN reserved_points-$3=0 THEN 'EXPIRED' ELSE 'RESERVED' END,
               updated_at=now() WHERE tenant_id=$1 AND id=$2`,
            [row.tenant_id, allocation.lot_id, points.toString(), valid],
          );
          await c.query(
            `UPDATE loyalty_redemption_lot_allocations
             SET status=CASE WHEN $3 THEN 'RELEASED' ELSE 'EXPIRED' END,released_at=now()
             WHERE tenant_id=$1 AND id=$2`,
            [row.tenant_id, allocation.id, valid],
          );
          if (!valid) expiredPoints += points;
        }
        await c.query(
          "UPDATE loyalty_reservations SET status='EXPIRED',version=version+1,updated_at=now() WHERE id=$1",
          [row.id],
        );
        await c.query(
          "UPDATE loyalty_accounts SET reserved_points=reserved_points-$3,available_points=available_points-$4,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [
            row.tenant_id,
            row.account_id,
            row.points,
            expiredPoints.toString(),
          ],
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
      `SELECT r.* FROM package_reservations r
       LEFT JOIN appointments a ON a.tenant_id=r.tenant_id AND a.id=r.appointment_id
       WHERE r.status='ACTIVE' AND (
         (r.appointment_id IS NULL AND r.expires_at<=now())
         OR a.status IN('CANCELLED_BY_CUSTOMER','CANCELLED_BY_SALON','EXPIRED')
         OR (a.status NOT IN('CHECKED_IN','IN_SERVICE','PARTIALLY_COMPLETED','COMPLETED','CANCELLED_BY_CUSTOMER','CANCELLED_BY_SALON','EXPIRED') AND r.expires_at<=now())
         OR (a.status='COMPLETED' AND GREATEST(r.expires_at,a.updated_at+interval '24 hours')<=now())
       ) ORDER BY r.expires_at FOR UPDATE OF r SKIP LOCKED LIMIT 50`,
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
      `SELECT l.*,a.customer_id FROM loyalty_point_lots l
       JOIN loyalty_accounts a ON a.tenant_id=l.tenant_id AND a.id=l.account_id
       WHERE l.status IN('AVAILABLE','RESERVED') AND l.available_points>0 AND l.expires_at<=now()
       ORDER BY l.expires_at FOR UPDATE OF l SKIP LOCKED LIMIT 50`,
      async (c, row) => {
        const points = BigInt(row.available_points);
        await c.query(
          "UPDATE loyalty_point_lots SET available_points=0,status=CASE WHEN reserved_points>0 THEN 'RESERVED' ELSE 'EXPIRED' END,updated_at=now() WHERE id=$1",
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
      let completed = 0;
      for (const row of rows) {
        await c.query("SAVEPOINT benefit_expiry_row");
        try {
          await work(c, row);
          await c.query("RELEASE SAVEPOINT benefit_expiry_row");
          completed += 1;
        } catch {
          await c.query("ROLLBACK TO SAVEPOINT benefit_expiry_row");
          await c.query("RELEASE SAVEPOINT benefit_expiry_row");
        }
      }
      await c.query("COMMIT");
      return completed;
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

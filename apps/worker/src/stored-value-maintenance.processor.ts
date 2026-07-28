/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import pg, { type PoolClient } from "pg";

@Injectable()
export class StoredValueMaintenanceProcessor implements OnModuleDestroy {
  private readonly pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
    max: 2,
  });

  async run() {
    const counts = await Promise.all([
      this.expireReservations(),
      this.deliveryRequests(),
      this.exportJobs(),
      this.dailySnapshots(),
      this.reconcile(),
    ]);
    return counts.reduce((sum, value) => sum + value, 0);
  }

  async expireReservations() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const rows = (
        await client.query<any>(
          `SELECT r.*,a.available_minor,a.reserved_minor,a.redeemed_minor,a.pending_minor,
                  a.expired_minor,a.cancelled_minor,a.lifetime_issued_minor,a.lifetime_redeemed_minor,
                  o.branch_id,o.status order_status
             FROM stored_value_reservations r
             JOIN stored_value_accounts a ON a.tenant_id=r.tenant_id AND a.id=r.account_id
             JOIN pos_orders o ON o.tenant_id=r.tenant_id AND o.id=r.order_id
            WHERE r.status='ACTIVE' AND r.expires_at<now()
            ORDER BY r.expires_at,r.id FOR UPDATE OF r,a,o SKIP LOCKED LIMIT 100`,
        )
      ).rows;
      for (const row of rows) {
        const amount = BigInt(row.accepted_minor);
        const ledger = await client.query(
          `INSERT INTO stored_value_ledger_entries(
             tenant_id,account_id,entry_type,available_delta_minor,reserved_delta_minor,currency,
             order_id,reservation_id,policy_snapshot_json,generation_key)
           VALUES($1,$2,'RELEASE',$3,$4,$5,$6,$7,'{"reason":"TTL_EXPIRED"}',$8)
           ON CONFLICT(tenant_id,account_id,generation_key) DO NOTHING RETURNING id`,
          [
            row.tenant_id,
            row.account_id,
            amount.toString(),
            (-amount).toString(),
            row.currency,
            row.order_id,
            row.id,
            `expire:${row.id}`,
          ],
        );
        if (!ledger.rowCount) continue;
        await client.query(
          "SELECT set_config('app.stored_value_posting','on',true)",
        );
        await client.query(
          `UPDATE stored_value_accounts
              SET available_minor=available_minor+$3,reserved_minor=reserved_minor-$3,
                  version=version+1,updated_at=now()
            WHERE tenant_id=$1 AND id=$2`,
          [row.tenant_id, row.account_id, amount.toString()],
        );
        await client.query(
          "SELECT set_config('app.stored_value_posting','off',true)",
        );
        await client.query(
          "UPDATE stored_value_reservations SET status='EXPIRED',released_at=now(),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [row.tenant_id, row.id],
        );
        await client.query(
          "UPDATE pos_order_stored_value_applications SET status='EXPIRED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND reservation_id=$2",
          [row.tenant_id, row.id],
        );
        if (
          ["DRAFT", "READY_FOR_PAYMENT", "PARTIALLY_PAID"].includes(
            row.order_status,
          )
        )
          await client.query(
            `UPDATE pos_orders SET amount_paid_minor=amount_paid_minor-$3,amount_due_minor=amount_due_minor+$3,
                    status=CASE WHEN amount_paid_minor-$3=0 THEN 'DRAFT' ELSE 'PARTIALLY_PAID' END,
                    version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
            [row.tenant_id, row.order_id, amount.toString()],
          );
        await this.outbox(
          client,
          row.tenant_id,
          row.branch_id,
          "stored_value.released",
          "stored_value_reservation",
          row.id,
        );
      }
      await client.query("COMMIT");
      return rows.length;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deliveryRequests() {
    const result = await this.pool.query(
      `UPDATE gift_card_delivery_requests
          SET status=CASE WHEN channel='PRINT' THEN 'SENT' WHEN attempts>=4 THEN 'DEAD_LETTER' ELSE 'FAILED' END,
              attempts=attempts+1,lease_until=NULL,
              safe_error_json=CASE WHEN channel='PRINT' THEN '{}' ELSE '{"code":"DELIVERY_PROVIDER_DISABLED"}' END,
              updated_at=now()
        WHERE id IN (
          SELECT id FROM gift_card_delivery_requests
           WHERE status IN('PENDING','FAILED') AND (lease_until IS NULL OR lease_until<now())
           ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 25
        )`,
    );
    return result.rowCount ?? 0;
  }

  async exportJobs() {
    const result = await this.pool.query(
      `UPDATE stored_value_export_jobs
          SET status='COMPLETED',attempts=attempts+1,lease_until=NULL,
              result_storage_key='exports/'||tenant_id||'/stored-value/'||id||'.csv',updated_at=now()
        WHERE id IN (
          SELECT id FROM stored_value_export_jobs
           WHERE status IN('PENDING','FAILED') AND (lease_until IS NULL OR lease_until<now())
           ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 25
        )`,
    );
    return result.rowCount ?? 0;
  }

  async dailySnapshots() {
    const result = await this.pool.query(
      `INSERT INTO stored_value_liability_daily_snapshots(
         tenant_id,snapshot_date,currency,gift_card_available_minor,gift_card_reserved_minor,
         customer_credit_available_minor,customer_credit_reserved_minor,opening_liability_minor,
         inflow_minor,outflow_minor,closing_liability_minor,generation_key)
       SELECT a.tenant_id,CURRENT_DATE,a.currency,
         COALESCE(sum(a.available_minor) FILTER(WHERE a.account_type='GIFT_CARD'),0),
         COALESCE(sum(a.reserved_minor) FILTER(WHERE a.account_type='GIFT_CARD'),0),
         COALESCE(sum(a.available_minor) FILTER(WHERE a.account_type='CUSTOMER_CREDIT'),0),
         COALESCE(sum(a.reserved_minor) FILTER(WHERE a.account_type='CUSTOMER_CREDIT'),0),
         sum(a.available_minor+a.reserved_minor)-flow.inflow+flow.outflow,
         flow.inflow,flow.outflow,sum(a.available_minor+a.reserved_minor),
         'liability:'||CURRENT_DATE||':'||a.currency
       FROM stored_value_accounts a
       CROSS JOIN LATERAL (
         SELECT COALESCE(sum(GREATEST(available_delta_minor+reserved_delta_minor,0)),0) inflow,
                COALESCE(sum(GREATEST(-(available_delta_minor+reserved_delta_minor),0)),0) outflow
           FROM stored_value_ledger_entries l
          WHERE l.tenant_id=a.tenant_id AND l.currency=a.currency AND l.occurred_at>=CURRENT_DATE
       ) flow
       GROUP BY a.tenant_id,a.currency,flow.inflow,flow.outflow
       ON CONFLICT(tenant_id,snapshot_date,currency) DO NOTHING`,
    );
    return result.rowCount ?? 0;
  }

  async reconcile() {
    const result = await this.pool.query(
      `INSERT INTO stored_value_reconciliation_exceptions(
         tenant_id,account_id,exception_type,currency,expected_minor,actual_minor,details_json,generation_key)
       SELECT a.tenant_id,a.id,'ACCOUNT_LEDGER_MISMATCH',a.currency,
              a.pending_minor+a.available_minor+a.reserved_minor+a.redeemed_minor+a.expired_minor+a.cancelled_minor,
              COALESCE(sum(l.pending_delta_minor+l.available_delta_minor+l.reserved_delta_minor+l.redeemed_delta_minor+l.expired_delta_minor+l.cancelled_delta_minor),0),
              jsonb_build_object('accountType',a.account_type),
              'reconcile:'||a.id||':'||a.version
         FROM stored_value_accounts a
         LEFT JOIN stored_value_ledger_entries l ON l.tenant_id=a.tenant_id AND l.account_id=a.id
        GROUP BY a.tenant_id,a.id
       HAVING a.pending_minor+a.available_minor+a.reserved_minor+a.redeemed_minor+a.expired_minor+a.cancelled_minor<>
              COALESCE(sum(l.pending_delta_minor+l.available_delta_minor+l.reserved_delta_minor+l.redeemed_delta_minor+l.expired_delta_minor+l.cancelled_delta_minor),0)
       ON CONFLICT(tenant_id,generation_key) DO NOTHING`,
    );
    return result.rowCount ?? 0;
  }

  private outbox(
    client: PoolClient,
    tenantId: string,
    branchId: string,
    event: string,
    type: string,
    id: string,
  ) {
    return client.query(
      `INSERT INTO outbox_events(tenant_id,branch_id,event_type,aggregate_type,aggregate_id,payload_json,actor_json,metadata_json)
       VALUES($1,$2,$3,$4,$5,$6,'{"type":"SYSTEM"}','{"schemaVersion":1,"pii":false}')`,
      [
        tenantId,
        branchId,
        event,
        type,
        id,
        JSON.stringify({ aggregateId: id, branchId, refetch: true }),
      ],
    );
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}

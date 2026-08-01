/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import pg from "pg";
import { createVendorPaymentProvider, type VendorPaymentOutcome, type VendorPaymentProvider } from "./vendor-payment.provider.js";

@Injectable()
export class VendorPaymentProcessor implements OnModuleDestroy {
  private readonly pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft", max: 2 });
  private readonly workerId = `vendor-payment-worker:${process.pid}`;
  private readonly provider: VendorPaymentProvider = createVendorPaymentProvider();

  async run() {
    const c = await this.pool.connect();
    let claimed: any[] = [];
    try {
      await c.query("BEGIN");
      claimed = (await c.query<any>("SELECT * FROM procurement_vendor_payments WHERE status='APPROVED' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 25")).rows;
      for (const row of claimed) {
        const attempt = (await c.query<any>("SELECT COALESCE(max(attempt_no),0)+1 attempt_no FROM procurement_vendor_payment_attempts WHERE tenant_id=$1 AND vendor_payment_id=$2", [row.tenant_id, row.id])).rows[0].attempt_no;
        await c.query("UPDATE procurement_vendor_payments SET status='PROCESSING',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='APPROVED'", [row.tenant_id, row.id]);
        await c.query("INSERT INTO procurement_vendor_payment_attempts(tenant_id,vendor_payment_id,attempt_no,provider_key,status) VALUES($1,$2,$3,$4,'CLAIMED')", [row.tenant_id, row.id, attempt, row.provider_key]);
      }
      await c.query("COMMIT");
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally { c.release(); }
    for (const row of claimed) await this.processOutsideTransaction(row);
    return claimed.length;
  }

  private async processOutsideTransaction(row: any) {
    let outcome: VendorPaymentOutcome;
    try { outcome = await this.provider.process(row); }
    catch (error) { outcome = { status: "FAILED", evidence: { code: error instanceof Error ? error.message : "PROVIDER_ERROR" } }; }
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const current = (await c.query<any>("SELECT * FROM procurement_vendor_payments WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [row.tenant_id, row.id])).rows[0];
      if (!current || current.status !== "PROCESSING") { await c.query("COMMIT"); return; }
      if (outcome.status === "SUCCEEDED") await this.applyAllocations(c, current);
      await c.query("UPDATE procurement_vendor_payments SET status=$3,evidence_hash=encode(digest($4,'sha256'),'hex'),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2", [row.tenant_id, row.id, outcome.status, JSON.stringify(outcome)]);
      await c.query("UPDATE procurement_vendor_payment_attempts SET status=$3,external_reference=$4,evidence_json=$5 WHERE tenant_id=$1 AND vendor_payment_id=$2 AND status='CLAIMED'", [row.tenant_id, row.id, outcome.status, outcome.externalReference ?? null, JSON.stringify(outcome.evidence ?? {})]);
      await c.query("COMMIT");
    } catch (error) { await c.query("ROLLBACK"); throw error; }
    finally { c.release(); }
  }

  private async applyAllocations(c: pg.PoolClient, payment: any) {
    for (const allocation of payment.allocation_plan_json ?? []) {
      const open = (await c.query<any>("SELECT * FROM procurement_ap_open_items WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [payment.tenant_id, allocation.openItemId])).rows[0];
      if (!open) throw new Error("AP_OPEN_ITEM_NOT_FOUND");
      const due = BigInt(open.original_minor) - BigInt(open.paid_minor) - BigInt(open.credited_minor) - BigInt(open.written_off_minor);
      const amount = BigInt(allocation.amountMinor);
      if (amount <= 0n || amount > due) throw new Error("AP_PAYMENT_ALLOCATION_CAP_EXCEEDED");
      await c.query("INSERT INTO procurement_vendor_payment_allocations(tenant_id,vendor_payment_id,open_item_id,amount_minor) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [payment.tenant_id, payment.id, allocation.openItemId, amount.toString()]);
      await c.query("INSERT INTO procurement_ap_allocations(tenant_id,open_item_id,allocation_type,source_id,amount_minor) VALUES($1,$2,'PAYMENT',$3,$4) ON CONFLICT DO NOTHING", [payment.tenant_id, allocation.openItemId, payment.id, amount.toString()]);
      await c.query("UPDATE procurement_ap_open_items SET paid_minor=paid_minor+$3,status=CASE WHEN paid_minor+$3>=original_minor THEN 'PAID' ELSE 'PARTIALLY_PAID' END,updated_at=now() WHERE tenant_id=$1 AND id=$2", [payment.tenant_id, allocation.openItemId, amount.toString()]);
    }
  }

  async onModuleDestroy() { await this.pool.end(); }
}

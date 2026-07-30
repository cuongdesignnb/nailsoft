import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/main";
import { DatabaseService } from "../../apps/api/src/infrastructure/database.service";

const tenant = "10000000-0000-4000-8000-000000000001";
const branch = "20000000-0000-4000-8000-000000000001";
const registerA = "a1000000-0000-4000-8000-000000000001";
const registerB = "c1000000-0000-4000-8000-000000000006";
const cashSessionA = "a3000000-0000-4000-8000-000000000001";
const cashierA = "30000000-0000-4000-8000-000000000016";
const cashierB = "30000000-0000-4000-8000-000000000002";
const run = `s6-reconciliation-${Date.now()}`;

let app: Awaited<ReturnType<typeof createApp>>;
let db: DatabaseService;
let token = "";

describe.sequential(
  "Sprint 6 register and capture-actor reconciliation",
  () => {
    beforeAll(async () => {
      app = await createApp();
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      db = app.get(DatabaseService);
      const login = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          tenantSlug: "nailsoft-demo",
          email: "accountant@example.test",
          password: "DemoPass123!",
          deviceId: `${run}-accountant`,
          deviceName: "Reconciliation test",
          platform: "web",
        },
      });
      expect(login.statusCode, login.body).toBe(200);
      token = login.json().data.accessToken;

      await db.query(
        `INSERT INTO pos_registers(id,tenant_id,branch_id,code,name,status,device_binding_required)
       VALUES($1,$2,$3,'RECON-B','Reconciliation B','ACTIVE',false)`,
        [registerB, tenant, branch],
      );
      const orders = [
        [
          "c4000000-0000-4000-8000-000000000001",
          registerA,
          "RECON-A-BANK",
          40_000,
        ],
        [
          "c4000000-0000-4000-8000-000000000002",
          registerA,
          "RECON-A-CARD",
          20_000,
        ],
        [
          "c4000000-0000-4000-8000-000000000003",
          registerB,
          "RECON-B-OTHER",
          30_000,
        ],
        [
          "c4000000-0000-4000-8000-000000000004",
          registerA,
          "RECON-A-CASH",
          10_000,
        ],
      ] as const;
      for (const [id, registerId, number, amount] of orders)
        await db.query(
          `INSERT INTO pos_orders(
          id,tenant_id,branch_id,register_id,order_number,source,status,currency,
          subtotal_minor,taxable_minor,total_minor,amount_paid_minor,amount_due_minor,
          pricing_snapshot_json,tax_snapshot_json,customer_snapshot_json,pricing_locked_at,
          finalized_at,paid_at,created_by_user_id,updated_by_user_id)
         VALUES($1,$2,$3,$4,$5,'MANUAL','PAID','VND',$6,0,$6,$6,0,'{}','{}','{}',now(),now(),now(),$7,$7)`,
          [id, tenant, branch, registerId, number, amount, cashierA],
        );

      const payments = [
        [
          "c6000000-0000-4000-8000-000000000001",
          orders[0][0],
          registerA,
          "BANK_TRANSFER",
          40_000,
          cashierA,
        ],
        [
          "c6000000-0000-4000-8000-000000000002",
          orders[1][0],
          registerA,
          "CARD_EXTERNAL",
          20_000,
          cashierB,
        ],
        [
          "c6000000-0000-4000-8000-000000000003",
          orders[2][0],
          registerB,
          "OTHER_EXTERNAL",
          30_000,
          cashierB,
        ],
        [
          "c6000000-0000-4000-8000-000000000004",
          orders[3][0],
          registerA,
          "CASH",
          10_000,
          cashierA,
        ],
      ] as const;
      for (const [id, orderId, registerId, tender, amount, actor] of payments) {
        await db.query(
          `INSERT INTO payments(
          id,tenant_id,branch_id,register_id,pos_order_id,payment_reference,tender_type,status,
          currency,requested_minor,captured_minor,provider,provider_transaction_id,
          cash_session_id,idempotency_key_hash,request_hash,created_by_user_id,captured_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,'CAPTURED','VND',$8,$8,'closure-fixture',$9,$10,'fixture','fixture',$11,now())`,
          [
            id,
            tenant,
            branch,
            registerId,
            orderId,
            `PAY-${id}`,
            tender,
            amount,
            `${run}-${id}`,
            tender === "CASH" ? cashSessionA : null,
            actor,
          ],
        );
        await db.query(
          `INSERT INTO payment_allocations(tenant_id,payment_id,pos_order_id,allocation_type,amount_minor)
         VALUES($1,$2,$3,'ORDER_TOTAL',$4)`,
          [tenant, id, orderId, amount],
        );
      }
      for (let index = 0; index < orders.length; index++) {
        const [orderId, , , amount] = orders[index]!;
        await db.query(
          `INSERT INTO invoices(
          tenant_id,branch_id,pos_order_id,invoice_number,status,currency,subtotal_minor,
          discount_minor,taxable_minor,tax_minor,total_minor,tip_minor,paid_minor,
          customer_snapshot_json,branch_snapshot_json,tax_snapshot_json,issued_at,issued_by_user_id)
         VALUES($1,$2,$3,$4,'ISSUED','VND',$5,0,0,0,$5,0,$5,'{}','{}','{}',now(),$6)`,
          [tenant, branch, orderId, `CLOSURE-${index + 1}`, amount, cashierA],
        );
      }
      await db.query(
        `INSERT INTO payments(
        tenant_id,branch_id,register_id,pos_order_id,payment_reference,tender_type,status,currency,
        requested_minor,captured_minor,provider,provider_transaction_id,failure_code,failure_message,
        idempotency_key_hash,request_hash,created_by_user_id,failed_at)
       VALUES($1,$2,$3,$4,$5,'CARD_EXTERNAL','FAILED','VND',1,0,'closure-fixture',$6,'DECLINED','Test decline','fixture-failed','fixture-failed',$7,now())`,
        [
          tenant,
          branch,
          registerA,
          orders[0][0],
          `FAILED-${run}`,
          `failed-${run}`,
          cashierB,
        ],
      );
    });

    afterAll(async () => {
      if (app) await app.close();
    });

    async function report(extra = "") {
      const response = await app.inject({
        method: "GET",
        url: `/v1/financial/reconciliation/daily?branchId=${branch}${extra}`,
        headers: {
          authorization: `Bearer ${token}`,
          "x-tenant-id": tenant,
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      return response.json().data;
    }

    const mixTotal = (value: {
      paymentMix: Record<string, { amountMinor: number }>;
    }) =>
      Object.values(value.paymentMix).reduce(
        (sum, row) => sum + Number(row.amountMinor),
        0,
      );

    it("includes cash, card and bank by immutable register attribution", async () => {
      const a = await report(`&registerId=${registerA}`);
      const b = await report(`&registerId=${registerB}`);
      const all = await report();
      expect(a.paymentMix.CASH.amountMinor).toBeGreaterThan(0);
      expect(a.paymentMix.CARD_EXTERNAL.amountMinor).toBeGreaterThan(0);
      expect(a.paymentMix.BANK_TRANSFER.amountMinor).toBe(40_000);
      expect(b.paymentMix.OTHER_EXTERNAL.amountMinor).toBe(30_000);
      expect(a.totalCollectedMinor + b.totalCollectedMinor).toBe(
        all.totalCollectedMinor,
      );
      expect(mixTotal(a)).toBe(a.totalCollectedMinor);
      expect(a.serviceCollectedMinor + a.tipCollectedMinor).toBe(
        a.totalCollectedMinor,
      );
    });

    it("uses payment capture actor consistently for cashier filters", async () => {
      const a = await report(`&cashierUserId=${cashierA}`);
      const b = await report(`&cashierUserId=${cashierB}`);
      const all = await report();
      expect(a.filters.cashierSemantics).toBe("PAYMENT_CAPTURE_ACTOR");
      expect(a.totalCollectedMinor + b.totalCollectedMinor).toBe(
        all.totalCollectedMinor,
      );
      expect(b.failedPayments).toBe(1);
      expect(a.failedPayments).toBe(0);
    });

    it("matches report invariants against raw captured evidence", async () => {
      const reportData = await report();
      const raw = (
        await db.query<{
          total: string;
          cash: string;
          service_sales: string;
          tips: string;
        }>(
          `SELECT COALESCE(sum(captured_minor),0)::text total,
                COALESCE(sum(captured_minor) FILTER(WHERE tender_type='CASH'),0)::text cash,
                (SELECT COALESCE(sum(il.net_minor),0)::text
                   FROM invoices i
                   JOIN invoice_lines il ON il.tenant_id=i.tenant_id AND il.invoice_id=i.id
                   JOIN pos_order_lines pol ON pol.tenant_id=il.tenant_id AND pol.id=il.source_order_line_id
                  WHERE i.tenant_id=$1 AND i.branch_id=$2 AND i.status='ISSUED'
                    AND i.issued_at >= $3 AND i.issued_at < $4
                    AND pol.line_type<>'GIFT_CARD') service_sales,
                (SELECT COALESCE(sum(tip_minor),0)::text FROM invoices
                  WHERE tenant_id=$1 AND branch_id=$2 AND status='ISSUED'
                    AND issued_at >= $3 AND issued_at < $4) tips
           FROM payments WHERE tenant_id=$1 AND branch_id=$2 AND status='CAPTURED'
             AND captured_at >= $3 AND captured_at < $4`,
          [tenant, branch, reportData.range.startUtc, reportData.range.endUtc],
        )
      ).rows[0]!;
      expect(reportData.totalCollectedMinor).toBe(Number(raw.total));
      expect(reportData.paymentMix.CASH.amountMinor).toBe(Number(raw.cash));
      expect(reportData.serviceSalesMinor).toBe(Number(raw.service_sales));
      expect(reportData.tipMinor).toBe(Number(raw.tips));
      expect(mixTotal(reportData)).toBe(reportData.totalCollectedMinor);
    });
  },
);

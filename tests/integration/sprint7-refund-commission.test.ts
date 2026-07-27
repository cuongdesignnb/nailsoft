import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/main";
import { DatabaseService } from "../../apps/api/src/infrastructure/database.service";

const tenant = "10000000-0000-4000-8000-000000000001";
const branch = "20000000-0000-4000-8000-000000000001";
const seededRefund = "b3000000-0000-4000-8000-000000000001";
const invoice = "a9000000-0000-4000-8000-000000000002";
const payment = "a6000000-0000-4000-8000-000000000003";
const session = "a3000000-0000-4000-8000-000000000001";
const run = `s7-${Date.now()}`;
let app: Awaited<ReturnType<typeof createApp>>;
let db: DatabaseService;
let owner = "",
  manager = "",
  cashier = "",
  technician = "",
  platform = "";

async function login(email: string, device: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: {
      tenantSlug: "nailsoft-demo",
      email,
      password: "DemoPass123!",
      deviceId: `${run}-${device}`,
      deviceName: "Sprint 7 integration",
      platform: "web",
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().data.accessToken as string;
}
const headers = (token: string, key = crypto.randomUUID()) => ({
  authorization: `Bearer ${token}`,
  "x-tenant-id": tenant,
  "idempotency-key": key,
});

describe.sequential(
  "Sprint 7 refund, credit note and commission safety",
  () => {
    beforeAll(async () => {
      app = await createApp();
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      db = app.get(DatabaseService);
      [owner, manager, cashier, technician, platform] = await Promise.all([
        login("owner@example.test", "owner"),
        login("staff2@example.test", "manager"),
        login("cashier@example.test", "cashier"),
        login("staff5@example.test", "technician"),
        login("platform-e2e@example.test", "platform"),
      ]);
    });
    afterAll(async () => {
      if (app) await app.close();
    });

    it("enforces role scope, own commission privacy and platform denial", async () => {
      const own = await app.inject({
        method: "GET",
        url: "/v1/staff/me/commissions",
        headers: headers(technician),
      });
      expect(own.statusCode, own.body).toBe(200);
      const branchEntries = await app.inject({
        method: "GET",
        url: "/v1/commission-entries",
        headers: headers(technician),
      });
      expect(branchEntries.statusCode).toBe(403);
      const platformRefunds = await app.inject({
        method: "GET",
        url: "/v1/refunds",
        headers: headers(platform),
      });
      expect(platformRefunds.statusCode).toBe(403);
    });

    it("denies self approval and preserves original invoice/payment through confirmed cash refund", async () => {
      const self = await app.inject({
        method: "POST",
        url: `/v1/refunds/${seededRefund}/approve`,
        headers: headers(cashier),
        payload: { version: 1, reason: "Self approval attempt" },
      });
      expect(self.statusCode).toBe(403);
      const approveKey = `${run}-approve-seeded`;
      const approved = await app.inject({
        method: "POST",
        url: `/v1/refunds/${seededRefund}/approve`,
        headers: headers(manager, approveKey),
        payload: { version: 1, reason: "Manager evidence review" },
      });
      expect(approved.statusCode, approved.body).toBe(201);
      const replay = await app.inject({
        method: "POST",
        url: `/v1/refunds/${seededRefund}/approve`,
        headers: headers(manager, approveKey),
        payload: { version: 1, reason: "Manager evidence review" },
      });
      expect(replay.statusCode, replay.body).toBe(201);
      expect(replay.json().data.idempotencyReplayed).toBe(true);
      const executed = await app.inject({
        method: "POST",
        url: `/v1/refunds/${seededRefund}/execute-cash`,
        headers: headers(manager),
        payload: {
          version: approved.json().data.version,
          cashSessionId: session,
        },
      });
      expect(executed.statusCode, executed.body).toBe(201);
      expect(executed.json().data.status).toBe("COMPLETED");
      expect(executed.json().data.creditNote.status).toBe("ISSUED");
      const evidence = (
        await db.query<{
          invoice_status: string;
          payment_status: string;
          movement: string;
          notes: number;
        }>(
          `SELECT (SELECT status FROM invoices WHERE tenant_id=$1 AND id=$2) invoice_status,
              (SELECT status FROM payments WHERE tenant_id=$1 AND id=$3) payment_status,
              (SELECT movement_type FROM cash_movements WHERE tenant_id=$1 AND related_refund_id=$4) movement,
              (SELECT count(*)::int FROM credit_notes WHERE tenant_id=$1 AND refund_id=$4) notes`,
          [tenant, invoice, payment, seededRefund],
        )
      ).rows[0]!;
      expect(evidence).toEqual({
        invoice_status: "ISSUED",
        payment_status: "CAPTURED",
        movement: "CASH_REFUND",
        notes: 1,
      });
      await expect(
        db.query(
          "UPDATE credit_notes SET total_minor=1 WHERE tenant_id=$1 AND refund_id=$2",
          [tenant, seededRefund],
        ),
      ).rejects.toThrow();
    });

    it("serializes concurrent cash executions against one captured payment balance", async () => {
      const ids = [
        "b3000000-0000-4000-8000-000000000011",
        "b3000000-0000-4000-8000-000000000012",
      ];
      for (const [index, id] of ids.entries()) {
        await db.query(
          `INSERT INTO refunds(id,tenant_id,branch_id,invoice_id,pos_order_id,refund_reference,status,currency,requested_minor,approved_minor,
           service_refund_minor,tax_refund_minor,tip_refund_minor,reason_code,reason_text,policy_snapshot_json,requested_by_user_id,approved_by_user_id,approved_at)
         VALUES($1,$2,$3,$4,'a4000000-0000-4000-8000-000000000004',$5,'APPROVED','VND',30000,30000,30000,0,0,'RACE','Concurrent balance test','{"requireDualControl":true}',
           '30000000-0000-4000-8000-000000000016','30000000-0000-4000-8000-000000000002',now())`,
          [id, tenant, branch, invoice, `RF-RACE-${index}`],
        );
        await db.query(
          `INSERT INTO refund_items(tenant_id,refund_id,item_type,invoice_line_id,quantity,gross_refund_minor,taxable_refund_minor,tax_refund_minor,total_refund_minor,source_snapshot_json)
         VALUES($1,$2,'INVOICE_LINE','aa000000-0000-4000-8000-000000000001',0.3,30000,30000,0,30000,'{}')`,
          [tenant, id],
        );
        await db.query(
          `INSERT INTO refund_payment_allocations(tenant_id,refund_id,original_payment_id,tender_type,planned_minor,refund_register_id,cash_session_id)
         VALUES($1,$2,$3,'CASH',30000,'a1000000-0000-4000-8000-000000000001',$4)`,
          [tenant, id, payment, session],
        );
      }
      const responses = await Promise.all(
        ids.map((id) =>
          app.inject({
            method: "POST",
            url: `/v1/refunds/${id}/execute-cash`,
            headers: headers(manager),
            payload: { version: 1, cashSessionId: session },
          }),
        ),
      );
      expect(responses.filter((x) => x.statusCode === 201)).toHaveLength(1);
      expect(responses.filter((x) => x.statusCode === 409)).toHaveLength(1);
      const completed = (
        await db.query<{ amount: string }>(
          "SELECT COALESCE(sum(completed_minor),0) amount FROM refunds WHERE tenant_id=$1 AND invoice_id=$2 AND status='COMPLETED'",
          [tenant, invoice],
        )
      ).rows[0]!;
      expect(Number(completed.amount)).toBeLessThanOrEqual(110000);
    });

    it("keeps commission periods non-overlapping and locks one immutable snapshot", async () => {
      await expect(
        db.query(
          `INSERT INTO commission_periods(tenant_id,code,start_date,end_date,currency) SELECT $1,'OVERLAP',start_date,end_date,currency FROM commission_periods WHERE tenant_id=$1 AND id='b2000000-0000-4000-8000-000000000001'`,
          [tenant],
        ),
      ).rejects.toThrow();
      const period = (
        await db.query<{ version: number }>(
          "SELECT version FROM commission_periods WHERE tenant_id=$1 AND id='b2000000-0000-4000-8000-000000000001'",
          [tenant],
        )
      ).rows[0]!;
      const review = await app.inject({
        method: "POST",
        url: "/v1/commission-periods/b2000000-0000-4000-8000-000000000001/start-review",
        headers: headers(owner),
        payload: { version: period.version },
      });
      expect(review.statusCode, review.body).toBe(201);
      const lockResponses = await Promise.all(
        ["a", "b"].map((suffix) =>
          app.inject({
            method: "POST",
            url: "/v1/commission-periods/b2000000-0000-4000-8000-000000000001/lock",
            headers: headers(owner, `${run}-lock-${suffix}`),
            payload: { version: review.json().data.version },
          }),
        ),
      );
      expect(lockResponses.filter((x) => x.statusCode === 201)).toHaveLength(1);
      expect(lockResponses.filter((x) => x.statusCode === 409)).toHaveLength(1);
      const locked = (
        await db.query<{ status: string; integrity_hash: string }>(
          "SELECT status,integrity_hash FROM commission_periods WHERE tenant_id=$1 AND id='b2000000-0000-4000-8000-000000000001'",
          [tenant],
        )
      ).rows[0]!;
      expect(locked.status).toBe("LOCKED");
      expect(locked.integrity_hash).toMatch(/^[a-f0-9]{64}$/);
    });
  },
);

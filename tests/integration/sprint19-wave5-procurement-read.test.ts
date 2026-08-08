import pg from "pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../apps/api/src/infrastructure/database.service.js";
import { ProcurementService } from "../../apps/api/src/modules/procurement/procurement.service.js";

const tenantId = "10000000-0000-4000-8000-000000000001";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft" });
const serviceDb = new DatabaseService();
const service = new ProcurementService(serviceDb, undefined as never);
let branchId = "";
let otherBranchId = "";
let vendorId = "";
let purchaseOrderId = "";
let proposalId = "";
let returnId = "";

const claims = (roles: string[], branches: string[]) => ({
  userId: "30000000-0000-4000-8000-000000000001",
  tenantId,
  membershipId: "40000000-0000-0000-0000-000000000001",
  authorizationVersion: 1,
  sessionId: "50000000-0000-0000-0000-000000000001",
  roles,
  branchIds: branches,
});

describe("Sprint 19 Wave 5 procurement read APIs", () => {
  beforeAll(async () => {
    await db.connect();
    const branches = (await db.query<{ id: string }>("SELECT id FROM branches WHERE tenant_id=$1 ORDER BY id LIMIT 2", [tenantId])).rows;
    branchId = branches[0]?.id ?? "";
    otherBranchId = branches[1]?.id ?? branchId;
    const vendor = (await db.query<{ id: string }>("INSERT INTO procurement_vendors(tenant_id,code,legal_name,display_name,currency,status) VALUES($1,$2,'Read QA','Read QA','VND','ACTIVE') RETURNING id", [tenantId, `QA-W5-${Date.now()}`])).rows[0];
    vendorId = vendor.id;
    const po = (await db.query<{ id: string }>("INSERT INTO procurement_purchase_orders(tenant_id,branch_id,vendor_id,po_number,currency,total_minor,subtotal_minor,fingerprint) VALUES($1,$2,$3,$4,'VND',1200,1200,$5) RETURNING id", [tenantId, branchId, vendorId, `QA-W5-PO-${Date.now()}`, `qa-${Date.now()}`])).rows[0];
    purchaseOrderId = po.id;
    const proposal = (await db.query<{ id: string }>("INSERT INTO procurement_payment_proposals(tenant_id,branch_id,vendor_id,proposal_number,currency,total_minor,requested_by_user_id) VALUES($1,$2,$3,$4,'VND',1200,$5) RETURNING id", [tenantId, branchId, vendorId, `QA-W5-PP-${Date.now()}`, claims([], []).userId])).rows[0];
    proposalId = proposal.id;
    const returned = (await db.query<{ id: string }>("INSERT INTO procurement_vendor_returns(tenant_id,branch_id,vendor_id,purchase_order_id,reason,requested_by_user_id) VALUES($1,$2,$3,$4,'Read API QA',$5) RETURNING id", [tenantId, branchId, vendorId, purchaseOrderId, claims([], []).userId])).rows[0];
    returnId = returned.id;
  });

  afterAll(async () => {
    await db.query("DELETE FROM procurement_vendor_returns WHERE tenant_id=$1 AND id=$2", [tenantId, returnId]);
    await db.query("DELETE FROM procurement_payment_proposals WHERE tenant_id=$1 AND id=$2", [tenantId, proposalId]);
    await db.query("DELETE FROM procurement_purchase_orders WHERE tenant_id=$1 AND id=$2", [tenantId, purchaseOrderId]);
    await db.query("DELETE FROM procurement_vendors WHERE tenant_id=$1 AND id=$2", [tenantId, vendorId]);
    await db.end();
    await serviceDb.onModuleDestroy();
  });

  it("returns safe payment proposal projections with string money and branch scope", async () => {
    const rows = await service.listPaymentProposals(claims(["BRANCH_MANAGER"], [branchId]) as never);
    const row = rows.find((value: any) => value.id === proposalId);
    expect(row).toMatchObject({ id: proposalId, branchId, vendorId, totalMinor: "1200" });
    expect(typeof row.totalMinor).toBe("string");
    expect(row).not.toHaveProperty("requestedByUserId");
    expect(row).not.toHaveProperty("approvedByUserId");
    expect(await service.listPaymentProposals(claims(["BRANCH_MANAGER"], [otherBranchId]) as never)).not.toContainEqual(expect.objectContaining({ id: proposalId }));
  });

  it("returns safe vendor-return projections and never widens tenant or branch scope", async () => {
    const rows = await service.listVendorReturns(claims(["BRANCH_MANAGER"], [branchId]) as never);
    const row = rows.find((value: any) => value.id === returnId);
    expect(row).toMatchObject({ id: returnId, branchId, vendorId, purchaseOrderId, reason: "Read API QA" });
    expect(row).toHaveProperty("purchaseOrderNumber");
    expect(row).not.toHaveProperty("requestedByUserId");
    expect(row).not.toHaveProperty("receiptLineId");
    expect(await service.listVendorReturns(claims(["BRANCH_MANAGER"], [otherBranchId]) as never)).not.toContainEqual(expect.objectContaining({ id: returnId }));
  });
});

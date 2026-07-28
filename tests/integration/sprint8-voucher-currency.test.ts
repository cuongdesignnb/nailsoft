import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BenefitsEligibilityService } from "../../apps/api/src/modules/benefits/benefits-eligibility.service.js";
import { DatabaseService } from "../../apps/api/src/infrastructure/database.service.js";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
});
const tenant = "10000000-0000-4000-8000-000000000001";
const campaign = "cf400000-0000-4000-8000-000000000001";
const code = "cf400000-0000-4000-8000-000000000002";
const db = new DatabaseService();
const service = new BenefitsEligibilityService(db);

describe("Sprint 8 fixed voucher currency", () => {
  beforeAll(async () => {
    await pool.query(
      `INSERT INTO voucher_campaigns(
         id,tenant_id,name,status,discount_type,discount_value,currency,valid_from,valid_until,created_by_user_id)
       VALUES($1,$2,'USD fixed closure','ACTIVE','FIXED',1000,'USD',now()-interval '1 day',now()+interval '1 day',
         '30000000-0000-4000-8000-000000000002')`,
      [campaign, tenant],
    );
    await pool.query(
      `INSERT INTO voucher_codes(id,tenant_id,campaign_id,code_hash,code_last4,use_limit,generation_key)
       VALUES($1,$2,$3,repeat('f',64),'USD1',5,'test:voucher:usd')`,
      [code, tenant, campaign],
    );
  });
  afterAll(async () => {
    await pool.query("DELETE FROM voucher_codes WHERE id=$1", [code]);
    await pool.query("DELETE FROM voucher_campaigns WHERE id=$1", [campaign]);
    await db.onModuleDestroy();
    await pool.end();
  });

  it("rejects a fixed voucher whose server-resolved currency differs", async () => {
    const result = await service.evaluate({
      tenantId: tenant,
      branchId: "20000000-0000-4000-8000-000000000001",
      customerId: "60000000-0000-4000-8000-000000000002",
      context: "POS",
      serviceItems: [
        {
          serviceId: "50000000-0000-4000-8000-000000000001",
          amountMinor: 100_000n,
        },
      ],
      localDateTime: new Date().toISOString(),
      currency: "VND",
    });
    expect(
      result.vouchers.find((voucher) => voucher.id === code)?.reasonCodes,
    ).toContain("VOUCHER_CURRENCY_MISMATCH");
  });
});

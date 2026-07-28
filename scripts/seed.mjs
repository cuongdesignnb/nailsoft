import pg from "pg";
import { readFile } from "node:fs/promises";
const c = new pg.Client({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
});
await c.connect();
try {
  const existing = await c.query(
    "SELECT 1 FROM tenants WHERE slug='nailsoft-demo' LIMIT 1",
  );
  if (!existing.rowCount)
    await c.query(await readFile("infra/seeds/development.sql", "utf8"));
  const sprint5 = await c.query(
    "SELECT 1 FROM schema_migrations WHERE version='0011_walkin_checkin_service_execution'",
  );
  if (sprint5.rowCount)
    await c.query(await readFile("infra/seeds/sprint5.sql", "utf8"));
  const sprint6 = await c.query(
    "SELECT 1 FROM schema_migrations WHERE version='0012_pos_invoice_payment_cash_session'",
  );
  if (sprint6.rowCount)
    await c.query(await readFile("infra/seeds/sprint6.sql", "utf8"));
  const sprint7 = await c.query(
    "SELECT 1 FROM schema_migrations WHERE version='0014_refund_credit_note_commission_reporting'",
  );
  if (sprint7.rowCount)
    await c.query(await readFile("infra/seeds/sprint7.sql", "utf8"));
  const sprint8 = await c.query(
    "SELECT 1 FROM schema_migrations WHERE version='0016_voucher_loyalty_membership_package'",
  );
  if (sprint8.rowCount)
    await c.query(await readFile("infra/seeds/sprint8.sql", "utf8"));
  const sprint9 = await c.query(
    "SELECT 1 FROM schema_migrations WHERE version='0018_inventory_supplier_purchase_operations'",
  );
  if (sprint9.rowCount)
    await c.query(await readFile("infra/seeds/sprint9.sql", "utf8"));
  const sprint10 = await c.query(
    "SELECT 1 FROM schema_migrations WHERE version='0019_gift_card_customer_credit_stored_value'",
  );
  if (sprint10.rowCount)
    await c.query(await readFile("infra/seeds/sprint10.sql", "utf8"));
} finally {
  await c.end();
}

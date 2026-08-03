import pg from "pg";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft", connectionTimeoutMillis: 5000 });
await client.connect();
try {
  const migration = await client.query("SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1");
  const tableRows = await client.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema = 'public'");
  const columns = new Map(); for (const row of tableRows.rows) { if (!columns.has(row.table_name)) columns.set(row.table_name, new Set()); columns.get(row.table_name).add(row.column_name); }
  const tables = new Set(columns.keys());
  const count = async (table) => tables.has(table) ? (await client.query(`SELECT count(*)::text AS value FROM \"${table}\"`)).rows[0].value : null;
  const sum = async (table, column) => tables.has(table) && columns.get(table).has(column) ? (await client.query(`SELECT COALESCE(sum(\"${column}\"),0)::text AS value FROM \"${table}\"`)).rows[0].value : null;
  const statusTotals = async (table) => tables.has(table) && columns.get(table).has("status") ? (await client.query(`SELECT status,count(*)::int AS count FROM \"${table}\" GROUP BY status ORDER BY status`)).rows : null;
  const gl = await client.query("SELECT COALESCE(sum(functional_debit_minor),0)::text AS debit, COALESCE(sum(functional_credit_minor),0)::text AS credit FROM accounting_journal_lines");
  const orphan = await client.query("SELECT (SELECT count(*) FROM branches b LEFT JOIN tenants t ON t.id=b.tenant_id WHERE t.id IS NULL)::int AS branches, (SELECT count(*) FROM appointments a LEFT JOIN branches b ON b.tenant_id=a.tenant_id AND b.id=a.branch_id WHERE b.id IS NULL)::int AS appointments");
  const result = {
    checkedAt: new Date().toISOString(),
    migrationHead: migration.rows[0]?.version ?? null,
    publicTableCount: tables.size,
    criticalTotals: {
      TENANT_COUNT: await count("tenants"), BRANCH_COUNT: await count("branches"), USER_MEMBERSHIP_COUNT: await count("tenant_memberships"),
      BOOKING_COUNT: await count("appointments"), BOOKING_STATUS_TOTALS: await statusTotals("appointments"),
      ISSUED_INVOICE_TOTAL: await sum("invoices", "total_minor"), PAYMENT_SETTLEMENT_TOTAL: await sum("payments", "amount_minor"), REFUND_TOTAL: await sum("refunds", "completed_minor"),
      INVENTORY_LEDGER_TOTAL: await sum("inventory_stock_ledger_entries", "value_delta_minor"), STORED_VALUE_LIABILITY: await sum("stored_value_accounts", "available_minor"), PAYROLL_PAYABLE: await sum("payroll_runs", "net_pay_minor"),
      GL_DEBIT_CREDIT_BALANCE: gl.rows[0], OPEN_AP_TOTAL: await sum("procurement_ap_open_items", "original_minor"),
      FIXED_ASSET_NET_BOOK_VALUE: tables.has("assets") ? (await client.query("SELECT COALESCE(sum(gross_carrying_amount_minor-residual_value_minor-accumulated_depreciation_minor-accumulated_impairment_minor),0)::text AS value FROM assets")).rows[0].value : null,
      ANALYTICS_REBUILD_OR_HEALTH: await count("analytics_projection_checkpoints"), AUDIT_LOG_COUNT: await count("audit_logs"),
    },
    orphanRows: orphan.rows[0],
  };
  if (!result.migrationHead || result.publicTableCount < 1) throw new Error("Database integrity check failed");
  if (result.orphanRows.branches !== 0 || result.orphanRows.appointments !== 0) throw new Error("Critical tenant/branch integrity check failed");
  process.stdout.write("CRITICAL_INTEGRITY_CHECKS=PASS\n");
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally { await client.end(); }

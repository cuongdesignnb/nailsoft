import pg from "pg";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft", connectionTimeoutMillis: 5000 });
await client.connect();
try {
  const migration = await client.query("SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1");
  const tables = await client.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'");
  const result = { checkedAt: new Date().toISOString(), migrationHead: migration.rows[0]?.version ?? null, publicTableCount: tables.rows[0]?.count ?? 0 };
  if (!result.migrationHead || result.publicTableCount < 1) throw new Error("Database integrity check failed");
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally { await client.end(); }

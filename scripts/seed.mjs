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
} finally {
  await c.end();
}

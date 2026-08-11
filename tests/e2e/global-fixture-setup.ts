import pg from "pg";

/**
 * Keep legacy E2E dates valid when CI runs on a later calendar day.
 *
 * The deterministic seed contains published shifts in the past, while
 * business_hours defaults valid_from to CURRENT_DATE.  The availability
 * contract should remain testable against those seeded shifts; this fixture
 * only widens the test tenant's effective business-hours history and never
 * changes application or production data.
 */
export default async function globalFixtureSetup() {
  const client = new pg.Client({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
  });
  const tenantId = "10000000-0000-4000-8000-000000000001";
  try {
    await client.connect();
    const result = await client.query<{ fixtureDate: string | null }>(
      `SELECT to_char(
         MIN(start_at AT TIME ZONE 'Asia/Ho_Chi_Minh'),
         'YYYY-MM-DD'
       ) AS "fixtureDate"
       FROM shifts
       WHERE tenant_id=$1
         AND status='PUBLISHED'`,
      [tenantId],
    );
    const fixtureDate = result.rows[0]?.fixtureDate;
    if (!fixtureDate) {
      throw new Error("No published shift is available for the E2E fixture");
    }
    await client.query(
      `UPDATE business_hours
       SET valid_from=LEAST(valid_from,$2::date)
       WHERE tenant_id=$1`,
      [tenantId, fixtureDate],
    );
  } finally {
    await client.end();
  }
}

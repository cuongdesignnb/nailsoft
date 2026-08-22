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
    await client.query(
      `UPDATE shifts
       SET start_at='2026-08-10 08:30:00+07'::timestamptz,
           end_at='2026-08-10 18:00:00+07'::timestamptz,
           status='PUBLISHED'
       WHERE tenant_id=$1
         AND id='48000000-0000-4000-8000-000000000101'::uuid`,
      [tenantId],
    );
    await client.query(
      `UPDATE availability_versions
       SET version=version+1
       WHERE tenant_id=$1
         AND branch_id='20000000-0000-4000-8000-000000000001'::uuid`,
      [tenantId],
    );
    // Keep the deterministic inventory lot usable for the lifecycle tests
    // when the suite is run after the seed's historical expiry date.
    await client.query(
      `UPDATE inventory_lots
       SET expiry_date=GREATEST(expiry_date,CURRENT_DATE + INTERVAL '365 days'),
           status='AVAILABLE'
       WHERE tenant_id=$1
         AND id='b9070000-0000-4000-8000-000000000001'::uuid`,
      [tenantId],
    );
    await client.query(
      `INSERT INTO shifts(
         id,tenant_id,branch_id,staff_id,start_at,end_at,break_minutes,status,source
       )
       SELECT
         '48000000-0000-4000-8000-000000000103'::uuid,
         $1,
         '20000000-0000-4000-8000-000000000001'::uuid,
         '47000000-0000-4000-8000-000000000003'::uuid,
         (((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
           + CASE EXTRACT(DOW FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)::int
               WHEN 0 THEN 1
               WHEN 1 THEN 7
               ELSE (8 - EXTRACT(DOW FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)::int) % 7
             END)::text || ' 09:00:00 Asia/Ho_Chi_Minh')::timestamptz,
         (((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
           + CASE EXTRACT(DOW FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)::int
               WHEN 0 THEN 1
               WHEN 1 THEN 7
               ELSE (8 - EXTRACT(DOW FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)::int) % 7
             END)::text || ' 18:00:00 Asia/Ho_Chi_Minh')::timestamptz,
         0,'PUBLISHED','IMPORT'
       ON CONFLICT (tenant_id,id) DO UPDATE
         SET start_at=EXCLUDED.start_at,
             end_at=EXCLUDED.end_at,
             status='PUBLISHED'`,
      [tenantId],
    );
  } finally {
    await client.end();
  }
}

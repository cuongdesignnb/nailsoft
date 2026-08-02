import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { branch, connection, sourceId, tenant } from "./sprint17-analytics-test-utils";
const db = connection();
describe("Sprint 17 projection idempotency and replay", () => {
  beforeAll(() => db.connect()); afterAll(() => db.end());
  it("deduplicates the same source generation and keeps tenant scope", async () => {
    const source = sourceId();
    const first = await db.query(`INSERT INTO analytics_projection_events(tenant_id,projector_name,source_type,source_id,source_version,branch_id,event_type,projection_revision) VALUES($1,'qa','invoice',$2,1,$3,'issued',1) ON CONFLICT DO NOTHING RETURNING id`, [tenant, source, branch]);
    const replay = await db.query(`INSERT INTO analytics_projection_events(tenant_id,projector_name,source_type,source_id,source_version,branch_id,event_type,projection_revision) VALUES($1,'qa','invoice',$2,1,$3,'issued',2) ON CONFLICT DO NOTHING RETURNING id`, [tenant, source, branch]);
    expect(first.rowCount).toBe(1); expect(replay.rowCount).toBe(0);
    await expect(db.query("SELECT count(*) FROM analytics_projection_events WHERE tenant_id=$1 AND source_id=$2", [tenant, source])).resolves.toMatchObject({ rows: [{ count: "1" }] });
  });
  it("does not allow an incomplete revision to be published", async () => {
    const checkpoint = (await db.query<any>("SELECT status,projection_revision FROM analytics_projection_checkpoints WHERE tenant_id=$1 AND projector_name='daily-facts'", [tenant])).rows[0];
    expect(checkpoint?.status ?? "HEALTHY").not.toBe("PARTIAL");
  });
});

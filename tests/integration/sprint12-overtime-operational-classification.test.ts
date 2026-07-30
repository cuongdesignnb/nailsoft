import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiApp,
  branch,
  command,
  login,
  pool,
  tenant,
} from "./sprint12-closure-helpers";

const db = pool();
let app: Awaited<ReturnType<typeof apiApp>>;
describe("Sprint 12 operational overtime classification", () => {
  beforeAll(async () => {
    app = await apiApp();
  });
  afterAll(async () => {
    await app.close();
    await db.end();
  });
  it("classifies clocked payable seconds once using a versioned policy", async () => {
    await db.query(
      `INSERT INTO workforce_compliance_policy_versions(tenant_id,policy_id,version,effective_from,timezone_basis,daily_overtime_rules_json,weekly_overtime_rules_json,consecutive_day_rules_json,legal_review_status,policy_json,fingerprint,created_by_user_id) VALUES($1,'f1200000-0000-4000-8000-000000000010',2,current_date,'BRANCH','{"thresholdSeconds":1,"multiplierNumerator":3,"multiplierDenominator":2}','{}','{}','APPROVED','{"testOnly":true}','operational-ot-v2','30000000-0000-4000-8000-000000000001')`,
      [tenant],
    );
    const owner = await login(app, "owner@example.test");
    const staffId = "47000000-0000-4000-8000-000000000006";
    const clockIn = await app.inject({
      method: "POST",
      url: "/v1/time-clock/clock-in",
      headers: command(owner, "ot-operational-in"),
      payload: { staffId, branchId: branch, source: "ADMIN_WEB" },
    });
    expect(clockIn.statusCode, clockIn.body).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 2100));
    const clockOut = await app.inject({
      method: "POST",
      url: "/v1/time-clock/clock-out",
      headers: command(owner, "ot-operational-out"),
      payload: { staffId, branchId: branch, source: "ADMIN_WEB" },
    });
    expect(clockOut.statusCode, clockOut.body).toBe(201);
    const row = (
      await db.query(
        `SELECT source_payable_seconds::text,regular_seconds::text,overtime_seconds::text,policy_version_id,fingerprint FROM attendance_overtime_classifications WHERE tenant_id=$1 AND attendance_session_id=$2`,
        [tenant, clockOut.json().data.id],
      )
    ).rows[0];
    expect(row.regular_seconds).toBe("1");
    expect(BigInt(row.overtime_seconds)).toBeGreaterThan(0n);
    expect(BigInt(row.regular_seconds) + BigInt(row.overtime_seconds)).toBe(
      BigInt(row.source_payable_seconds),
    );
    expect(row.policy_version_id).toBeTruthy();
    expect(row.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
});

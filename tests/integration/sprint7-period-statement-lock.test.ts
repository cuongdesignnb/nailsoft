import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BRANCH,
  PERIOD,
  STAFF,
  TENANT,
  harness,
} from "./sprint7-closure-test-utils";

describe.sequential("Sprint 7 period statement lock integrity", () => {
  let h: Awaited<ReturnType<typeof harness>>;
  let owner: string;
  beforeAll(async () => {
    h = await harness("period-lock");
    owner = await h.login("owner@example.test");
  });
  afterAll(async () => h?.app.close());

  it("locks exact staff-period entries and reconciles payable", async () => {
    const adjustmentId = "f7400000-0000-4000-8000-000000000001";
    await h.db.query(
      `INSERT INTO commission_adjustment_requests(id,tenant_id,staff_id,target_period_id,amount_minor,currency,reason_code,note,status,requested_by_user_id,decided_by_user_id,decision_reason,decided_at)
       VALUES($1,$2,$3,$4,9999,'VND','CLOSURE','Closure statement fixture','APPROVED','30000000-0000-4000-8000-000000000017','30000000-0000-4000-8000-000000000002','Approved fixture',now())`,
      [adjustmentId, TENANT, STAFF, PERIOD],
    );
    await h.db.query(
      `INSERT INTO commission_entries(tenant_id,branch_id,staff_id,invoice_id,adjustment_request_id,entry_type,business_date,currency,base_minor,commission_minor,contribution_basis_json,rule_snapshot_json,source_snapshot_json,generation_key,status)
       VALUES($1,$2,$3,NULL,$4,'MANUAL_ADJUSTMENT',CURRENT_DATE,'VND',0,9999,'{}','{}',$5,$6,'REVIEWED')`,
      [
        TENANT,
        BRANCH,
        STAFF,
        adjustmentId,
        JSON.stringify({ adjustmentRequestId: adjustmentId }),
        `adjustment:${adjustmentId}`,
      ],
    );
    const review = await h.app.inject({
      method: "POST",
      url: `/v1/commission-periods/${PERIOD}/start-review`,
      headers: h.headers(owner),
      payload: { version: 1 },
    });
    expect(review.statusCode, review.body).toBe(201);
    const locked = await h.app.inject({
      method: "POST",
      url: `/v1/commission-periods/${PERIOD}/lock`,
      headers: h.headers(owner),
      payload: { version: review.json().data.version },
    });
    expect(locked.statusCode, locked.body).toBe(201);
    expect(locked.json().data.totals.payableMinor).toBe("9999");
    const statement = await h.app.inject({
      method: "GET",
      url: `/v1/commission-periods/${PERIOD}/staff/${STAFF}/statement`,
      headers: h.headers(owner),
    });
    expect(statement.statusCode, statement.body).toBe(200);
    const data = statement.json().data;
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].staffId).toBe(STAFF);
    expect(data.entries[0].periodId).toBe(PERIOD);
    expect(data.payableMinor).toBe(9999);
  });
});

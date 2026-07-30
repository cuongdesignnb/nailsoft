import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiApp, command, login, pool } from "./sprint12-closure-helpers";

const tenantId = "13000000-0000-4000-8000-000000000902";
const db = pool();
let app: Awaited<ReturnType<typeof apiApp>>;

describe("Sprint 13 semantic usage replay", () => {
  beforeAll(async () => {
    app = await apiApp();
  });
  afterAll(async () => {
    await app.close();
    await db.end();
  });

  it("creates one semantic event and one audit/outbox generation under 20 replays", async () => {
    const actor = await login(app, "platform-e2e@example.test");
    const payload = {
      tenantId,
      meterCode: "API_REQUEST",
      sourceType: "CLOSURE_TEST",
      sourceId: "s13-semantic-replay-001",
      quantity: "7",
    };
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        app.inject({
          method: "POST",
          url: "/v1/internal/platform-usage/events",
          headers: command(
            actor,
            `s13-usage-replay-${String(index).padStart(2, "0")}`,
          ),
          payload,
        }),
      ),
    );
    expect(responses.every((response) => response.statusCode === 201)).toBe(
      true,
    );
    expect(
      responses.filter((response) => !response.json().data.deduplicated),
    ).toHaveLength(1);
    const counts = (
      await db.query<any>(
        `SELECT
           (SELECT count(*)::int FROM platform_usage_events WHERE tenant_id=$1 AND source_type='CLOSURE_TEST' AND source_id=$2) usage,
           (SELECT count(*)::int FROM audit_logs WHERE tenant_id=$1 AND semantic_generation_key LIKE 'platform.usage_recorded:%') audit,
           (SELECT count(*)::int FROM outbox_events WHERE tenant_id=$1 AND semantic_generation_key LIKE 'platform.usage_recorded:%') outbox`,
        [tenantId, payload.sourceId],
      )
    ).rows[0];
    expect(counts).toEqual({ usage: 1, audit: 1, outbox: 1 });

    const correctionRequired = await app.inject({
      method: "POST",
      url: "/v1/internal/platform-usage/events",
      headers: command(actor, "s13-usage-different-quantity"),
      payload: { ...payload, quantity: "8" },
    });
    expect(correctionRequired.statusCode, correctionRequired.body).toBe(409);
    expect(correctionRequired.json().error.code).toBe("USAGE_EVENT_DUPLICATE");
  });
});

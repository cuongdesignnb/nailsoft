const { request } = require("@playwright/test");
const pg = require("pg");

const apiBaseUrl = process.env.API_BASE_URL || "http://127.0.0.1:3001";
const databaseUrl = process.env.DATABASE_URL || "postgresql://nailsoft:nailsoft@127.0.0.1:55432/nailsoft";
const tenantId = "10000000-0000-4000-8000-000000000001";

async function main() {
  const db = new pg.Pool({ connectionString: databaseUrl });
  const context = await request.newContext();
  try {
    const exception = (await db.query(
      `SELECT id,version,state FROM attendance_exceptions
       WHERE tenant_id=$1 ORDER BY created_at,id LIMIT 1`,
      [tenantId],
    )).rows[0];
    if (!exception) throw new Error("No attendance exception fixture is available");

    await db.query(
      `UPDATE attendance_exceptions
       SET state='OPEN',resolution_reason=NULL,resolved_by_user_id=NULL,resolved_at=NULL,
           version=version+1,updated_at=now()
       WHERE tenant_id=$1 AND id=$2`,
      [tenantId, exception.id],
    );
    const open = (await db.query(
      "SELECT version FROM attendance_exceptions WHERE tenant_id=$1 AND id=$2",
      [tenantId, exception.id],
    )).rows[0];

    const login = await context.post(`${apiBaseUrl}/v1/auth/login`, {
      data: {
        tenantSlug: "nailsoft-demo",
        email: "owner@example.test",
        password: "DemoPass123!",
        deviceId: `qa-exception-${Date.now()}`,
        deviceName: "QA Workforce Exception",
        platform: "web",
      },
    });
    const loginBody = await login.json();
    if (!login.ok()) throw new Error(`login ${login.status()}: ${JSON.stringify(loginBody)}`);
    const headers = {
      authorization: `Bearer ${loginBody.data.accessToken}`,
      "x-tenant-id": tenantId,
      "content-type": "application/json",
    };
    const command = async (path, body) => {
      const response = await context.post(`${apiBaseUrl}${path}`, {
        headers: { ...headers, "idempotency-key": `qa-exception-${Date.now()}-${Math.random()}` },
        data: body,
      });
      return { status: response.status(), body: await response.json() };
    };
    const acknowledged = await command(`/v1/time-clock/exceptions/${exception.id}/acknowledge`, { version: Number(open.version) });
    if (acknowledged.status !== 201) throw new Error(`acknowledge failed: ${JSON.stringify(acknowledged.body)}`);
    const resolved = await command(`/v1/time-clock/exceptions/${exception.id}/resolve`, { version: acknowledged.body.data.version, reason: "QA kiểm tra luồng xử lý ngoại lệ" });
    if (resolved.status !== 201) throw new Error(`resolve failed: ${JSON.stringify(resolved.body)}`);
    if (resolved.body.data.state !== "RESOLVED") throw new Error(`unexpected final state: ${JSON.stringify(resolved.body)}`);
    console.log(JSON.stringify({
      exceptionId: exception.id,
      initialState: exception.state,
      acknowledged: { status: acknowledged.status, state: acknowledged.body.data.state, version: acknowledged.body.data.version },
      resolved: { status: resolved.status, state: resolved.body.data.state, version: resolved.body.data.version },
    }, null, 2));
  } finally {
    await context.dispose();
    await db.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

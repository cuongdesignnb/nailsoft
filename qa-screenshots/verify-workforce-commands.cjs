const { request } = require("@playwright/test");

const apiBaseUrl = process.env.API_BASE_URL || "http://127.0.0.1:3001";
const email = process.env.ADMIN_QA_EMAIL || "owner@example.test";
const password = process.env.ADMIN_QA_PASSWORD || "DemoPass123!";
const tenantId = "10000000-0000-4000-8000-000000000001";
const staffId = process.env.STAFF_ID || "47000000-0000-4000-8000-000000000003";

async function main() {
  const context = await request.newContext();
  const login = await context.post(`${apiBaseUrl}/v1/auth/login`, { data: { email, password, deviceId: "qa-workforce-command", deviceName: "QA Workforce Command", platform: "web" } });
  const loginBody = await login.json();
  if (!login.ok()) throw new Error(`login ${login.status()}: ${JSON.stringify(loginBody)}`);
  const token = loginBody.data.accessToken;
  const headers = { authorization: `Bearer ${token}`, "x-tenant-id": tenantId };
  const call = async (method, path, data, extraHeaders = {}) => {
    const response = await context.fetch(`${apiBaseUrl}${path}`, { method, headers: { ...headers, ...extraHeaders }, data });
    return { status: response.status(), body: await response.json().catch(() => null) };
  };

  const profileBefore = await call("GET", `/v1/staff/${staffId}/pay-profile`);
  const profile = profileBefore.body?.data;
  const runId = Date.now();
  const payKey = `qa-workforce-pay-profile-retry-${runId}`;
  const payPayload = { profileType: profile.profileType, currency: profile.currency, effectiveFrom: profile.effectiveFrom, effectiveTo: null };
  const payFirst = await call("POST", `/v1/staff/${staffId}/pay-profile/update`, payPayload, { "idempotency-key": payKey, "content-type": "application/json" });
  const paySecond = await call("POST", `/v1/staff/${staffId}/pay-profile/update`, payPayload, { "idempotency-key": payKey, "content-type": "application/json" });

  const unique = `QA-${runId}`;
  const staffPayload = { membershipId: null, employeeCode: unique, displayName: `QA Workforce ${unique}`, employmentType: "FULL_TIME", preferredLocale: "vi-VN", hireDate: "2035-01-01" };
  const staffKey = `qa-workforce-create-${runId}`;
  const staffFirst = await call("POST", "/v1/staff", staffPayload, { "idempotency-key": staffKey, "content-type": "application/json" });
  const staffSecond = await call("POST", "/v1/staff", staffPayload, { "idempotency-key": staffKey, "content-type": "application/json" });
  const createdStaffId = staffFirst.body?.data?.id;
  const archive = createdStaffId ? await call("POST", `/v1/staff/${createdStaffId}/archive`) : null;

  const timesheet = await call("GET", "/v1/timesheets/f1200000-0000-4000-8000-000000000061");
  const checks = [
    ["pay profile first", payFirst.status === 201 && payFirst.body?.data?.id === profile?.id],
    ["pay profile replay", paySecond.status === 201 && paySecond.body?.data?.id === payFirst.body?.data?.id && paySecond.body?.data?.version === payFirst.body?.data?.version && paySecond.body?.data?.idempotencyReplayed === true],
    ["staff create first", staffFirst.status === 201 && Boolean(createdStaffId)],
    ["staff create replay", staffSecond.status === 201 && staffSecond.body?.data?.id === createdStaffId && staffSecond.body?.data?.idempotencyReplayed === true],
    ["staff archive", archive?.status === 201 && archive.body?.data?.id === createdStaffId],
  ];
  console.log(JSON.stringify({
    payProfile: {
      before: { status: profileBefore.status, id: profile?.id, version: profile?.version },
      first: { status: payFirst.status, id: payFirst.body?.data?.id, version: payFirst.body?.data?.version, idempotencyReplayed: payFirst.body?.data?.idempotencyReplayed },
      second: { status: paySecond.status, id: paySecond.body?.data?.id, version: paySecond.body?.data?.version, idempotencyReplayed: paySecond.body?.data?.idempotencyReplayed },
    },
    staffCreate: {
      first: { status: staffFirst.status, id: createdStaffId, idempotencyReplayed: staffFirst.body?.data?.idempotencyReplayed },
      second: { status: staffSecond.status, id: staffSecond.body?.data?.id, idempotencyReplayed: staffSecond.body?.data?.idempotencyReplayed, error: staffSecond.body?.error?.code },
      archived: { status: archive?.status, id: archive?.body?.data?.id, state: archive?.body?.data?.status },
    },
    timesheet: { status: timesheet.status, state: timesheet.body?.data?.state, version: timesheet.body?.data?.version, projectedAt: timesheet.body?.data?.projectedAt, fingerprint: timesheet.body?.data?.fingerprint },
  }, null, 2));
  await context.dispose();
  const failed = checks.filter(([, ok]) => !ok).map(([label]) => label);
  if (failed.length) throw new Error(`workforce command checks failed: ${failed.join(", ")}`);
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

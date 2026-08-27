const { chromium } = require("@playwright/test");

const adminBaseUrl = process.env.ADMIN_WEB_URL || "http://127.0.0.1:3000";
const email = process.env.ADMIN_QA_EMAIL || "owner@example.test";
const password = process.env.ADMIN_QA_PASSWORD || "DemoPass123!";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" });
  const page = await context.newPage();
  const apiBaseUrl = process.env.API_BASE_URL || "http://127.0.0.1:3001";
  const login = await context.request.post(`${apiBaseUrl}/v1/auth/login`, {
    data: { email, password, deviceId: "qa-workforce", deviceName: "QA Workforce", platform: "web" },
  });
  const loginBody = await login.json();
  if (!login.ok()) throw new Error(JSON.stringify(loginBody));
  if (loginBody.data.workspaceSelectionRequired) throw new Error("Workspace selection is required for this QA account.");
  const token = loginBody.data.accessToken;
  const tenantId = loginBody.data.tenantId;
  const result = await context.request.fetch(`${apiBaseUrl}/v1/auth/context`, { headers: { authorization: `Bearer ${token}`, "x-tenant-id": tenantId } });
  const authContext = await result.json();
  const read = async (path) => {
    const response = await context.request.get(`${apiBaseUrl}${path}`, { headers: { authorization: `Bearer ${token}`, "x-tenant-id": tenantId } });
    return { status: response.status(), body: await response.json().catch(() => null) };
  };
  const data = {
    authContext,
    staff: await read("/v1/staff"),
    users: await read("/v1/users"),
    timesheets: await read("/v1/timesheets"),
    payProfile: await read("/v1/staff/47000000-0000-4000-8000-000000000003/pay-profile"),
    timesheet: await read("/v1/timesheets/f1200000-0000-4000-8000-000000000060"),
    adjustments: await read("/v1/timesheets/f1200000-0000-4000-8000-000000000060/adjustments"),
  };
  const resultPayload = await page.evaluate(async (input) => {
    const paths = ["/v1/staff", "/v1/users", "/v1/timesheets", "/v1/staff/47000000-0000-4000-8000-000000000003/pay-profile", "/v1/timesheets/f1200000-0000-4000-8000-000000000060", "/v1/timesheets/f1200000-0000-4000-8000-000000000060/adjustments"];
    return { paths, input };
  }, data);
  console.log(JSON.stringify(resultPayload.input, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

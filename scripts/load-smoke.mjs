import { cpus, freemem, totalmem } from "node:os";

const baseUrl = process.env.LOAD_BASE_URL ?? "http://127.0.0.1:3001";
const durationMs = Number(process.env.LOAD_DURATION_SECONDS ?? 60) * 1000;
const warmupMs = Number(process.env.LOAD_WARMUP_SECONDS ?? 15) * 1000;
const concurrencyLevels = (process.env.LOAD_CONCURRENCY ?? "10,25")
  .split(",")
  .map(Number);
const email = process.env.LOAD_EMAIL ?? "owner@example.test";
const password = process.env.LOAD_PASSWORD ?? "DemoPass123!";
if (!email.endsWith("@example.test"))
  throw new Error("Load smoke refuses non-test credentials");

const loginBody = (deviceId) => ({
  tenantSlug: "nailsoft-demo",
  email,
  password,
  deviceId,
  deviceName: "Load Smoke",
  platform: "android",
});
async function request(path, init = {}) {
  const start = performance.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
    await response.arrayBuffer();
    return { latency: performance.now() - start, status: response.status };
  } catch {
    return { latency: performance.now() - start, status: 0 };
  }
}
async function auth(deviceId) {
  const response = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(loginBody(deviceId)),
  });
  const body = await response.json();
  return body.data ?? {};
}
async function authAs(deviceId, actorEmail) {
  const response = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...loginBody(deviceId), email: actorEmail }),
  });
  const body = await response.json();
  return body.data ?? {};
}
const scenarios = [
  { name: "health", run: () => request("/v1/health") },
  { name: "ready", run: () => request("/v1/ready") },
  {
    name: "login",
    run: (_, worker) =>
      request("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify(loginBody(`load-login-${worker}`)),
      }),
  },
  {
    name: "select-workspace",
    expected: [400, 401],
    run: () =>
      request("/v1/auth/select-workspace", {
        method: "POST",
        body: JSON.stringify({
          workspaceToken: "invalid-load-smoke-token-that-is-long-enough",
          membershipId: "00000000-0000-4000-8000-000000000000",
          deviceId: "load-select",
          deviceName: "Load Smoke",
          platform: "android",
        }),
      }),
  },
  {
    name: "refresh",
    setup: async (worker) => auth(`load-refresh-${worker}`),
    run: async (state, worker) => {
      const result = await request("/v1/auth/refresh", {
        method: "POST",
        body: JSON.stringify({
          refreshToken: state.refreshToken,
          deviceId: `load-refresh-${worker}`,
        }),
      });
      if (result.status === 200)
        state.refreshToken = (
          await auth(`load-refresh-${worker}`)
        ).refreshToken;
      return result;
    },
  },
  {
    name: "branches",
    setup: async (worker) => auth(`load-branch-${worker}`),
    run: (state) =>
      request("/v1/branches", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "service-list",
    setup: async (worker) => auth(`load-service-${worker}`),
    run: (state) =>
      request("/v1/services?status=ACTIVE&page=1&pageSize=50", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "staff-list",
    setup: async (worker) => auth(`load-staff-${worker}`),
    run: (state) =>
      request("/v1/staff?status=ACTIVE", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "shift-list",
    setup: async (worker) => auth(`load-shift-${worker}`),
    run: (state) =>
      request("/v1/shifts?branchId=20000000-0000-4000-8000-000000000001", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "leave-list",
    setup: async (worker) => auth(`load-leave-${worker}`),
    run: (state) =>
      request(
        "/v1/leave-requests?branchId=20000000-0000-4000-8000-000000000001",
        {
          headers: {
            authorization: `Bearer ${state.accessToken}`,
            "x-tenant-id": state.tenantId,
          },
        },
      ),
  },
  {
    name: "availability-day",
    setup: async (worker) => auth(`load-availability-${worker}`),
    run: (state) =>
      request(
        "/v1/availability?branchId=20000000-0000-4000-8000-000000000001&serviceId=50000000-0000-4000-8000-000000000001&dateFrom=2026-08-10&dateTo=2026-08-10",
        {
          headers: {
            authorization: `Bearer ${state.accessToken}`,
            "x-tenant-id": state.tenantId,
          },
        },
      ),
  },
  {
    name: "availability-week",
    setup: async (worker) => auth(`load-availability-week-${worker}`),
    run: (state) =>
      request(
        "/v1/availability?branchId=20000000-0000-4000-8000-000000000001&serviceId=50000000-0000-4000-8000-000000000001&dateFrom=2026-08-10&dateTo=2026-08-16",
        {
          headers: {
            authorization: `Bearer ${state.accessToken}`,
            "x-tenant-id": state.tenantId,
          },
        },
      ),
  },
  {
    name: "calendar-day",
    setup: async (worker) => auth(`load-calendar-${worker}`),
    run: (state) =>
      request(
        "/v1/calendar/events?branchId=20000000-0000-4000-8000-000000000001&from=2026-08-10T00:00:00%2B07:00&to=2026-08-11T00:00:00%2B07:00",
        {
          headers: {
            authorization: `Bearer ${state.accessToken}`,
            "x-tenant-id": state.tenantId,
          },
        },
      ),
  },
  {
    name: "calendar-week",
    setup: async (worker) => auth(`load-calendar-week-${worker}`),
    run: (state) =>
      request(
        "/v1/calendar/events?branchId=20000000-0000-4000-8000-000000000001&from=2026-08-10T00:00:00%2B07:00&to=2026-08-17T00:00:00%2B07:00",
        {
          headers: {
            authorization: `Bearer ${state.accessToken}`,
            "x-tenant-id": state.tenantId,
          },
        },
      ),
  },
  {
    name: "appointment-list",
    setup: async (worker) => auth(`load-appointment-list-${worker}`),
    run: (state) =>
      request(
        "/v1/appointments?branchId=20000000-0000-4000-8000-000000000001&from=2026-07-01T00:00:00%2B07:00&to=2026-09-01T00:00:00%2B07:00&limit=50",
        {
          headers: {
            authorization: `Bearer ${state.accessToken}`,
            "x-tenant-id": state.tenantId,
          },
        },
      ),
  },
  {
    name: "appointment-detail",
    setup: async (worker) => auth(`load-appointment-detail-${worker}`),
    run: (state) =>
      request("/v1/appointments/70000000-0000-4000-8000-000000000001", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "operations-board",
    setup: async (worker) => auth(`load-operations-${worker}`),
    run: (state) =>
      request(
        "/v1/operations/board?branchId=20000000-0000-4000-8000-000000000001",
        {
          headers: {
            authorization: `Bearer ${state.accessToken}`,
            "x-tenant-id": state.tenantId,
          },
        },
      ),
  },
  {
    name: "walkin-queue",
    setup: async (worker) => auth(`load-walkin-${worker}`),
    run: (state) =>
      request(
        "/v1/walk-ins/queue-summary?branchId=20000000-0000-4000-8000-000000000001",
        {
          headers: {
            authorization: `Bearer ${state.accessToken}`,
            "x-tenant-id": state.tenantId,
          },
        },
      ),
  },
  {
    name: "checkout-summary",
    setup: async (worker) => auth(`load-checkout-${worker}`),
    run: (state) =>
      request(
        "/v1/appointments/70000000-0000-4000-8000-000000000001/checkout-summary",
        {
          headers: {
            authorization: `Bearer ${state.accessToken}`,
            "x-tenant-id": state.tenantId,
          },
        },
      ),
  },
  {
    name: "pos-orders",
    setup: async (worker) => auth(`load-pos-orders-${worker}`),
    run: (state) =>
      request("/v1/pos-orders?branchId=20000000-0000-4000-8000-000000000001", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "financial-summary",
    setup: async (worker) => auth(`load-financial-summary-${worker}`),
    run: (state) =>
      request(
        "/v1/financial/summary?branchId=20000000-0000-4000-8000-000000000001",
        {
          headers: {
            authorization: `Bearer ${state.accessToken}`,
            "x-tenant-id": state.tenantId,
          },
        },
      ),
  },
  {
    name: "financial-reconciliation",
    setup: async (worker) => auth(`load-financial-reconciliation-${worker}`),
    run: (state) =>
      request(
        "/v1/financial/reconciliation/daily?branchId=20000000-0000-4000-8000-000000000001",
        {
          headers: {
            authorization: `Bearer ${state.accessToken}`,
            "x-tenant-id": state.tenantId,
          },
        },
      ),
  },
  {
    name: "invoice-list",
    setup: async (worker) => auth(`load-invoices-${worker}`),
    run: (state) =>
      request("/v1/invoices?branchId=20000000-0000-4000-8000-000000000001", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "procurement-vendor-list",
    setup: async (worker) => auth(`load-procurement-vendors-${worker}`),
    run: (state) => request("/v1/procurement/vendors", { headers: { authorization: `Bearer ${state.accessToken}`, "x-tenant-id": state.tenantId } }),
  },
  {
    name: "procurement-request-list",
    setup: async (worker) => auth(`load-procurement-requests-${worker}`),
    run: (state) => request("/v1/procurement/purchase-requests", { headers: { authorization: `Bearer ${state.accessToken}`, "x-tenant-id": state.tenantId } }),
  },
  {
    name: "procurement-po-list",
    setup: async (worker) => auth(`load-procurement-pos-${worker}`),
    run: (state) => request("/v1/procurement/purchase-orders", { headers: { authorization: `Bearer ${state.accessToken}`, "x-tenant-id": state.tenantId } }),
  },
  {
    name: "procurement-receipt-list",
    setup: async (worker) => auth(`load-procurement-receipts-${worker}`),
    run: (state) => request("/v1/procurement/receipts", { headers: { authorization: `Bearer ${state.accessToken}`, "x-tenant-id": state.tenantId } }),
  },
  {
    name: "procurement-bill-ap-list",
    setup: async (worker) => auth(`load-procurement-ap-${worker}`),
    run: async (state) => { const bills = await request("/v1/procurement/vendor-bills", { headers: { authorization: `Bearer ${state.accessToken}`, "x-tenant-id": state.tenantId } }); if (bills.status >= 500) return bills; return request("/v1/procurement/ap/open-items", { headers: { authorization: `Bearer ${state.accessToken}`, "x-tenant-id": state.tenantId } }); },
  },
  {
    name: "procurement-payment-proposal-preview",
    expected: [400, 401, 403, 404, 409],
    setup: async (worker) => auth(`load-procurement-payment-preview-${worker}`),
    run: (state, worker) => request("/v1/procurement/payment-proposals", { method: "POST", headers: { authorization: `Bearer ${state.accessToken}`, "x-tenant-id": state.tenantId, "idempotency-key": `load-proposal-${worker}-000000000000` }, body: JSON.stringify({ branchId: "20000000-0000-4000-8000-000000000001", vendorId: "00000000-0000-0000-0000-000000000000", items: [] }) }),
  },
  {
    name: "refund-list",
    setup: async (worker) => auth(`load-refunds-${worker}`),
    run: (state) =>
      request("/v1/refunds?branchId=20000000-0000-4000-8000-000000000001", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "net-sales-report",
    setup: async (worker) => auth(`load-net-sales-${worker}`),
    run: (state) =>
      request(
        "/v1/financial/net-sales?branchId=20000000-0000-4000-8000-000000000001",
        {
          headers: {
            authorization: `Bearer ${state.accessToken}`,
            "x-tenant-id": state.tenantId,
          },
        },
      ),
  },
  {
    name: "commission-entries",
    setup: async (worker) => auth(`load-commission-${worker}`),
    run: (state) =>
      request("/v1/commission-entries", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "credit-note-list",
    setup: async (worker) => auth(`load-credit-notes-${worker}`),
    run: (state) =>
      request("/v1/credit-notes", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "benefit-wallet",
    setup: async (worker) => auth(`load-benefit-wallet-${worker}`),
    run: (state) =>
      request("/v1/customers/60000000-0000-4000-8000-000000000001/packages", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "voucher-campaigns",
    setup: async (worker) => auth(`load-voucher-campaigns-${worker}`),
    run: (state) =>
      request("/v1/voucher-campaigns", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "benefit-liability",
    setup: async (worker) => auth(`load-benefit-liability-${worker}`),
    run: (state) =>
      request("/v1/benefits/reports/liability", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "expiring-benefits",
    setup: async (worker) => auth(`load-expiring-benefits-${worker}`),
    run: (state) =>
      request("/v1/benefits/reports/expiring", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "public-booking-availability",
    run: () =>
      request(
        "/v1/public/salons/nailsoft-demo/availability?branchId=20000000-0000-4000-8000-000000000001&serviceId=50000000-0000-4000-8000-000000000001&dateFrom=2026-08-10&dateTo=2026-08-10&slotIntervalMin=15",
      ),
  },
  {
    name: "inventory-stock",
    setup: async (worker) => auth(`load-inventory-stock-${worker}`),
    run: (state) =>
      request(
        "/v1/inventory/stock?branchId=20000000-0000-4000-8000-000000000001",
        {
          headers: {
            authorization: `Bearer ${state.accessToken}`,
            "x-tenant-id": state.tenantId,
          },
        },
      ),
  },
  {
    name: "inventory-barcode",
    setup: async (worker) => auth(`load-inventory-barcode-${worker}`),
    run: (state) =>
      request("/v1/inventory/barcodes/8930000000001", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "inventory-ledger",
    setup: async (worker) => auth(`load-inventory-ledger-${worker}`),
    run: (state) =>
      request(
        "/v1/inventory/ledger?branchId=20000000-0000-4000-8000-000000000001",
        {
          headers: {
            authorization: `Bearer ${state.accessToken}`,
            "x-tenant-id": state.tenantId,
          },
        },
      ),
  },
  {
    name: "inventory-valuation",
    setup: async (worker) => auth(`load-inventory-valuation-${worker}`),
    run: (state) =>
      request(
        "/v1/inventory/reports/valuation?branchId=20000000-0000-4000-8000-000000000001",
        {
          headers: {
            authorization: `Bearer ${state.accessToken}`,
            "x-tenant-id": state.tenantId,
          },
        },
      ),
  },
  {
    name: "gift-card-list",
    setup: async (worker) => auth(`load-gift-cards-${worker}`),
    run: (state) =>
      request("/v1/gift-cards", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "stored-value-liability",
    setup: async (worker) => auth(`load-stored-liability-${worker}`),
    run: (state) =>
      request("/v1/stored-value/reports/liability", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "stored-value-reconciliation",
    setup: async (worker) => auth(`load-stored-reconciliation-${worker}`),
    run: (state) =>
      request("/v1/stored-value/reports/reconciliation", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "customer-credit-list",
    setup: async (worker) => auth(`load-customer-credit-${worker}`),
    run: (state) =>
      request("/v1/customer-credit", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "communication-messages",
    setup: async (worker) => auth(`load-communication-${worker}`),
    run: (state) =>
      request("/v1/communications/messages", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "marketing-campaigns",
    setup: async (worker) => auth(`load-marketing-${worker}`),
    run: (state) =>
      request("/v1/marketing-campaigns", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "verified-reviews",
    setup: async (worker) => auth(`load-reviews-${worker}`),
    run: (state) =>
      request("/v1/reviews", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "recovery-cases",
    setup: async (worker) => auth(`load-recovery-${worker}`),
    run: (state) =>
      request("/v1/service-recovery/cases", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "attendance-sessions",
    setup: async (worker) => auth(`load-attendance-${worker}`),
    run: (state) =>
      request("/v1/time-clock/sessions", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "timesheet-list",
    setup: async (worker) => auth(`load-timesheet-${worker}`),
    run: (state) =>
      request("/v1/timesheets", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "payroll-run-list",
    setup: async (worker) => auth(`load-payroll-${worker}`),
    run: (state) =>
      request("/v1/payroll/runs", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "payout-batch-list",
    setup: async (worker) => auth(`load-payout-${worker}`),
    run: (state) =>
      request("/v1/payout-batches", {
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
      }),
  },
  {
    name: "tenant-entitlements",
    setup: async (worker) => auth(`load-entitlements-${worker}`),
    run: (state) => request("/v1/tenant/billing/entitlements", { headers: { authorization: `Bearer ${state.accessToken}`, "x-tenant-id": state.tenantId } }),
  },
  {
    name: "platform-tenants",
    setup: async (worker) => authAs(`load-platform-tenant-${worker}`, "platform-e2e@example.test"),
    run: (state) => request("/v1/platform/tenants", { headers: { authorization: `Bearer ${state.accessToken}`, "x-tenant-id": state.tenantId } }),
  },
  {
    name: "platform-invoices",
    setup: async (worker) => authAs(`load-platform-invoice-${worker}`, "platform-e2e@example.test"),
    run: (state) => request("/v1/platform/invoices", { headers: { authorization: `Bearer ${state.accessToken}`, "x-tenant-id": state.tenantId } }),
  },
  {
    name: "platform-payments",
    setup: async (worker) => authAs(`load-platform-payment-${worker}`, "platform-e2e@example.test"),
    run: (state) => request("/v1/platform/payment-intents", { headers: { authorization: `Bearer ${state.accessToken}`, "x-tenant-id": state.tenantId } }),
  },
  {
    name: "availability-explain",
    setup: async (worker) => auth(`load-explain-${worker}`),
    run: (state) =>
      request("/v1/availability/explain", {
        method: "POST",
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          "x-tenant-id": state.tenantId,
        },
        body: JSON.stringify({
          branchId: "20000000-0000-4000-8000-000000000001",
          serviceId: "50000000-0000-4000-8000-000000000001",
          startAt: "2026-08-10T10:00:00+07:00",
        }),
      }),
  },
  {
    name: "asset-list",
    setup: async (worker) => auth(`load-assets-${worker}`),
    run: (state) => request("/v1/assets", { headers: { authorization: `Bearer ${state.accessToken}`, "x-tenant-id": state.tenantId } }),
  },
  {
    name: "asset-candidates",
    setup: async (worker) => auth(`load-asset-candidates-${worker}`),
    run: (state) => request("/v1/assets/candidates", { headers: { authorization: `Bearer ${state.accessToken}`, "x-tenant-id": state.tenantId } }),
  },
  {
    name: "asset-maintenance",
    setup: async (worker) => auth(`load-asset-maintenance-${worker}`),
    run: (state) => request("/v1/assets/reports/maintenance-due", { headers: { authorization: `Bearer ${state.accessToken}`, "x-tenant-id": state.tenantId } }),
  },
  {
    name: "asset-nbv",
    setup: async (worker) => auth(`load-asset-nbv-${worker}`),
    run: (state) => request("/v1/assets/reports/net-book-value", { headers: { authorization: `Bearer ${state.accessToken}`, "x-tenant-id": state.tenantId } }),
  },
  {
    name: "analytics-command-center",
    setup: async (worker) => auth(`load-analytics-center-${worker}`),
    run: (state) => request("/v1/analytics/command-center?from=2026-08-01&to=2026-08-31", { headers: { authorization: `Bearer ${state.accessToken}`, "x-tenant-id": state.tenantId } }),
  },
  {
    name: "analytics-revenue-trend",
    setup: async (worker) => auth(`load-analytics-trend-${worker}`),
    run: (state) => request("/v1/analytics/trends?from=2026-08-01&to=2026-08-31", { headers: { authorization: `Bearer ${state.accessToken}`, "x-tenant-id": state.tenantId } }),
  },
  {
    name: "analytics-branch-compare",
    setup: async (worker) => auth(`load-analytics-branch-${worker}`),
    run: (state) => request("/v1/analytics/branches/compare?from=2026-08-01&to=2026-08-31", { headers: { authorization: `Bearer ${state.accessToken}`, "x-tenant-id": state.tenantId } }),
  },
  {
    name: "analytics-staff-performance",
    setup: async (worker) => auth(`load-analytics-staff-${worker}`),
    run: (state) => request("/v1/analytics/staff?from=2026-08-01&to=2026-08-31", { headers: { authorization: `Bearer ${state.accessToken}`, "x-tenant-id": state.tenantId } }),
  },
  {
    name: "analytics-data-quality",
    setup: async (worker) => auth(`load-analytics-quality-${worker}`),
    run: (state) => request("/v1/analytics/data-quality", { headers: { authorization: `Bearer ${state.accessToken}`, "x-tenant-id": state.tenantId } }),
  },
  {
    name: "analytics-export-create",
    setup: async (worker) => auth(`load-analytics-export-${worker}`),
    run: (state, worker) => request("/v1/analytics/exports", { method: "POST", headers: { authorization: `Bearer ${state.accessToken}`, "x-tenant-id": state.tenantId, "idempotency-key": `load-analytics-export-${worker}` }, body: JSON.stringify({ exportType: "COMMAND_CENTER", filters: { from: "2026-08-01", to: "2026-08-31" } }) }),
  },
];

const selected = new Set(
  (process.env.LOAD_SCENARIOS ?? "").split(",").filter(Boolean),
);
const activeScenarios = selected.size
  ? scenarios.filter((scenario) => selected.has(scenario.name))
  : scenarios;

for (const concurrency of concurrencyLevels) {
  for (const scenario of activeScenarios) {
    const states = await Promise.all(
      Array.from(
        { length: concurrency },
        (_, worker) => scenario.setup?.(worker) ?? {},
      ),
    );
    await execute(scenario, states, concurrency, warmupMs, false);
    const report = await execute(
      scenario,
      states,
      concurrency,
      durationMs,
      true,
    );
    process.stdout.write(`${JSON.stringify(report)}\n`);
  }
}

async function execute(scenario, states, concurrency, windowMs, collect) {
  const samples = [];
  let errors = 0;
  let timeouts = 0;
  const end = Date.now() + windowMs;
  await Promise.all(
    states.map(async (state, worker) => {
      while (Date.now() < end) {
        const result = await scenario.run(state, worker);
        if (collect) samples.push(result.latency);
        const expected =
          scenario.expected?.includes(result.status) ||
          (result.status >= 200 && result.status < 400);
        if (collect && !expected) errors++;
        if (collect && result.status === 0) timeouts++;
      }
    }),
  );
  samples.sort((a, b) => a - b);
  const percentile = (value) =>
    samples[Math.min(samples.length - 1, Math.floor(samples.length * value))] ??
    0;
  return {
    scenario: scenario.name,
    concurrency,
    durationSeconds: windowMs / 1000,
    requestCount: samples.length,
    throughput: Number((samples.length / (windowMs / 1000)).toFixed(2)),
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    errorRate: samples.length ? errors / samples.length : 0,
    timeouts,
    cpuCount: cpus().length,
    processMemoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    systemMemoryUsedMb: Math.round((totalmem() - freemem()) / 1024 / 1024),
  };
}

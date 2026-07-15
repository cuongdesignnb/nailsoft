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
    name: "public-booking-availability",
    run: () =>
      request(
        "/v1/public/salons/nailsoft-demo/availability?branchId=20000000-0000-4000-8000-000000000001&serviceId=50000000-0000-4000-8000-000000000001&dateFrom=2026-08-10&dateTo=2026-08-10&slotIntervalMin=15",
      ),
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

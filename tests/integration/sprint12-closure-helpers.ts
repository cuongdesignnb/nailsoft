import pg from "pg";
import { expect } from "vitest";
import { createApp } from "../../apps/api/src/main";

export const tenant = "10000000-0000-4000-8000-000000000001";
export const branch = "20000000-0000-4000-8000-000000000001";
export const ownerUser = "30000000-0000-4000-8000-000000000001";
export const managerUser = "30000000-0000-4000-8000-000000000002";
export const accountantUser = "30000000-0000-4000-8000-000000000004";
export const pool = () =>
  new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
    max: 24,
  });

export async function batch(
  db: pg.Pool,
  statements: string,
  values: readonly unknown[] = [],
) {
  for (const statement of statements
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean))
    await db.query(statement, [...values]);
}

export async function apiApp() {
  const app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

export async function login(
  app: Awaited<ReturnType<typeof apiApp>>,
  email: string,
) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: {
      tenantSlug: "nailsoft-demo",
      email,
      password: "DemoPass123!",
      deviceId: `s12-closure-${email}`,
      deviceName: "Sprint 12 closure integration",
      platform: "web",
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return {
    authorization: `Bearer ${response.json().data.accessToken}`,
    "x-tenant-id": tenant,
  };
}

export function command(
  auth: Awaited<ReturnType<typeof login>>,
  idempotencyKey: string,
) {
  return {
    ...auth,
    "idempotency-key": idempotencyKey.padEnd(16, "-closure"),
  };
}

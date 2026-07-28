import pg from "pg";
import { expect } from "vitest";
import { createApp } from "../../../apps/api/src/main.js";

export const tenant = "10000000-0000-4000-8000-000000000001";
export const branchA = "20000000-0000-4000-8000-000000000001";
export const branchB = "20000000-0000-4000-8000-000000000002";
export const draftOrder = "a4000000-0000-4000-8000-000000000001";

export const database = () =>
  new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
    max: 12,
  });

export async function apiSession(email = "owner@example.test") {
  const app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const login = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: {
      tenantSlug: "nailsoft-demo",
      email,
      password: "DemoPass123!",
      deviceId: `sprint10-closure-${email}`,
      deviceName: "Sprint 10 closure integration",
      platform: "web",
    },
  });
  expect(login.statusCode, login.body).toBe(200);
  const token = login.json().data.accessToken as string;
  return {
    app,
    headers: (key = crypto.randomUUID()) => ({
      authorization: `Bearer ${token}`,
      "x-tenant-id": tenant,
      "idempotency-key": key,
    }),
  };
}

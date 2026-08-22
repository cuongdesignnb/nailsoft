import { expect } from "vitest";
import { createApp } from "../../apps/api/src/main";
import { DatabaseService } from "../../apps/api/src/infrastructure/database.service";

export const TENANT = "10000000-0000-4000-8000-000000000001";
export const BRANCH = "20000000-0000-4000-8000-000000000001";
export const PERIOD = "b2000000-0000-4000-8000-000000000001";
export const INVOICE = "a9000000-0000-4000-8000-000000000002";
export const REFUND = "b3000000-0000-4000-8000-000000000001";
// Keep the shared commission fixture inside the branch used by the accountant
// and use a seeded staff member without unrelated commission rows. Staff 008
// belongs to branch B, while the accountant test actor is branch-scoped to A.
export const STAFF = "47000000-0000-4000-8000-000000000003";

export async function harness(name: string) {
  const app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const db = app.get(DatabaseService);
  const login = async (email: string) => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        tenantSlug: "nailsoft-demo",
        email,
        password: "DemoPass123!",
        deviceId: `${name}-${crypto.randomUUID()}`,
        deviceName: "Sprint 7 closure integration",
        platform: "web",
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data.accessToken as string;
  };
  const headers = (token: string, key = crypto.randomUUID()) => ({
    authorization: `Bearer ${token}`,
    "x-tenant-id": TENANT,
    "idempotency-key": key,
  });
  return { app, db, login, headers };
}

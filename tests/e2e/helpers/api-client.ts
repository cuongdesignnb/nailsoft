import { request, type APIRequestContext, expect } from "@playwright/test";

export const apiBaseUrl = process.env.E2E_API_URL ?? "http://127.0.0.1:3001";
export const tenantId = "10000000-0000-4000-8000-000000000001";

export type Session = { api: APIRequestContext; accessToken: string; tenantId: string; userId?: string };

export async function login(email: string): Promise<Session> {
  const api = await request.newContext({ baseURL: apiBaseUrl });
  const response = await api.post("/v1/auth/login", { data: { tenantSlug: "nailsoft-demo", email, password: "DemoPass123!", deviceId: `e2e-${email}`, deviceName: "Sprint 2 E2E", platform: "web" } });
  const body = await response.json();
  expect(response.ok(), `${email} login failed: ${JSON.stringify(body)}`).toBeTruthy();
  expect(body.data.workspaceSelectionRequired).toBeFalsy();
  return { api, accessToken: body.data.accessToken, tenantId: body.data.tenantId };
}

export function headers(session: Session, idempotencyKey = crypto.randomUUID()) {
  return { authorization: `Bearer ${session.accessToken}`, "x-tenant-id": session.tenantId, "idempotency-key": idempotencyKey };
}

export async function close(session: Session) { await session.api.dispose(); }
export async function json(response: Awaited<ReturnType<APIRequestContext["get"]>>) { return response.json(); }
export async function expectCode(response: Awaited<ReturnType<APIRequestContext["get"]>>, status: number, code?: string) {
  expect(response.status()).toBe(status);
  const body = await response.json();
  if (code) expect(body.error.code).toBe(code);
  return body;
}

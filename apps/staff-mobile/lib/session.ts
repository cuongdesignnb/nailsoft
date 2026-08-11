import type { AuthContext } from "@nailsoft/domain-types";

export const api = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

let accessToken: string | undefined;
let tenantId: string | undefined;
let refreshHandler: (() => Promise<boolean>) | undefined;

export function setSession(token: string | undefined, tenant?: string) {
  accessToken = token;
  tenantId = tenant;
}

export function clearSession() {
  accessToken = undefined;
  tenantId = undefined;
}

export function getSession() {
  return { accessToken, tenantId };
}

export function registerSessionRefresh(handler: (() => Promise<boolean>) | undefined) {
  refreshHandler = handler;
}

async function request(path: string, init: RequestInit, token: string | undefined) {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (tenantId) headers.set("x-tenant-id", tenantId);
  return fetch(`${api}${path}`, { ...init, headers });
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  if (!accessToken) return new Response(null, { status: 401 });
  const response = await request(path, init, accessToken);
  if (response.status !== 401 || !refreshHandler || new Headers(init.headers).get("x-staff-refresh-attempt") === "1") return response;
  const refreshed = await refreshHandler().catch(() => false);
  if (!refreshed || !accessToken) return response;
  const retryHeaders = new Headers(init.headers);
  retryHeaders.set("x-staff-refresh-attempt", "1");
  return request(path, { ...init, headers: retryHeaders }, accessToken);
}

export async function getAuthContext(): Promise<AuthContext> {
  const response = await apiFetch("/v1/auth/context");
  const body = await response.json().catch(() => ({} as { error?: { message?: string } }));
  if (!response.ok) throw new Error(body.error?.message ?? "Unable to load workspace context");
  return body.data as AuthContext;
}

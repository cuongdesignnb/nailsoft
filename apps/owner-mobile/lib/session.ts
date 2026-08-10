import { Platform } from "react-native";

export const api = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";
import type { AuthContext } from "@nailsoft/domain-types";
let accessToken: string | undefined;
let tenantId: string | undefined;
export function setSession(token: string | undefined, tenant?: string) { accessToken = token; tenantId = tenant; }
export function clearSession() { accessToken = undefined; tenantId = undefined; }
export function getSession() { return { accessToken, tenantId }; }
export async function apiFetch(path: string, init: RequestInit = {}) {
  if (!accessToken) return new Response(null, { status: 401 });
  const headers = new Headers(init.headers); headers.set("authorization", `Bearer ${accessToken}`); if (tenantId) headers.set("x-tenant-id", tenantId);
  return fetch(`${api}${path}`, { ...init, headers, ...(Platform.OS === "web" ? { credentials: "include" as const } : {}) });
}
export async function getAuthContext(): Promise<AuthContext> {
  const response = await apiFetch("/v1/auth/context");
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message ?? "Unable to load workspace context");
  return body.data as AuthContext;
}

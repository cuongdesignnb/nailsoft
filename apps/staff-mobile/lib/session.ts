export const api = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";
let accessToken: string | undefined;
let tenantId: string | undefined;
export function setSession(token: string | undefined, tenant?: string) { accessToken = token; tenantId = tenant; }
export function getSession() { return { accessToken, tenantId }; }
export async function apiFetch(path: string, init: RequestInit = {}) {
  if (!accessToken) return new Response(null, { status: 401 });
  const headers = new Headers(init.headers); headers.set("authorization", `Bearer ${accessToken}`); if (tenantId) headers.set("x-tenant-id", tenantId);
  return fetch(`${api}${path}`, { ...init, headers });
}

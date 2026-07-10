let accessToken: string | undefined;
let tenantId: string | undefined;
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const csrf = () =>
  document.cookie
    .split("; ")
    .find((value) => value.startsWith("csrfToken="))
    ?.split("=")[1];
export async function login(input: { email: string; password: string }) {
  const response = await fetch(`${api}/v1/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...input,
      deviceId: "admin-web",
      deviceName: "Admin Web",
      platform: "web",
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Login failed");
  if (!body.data.workspaceSelectionRequired) {
    accessToken = body.data.accessToken;
    tenantId = body.data.tenantId;
  }
  return body.data;
}
export async function selectWorkspace(
  workspaceToken: string,
  membershipId: string,
) {
  const response = await fetch(`${api}/v1/auth/select-workspace`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceToken,
      membershipId,
      deviceId: "admin-web",
      deviceName: "Admin Web",
      platform: "web",
    }),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error?.message ?? "Workspace selection failed");
  accessToken = body.data.accessToken;
  tenantId = body.data.tenantId;
  return body.data;
}
async function performRestore() {
  const response = await fetch(`${api}/v1/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": decodeURIComponent(csrf() ?? ""),
    },
    body: JSON.stringify({ deviceId: "admin-web" }),
  });
  if (!response.ok) {
    clearMemory();
    return false;
  }
  const body = await response.json();
  accessToken = body.data.accessToken;
  tenantId = body.data.tenantId;
  return true;
}
export const restore = createRefreshSingleFlight(performRestore);
export async function authorizedFetch(path: string, init: RequestInit = {}) {
  if (!accessToken && !(await restore()))
    return new Response(null, { status: 401 });
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  if (tenantId) headers.set("x-tenant-id", tenantId);
  let response = await fetch(`${api}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (response.status === 401 && (await restore())) {
    headers.set("authorization", `Bearer ${accessToken}`);
    headers.set("x-tenant-id", tenantId ?? "");
    response = await fetch(`${api}${path}`, {
      ...init,
      headers,
      credentials: "include",
    });
  }
  return response;
}
export function clearMemory() {
  accessToken = undefined;
  tenantId = undefined;
}
import { createRefreshSingleFlight } from "@nailsoft/api-client";

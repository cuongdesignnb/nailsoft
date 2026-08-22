let accessToken: string | undefined;
let tenantId: string | undefined;
let activeBranchId: string | undefined;
type PendingMfa = { mfaToken: string; authenticationState: "MFA_REQUIRED" | "MFA_ENROLLMENT_REQUIRED" };
let pendingMfa: PendingMfa | undefined;
import type { AuthContext } from "@nailsoft/domain-types";
const configuredApi = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Keep web cookies first-party when the E2E/browser host aliases localhost and 127.0.0.1. */
function apiBaseUrl() {
  if (typeof window === "undefined") return configuredApi;
  try {
    const url = new URL(configuredApi);
    if (window.location.hostname === "localhost" && url.hostname === "127.0.0.1") url.hostname = "localhost";
    if (window.location.hostname === "127.0.0.1" && url.hostname === "localhost") url.hostname = "127.0.0.1";
    return url.origin;
  } catch {
    return configuredApi;
  }
}
const csrf = () =>
  document.cookie
    .split("; ")
    .find((value) => value.startsWith("csrfToken="))
    ?.split("=")[1];
export async function login(input: { email: string; password: string }) {
  const response = await fetch(`${apiBaseUrl()}/v1/auth/login`, {
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
  if (body.data.authenticationState && body.data.mfaToken) {
    pendingMfa = { mfaToken: body.data.mfaToken, authenticationState: body.data.authenticationState };
  }
  return body.data;
}
export async function selectWorkspace(
  workspaceToken: string,
  membershipId: string,
) {
  const response = await fetch(`${apiBaseUrl()}/v1/auth/select-workspace`, {
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
  if (body.data.authenticationState && body.data.mfaToken) {
    pendingMfa = { mfaToken: body.data.mfaToken, authenticationState: body.data.authenticationState };
  }
  return body.data;
}

export function getPendingMfa() {
  return pendingMfa;
}

export function clearPendingMfa() {
  pendingMfa = undefined;
}

async function postMfa(path: string, body: Record<string, string>) {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message ?? "MFA verification failed");
  return result.data;
}

export async function enrollPendingMfa() {
  if (!pendingMfa) throw new Error("MFA verification has expired. Sign in again.");
  return postMfa("/v1/auth/mfa/totp/enroll", { mfaToken: pendingMfa.mfaToken });
}

export async function confirmPendingMfa(code: string) {
  if (!pendingMfa) throw new Error("MFA verification has expired. Sign in again.");
  const data = await postMfa("/v1/auth/mfa/totp/confirm", { mfaToken: pendingMfa.mfaToken, code });
  accessToken = data.accessToken;
  tenantId = data.tenantId;
  pendingMfa = undefined;
  return data;
}

export async function verifyPendingMfa(code: string) {
  if (!pendingMfa) throw new Error("MFA verification has expired. Sign in again.");
  const data = await postMfa("/v1/auth/mfa/challenge/verify", { mfaToken: pendingMfa.mfaToken, code });
  accessToken = data.accessToken;
  tenantId = data.tenantId;
  pendingMfa = undefined;
  return data;
}

export async function getAuthContext(): Promise<AuthContext> {
  const response = await authorizedFetch("/v1/auth/context");
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error?.message ?? "Unable to load the authenticated workspace.");
  return body.data as AuthContext;
}

/** Resolve the active branch from fresh server context; local storage is only a UX hint. */
export async function getAuthorizedBranchContext() {
  const context = await getAuthContext();
  const grantedBranchIds = context.supportAccess?.branchIds ?? context.authorization.branchIds;
  const branches = context.branches.filter((branch) => grantedBranchIds.includes(branch.id) && branch.status === "ACTIVE");
  const storedBranchId = getActiveBranchId();
  const storedIsAuthorized = Boolean(storedBranchId && branches.some((branch) => branch.id === storedBranchId));
  if (storedBranchId && !storedIsAuthorized) setActiveBranchId(undefined);
  const branchId = storedIsAuthorized ? storedBranchId : branches.length === 1 ? branches[0]?.id : undefined;
  if (!storedIsAuthorized && branchId) setActiveBranchId(branchId);
  return { context, branches, branchId };
}

export const ACTIVE_BRANCH_CHANGED_EVENT = "nailsoft:active-branch-change";

export function setActiveBranchId(branchId: string | undefined) {
  activeBranchId = branchId;
  if (typeof window !== "undefined") {
    if (branchId) window.localStorage.setItem("nailsoft.activeBranchId", branchId);
    else window.localStorage.removeItem("nailsoft.activeBranchId");
    window.dispatchEvent(new CustomEvent(ACTIVE_BRANCH_CHANGED_EVENT, { detail: branchId }));
  }
}

export function getActiveBranchId() {
  if (!activeBranchId && typeof window !== "undefined")
    activeBranchId = window.localStorage.getItem("nailsoft.activeBranchId") ?? undefined;
  return activeBranchId;
}
async function performRestore() {
  const response = await fetch(`${apiBaseUrl()}/v1/auth/refresh`, {
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
  let response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (response.status === 401 && (await restore())) {
    headers.set("authorization", `Bearer ${accessToken}`);
    headers.set("x-tenant-id", tenantId ?? "");
    response = await fetch(`${apiBaseUrl()}${path}`, {
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
  activeBranchId = undefined;
  pendingMfa = undefined;
}
export function activeSession() {
  return { accessToken, tenantId, api: apiBaseUrl() };
}
import { createRefreshSingleFlight } from "@nailsoft/api-client";

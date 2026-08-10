import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { createRefreshSingleFlight } from "@nailsoft/api-client";
import { api, clearSession, getSession, setSession } from "../session";
import { clearActiveBranchContext } from "./branch-context";

export type DeviceInput = {
  deviceId: string;
  deviceName: string;
  platform: "web" | "ios" | "android";
  appVersion?: string;
};

export type WorkspaceChoice = {
  membershipId: string;
  tenantId: string;
  name: string;
  slug: string;
};

export type PendingWorkspace = {
  workspaceToken: string;
  workspaces: WorkspaceChoice[];
};

export type PendingMfa = {
  mfaToken: string;
  state: "MFA_REQUIRED" | "MFA_ENROLLMENT_REQUIRED";
  expiresIn: number;
};

export type AuthResult = {
  workspaceSelectionRequired?: boolean;
  workspaceToken?: string;
  workspaces?: WorkspaceChoice[];
  authenticationState?: "MFA_REQUIRED" | "MFA_ENROLLMENT_REQUIRED";
  mfaToken?: string;
  expiresIn?: number;
  accessToken?: string;
  refreshToken?: string;
  tenantId?: string;
  membershipId?: string;
  userId?: string;
  recoveryCodes?: string[];
};

export const ownerDevice = (): DeviceInput => ({
  deviceId: "owner-mobile",
  deviceName: "Owner Mobile",
  platform: Platform.OS === "web" ? "web" : Platform.OS === "ios" ? "ios" : "android",
});

const responseData = async <T>(response: Response): Promise<T> => {
  const body = await response.json().catch(() => ({} as { error?: { message?: string } }));
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed safely.");
  return (body as { data: T }).data;
};

const finishSession = async (data: AuthResult) => {
  if (!data.accessToken || !data.tenantId) {
    throw new Error("Authentication response did not contain a session.");
  }
  setSession(data.accessToken, data.tenantId);
  if (data.refreshToken) await SecureStore.setItemAsync("refreshToken", data.refreshToken);
  return data;
};

const webCsrfToken = () => {
  if (Platform.OS !== "web" || typeof document === "undefined") return undefined;
  const cookie = document.cookie.split("; ").find((value) => value.startsWith("csrfToken="));
  return cookie ? decodeURIComponent(cookie.slice("csrfToken=".length)) : undefined;
};

export const restoreOwnerSession = createRefreshSingleFlight(async () => {
  const refreshToken = Platform.OS === "web" ? undefined : await SecureStore.getItemAsync("refreshToken");
  if (!refreshToken && Platform.OS !== "web") return false;
  const csrf = webCsrfToken();
  const response = await fetch(`${api}/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) },
    credentials: Platform.OS === "web" ? "include" : undefined,
    body: JSON.stringify({ ...(refreshToken ? { refreshToken } : {}), ...ownerDevice() }),
  });
  if (!response.ok) {
    await clearOwnerSession();
    return false;
  }
  const data = await responseData<AuthResult>(response);
  await finishSession(data);
  return true;
});

export async function loginOwner(email: string, password: string) {
  const response = await fetch(`${api}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: Platform.OS === "web" ? "include" : undefined,
    body: JSON.stringify({ email: email.trim(), password, ...ownerDevice() }),
  });
  return responseData<AuthResult>(response);
}

export async function selectOwnerWorkspace(workspaceToken: string, membershipId: string) {
  const response = await fetch(`${api}/v1/auth/select-workspace`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: Platform.OS === "web" ? "include" : undefined,
    body: JSON.stringify({ workspaceToken, membershipId, ...ownerDevice() }),
  });
  return responseData<AuthResult>(response);
}

export async function verifyOwnerMfa(mfaToken: string, code: string, recovery = false) {
  const path = recovery ? "/v1/auth/mfa/recovery/verify" : "/v1/auth/mfa/challenge/verify";
  const response = await fetch(`${api}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: Platform.OS === "web" ? "include" : undefined,
    body: JSON.stringify({ mfaToken, code, ...ownerDevice() }),
  });
  return responseData<AuthResult>(response);
}

export async function startOwnerMfaEnrollment(mfaToken: string) {
  const response = await fetch(`${api}/v1/auth/mfa/totp/enroll`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: Platform.OS === "web" ? "include" : undefined,
    body: JSON.stringify({ mfaToken }),
  });
  return responseData<AuthResult & { secret?: string; otpauthUri?: string }>(response);
}

export async function confirmOwnerMfaEnrollment(mfaToken: string, code: string) {
  const response = await fetch(`${api}/v1/auth/mfa/totp/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: Platform.OS === "web" ? "include" : undefined,
    body: JSON.stringify({ mfaToken, code, ...ownerDevice() }),
  });
  return responseData<AuthResult>(response);
}

export async function clearOwnerSession() {
  clearSession();
  clearActiveBranchContext();
  await SecureStore.deleteItemAsync("refreshToken").catch(() => undefined);
}

export async function logoutOwner() {
  try {
    const session = getSession();
    if (session.accessToken) {
      await fetch(`${api}/v1/auth/logout`, {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        credentials: Platform.OS === "web" ? "include" : undefined,
      });
    }
  } finally {
    await clearOwnerSession();
  }
}

export function pendingWorkspace(data: AuthResult): PendingWorkspace | null {
  if (!data.workspaceSelectionRequired || !data.workspaceToken || !data.workspaces?.length) return null;
  return { workspaceToken: data.workspaceToken, workspaces: data.workspaces };
}

export function pendingMfa(data: AuthResult): PendingMfa | null {
  if (!data.authenticationState || !data.mfaToken) return null;
  return { mfaToken: data.mfaToken, state: data.authenticationState, expiresIn: data.expiresIn ?? 300 };
}

export async function persistSessionIfPresent(data: AuthResult) {
  // Web receives the refresh token in an HttpOnly cookie, so the JSON response
  // intentionally omits `refreshToken`. The access token must still remain in
  // memory for the authenticated session; native clients additionally persist
  // their rotated refresh token in SecureStore via finishSession.
  return data.accessToken && data.tenantId ? finishSession(data) : data;
}

import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { createRefreshSingleFlight } from "@nailsoft/api-client";
import { clearSession, api, getSession, registerSessionRefresh, setSession } from "../session";
import { clearStaffBranchContext } from "./branch-context";
import { clearStaffLocalDrafts } from "./drafts";

export type StaffDevice = { deviceId: string; deviceName: string; platform: "web" | "ios" | "android"; appVersion?: string };
export type StaffWorkspace = { membershipId: string; tenantId: string; name: string; slug: string };
export type StaffAuthResult = {
  workspaceSelectionRequired?: boolean;
  workspaceToken?: string;
  workspaces?: StaffWorkspace[];
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
export type PendingStaffWorkspace = { workspaceToken: string; workspaces: StaffWorkspace[] };
export type PendingStaffMfa = { mfaToken: string; state: "MFA_REQUIRED" | "MFA_ENROLLMENT_REQUIRED"; expiresIn: number };

let pendingWorkspaceState: PendingStaffWorkspace | undefined;
let pendingMfaState: PendingStaffMfa | undefined;

export function staffDevice(): StaffDevice {
  return {
    deviceId: "staff-mobile",
    deviceName: "Staff Mobile",
    platform: Platform.OS === "web" ? "web" : Platform.OS === "ios" ? "ios" : "android",
  };
}

async function dataOf<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({} as { error?: { message?: string } }));
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed safely.");
  return (body as { data: T }).data;
}

function webCsrfToken() {
  if (Platform.OS !== "web" || typeof document === "undefined") return undefined;
  const cookie = document.cookie.split("; ").find((value) => value.startsWith("csrfToken="));
  return cookie ? decodeURIComponent(cookie.slice("csrfToken=".length)) : undefined;
}

async function finishSession(data: StaffAuthResult) {
  if (!data.accessToken || !data.tenantId) throw new Error("Authentication response did not contain a session.");
  setSession(data.accessToken, data.tenantId);
  if (data.refreshToken && Platform.OS !== "web") await SecureStore.setItemAsync("refreshToken", data.refreshToken);
  clearPendingAuth();
  return data;
}

export const restoreStaffSession = createRefreshSingleFlight(async () => {
  const refreshToken = Platform.OS === "web" ? undefined : await SecureStore.getItemAsync("refreshToken");
  if (!refreshToken && Platform.OS !== "web") return false;
  const csrf = webCsrfToken();
  const response = await fetch(`${api}/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) },
    credentials: Platform.OS === "web" ? "include" : undefined,
    body: JSON.stringify({ ...(refreshToken ? { refreshToken } : {}), ...staffDevice() }),
  });
  if (!response.ok) {
    await clearStaffSession();
    return false;
  }
  await finishSession(await dataOf<StaffAuthResult>(response));
  return true;
});

registerSessionRefresh(restoreStaffSession);

export async function loginStaff(email: string, password: string) {
  const response = await fetch(`${api}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: Platform.OS === "web" ? "include" : undefined,
    body: JSON.stringify({ email: email.trim(), password, ...staffDevice() }),
  });
  const data = await dataOf<StaffAuthResult>(response);
  if (data.workspaceSelectionRequired && data.workspaceToken && data.workspaces?.length) {
    pendingWorkspaceState = { workspaceToken: data.workspaceToken, workspaces: data.workspaces };
  } else if (data.authenticationState && data.mfaToken) {
    pendingMfaState = { mfaToken: data.mfaToken, state: data.authenticationState, expiresIn: data.expiresIn ?? 300 };
  } else {
    await finishSession(data);
  }
  return data;
}

export async function selectStaffWorkspace(workspaceToken: string, membershipId: string) {
  const response = await fetch(`${api}/v1/auth/select-workspace`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: Platform.OS === "web" ? "include" : undefined,
    body: JSON.stringify({ workspaceToken, membershipId, ...staffDevice() }),
  });
  const data = await dataOf<StaffAuthResult>(response);
  pendingWorkspaceState = undefined;
  if (data.authenticationState && data.mfaToken) pendingMfaState = { mfaToken: data.mfaToken, state: data.authenticationState, expiresIn: data.expiresIn ?? 300 };
  else await finishSession(data);
  return data;
}

export async function verifyStaffMfa(code: string, recovery = false) {
  const pending = pendingMfaState;
  if (!pending) throw new Error("MFA challenge is not available.");
  const path = recovery ? "/v1/auth/mfa/recovery/verify" : "/v1/auth/mfa/challenge/verify";
  const response = await fetch(`${api}${path}`, { method: "POST", headers: { "content-type": "application/json" }, credentials: Platform.OS === "web" ? "include" : undefined, body: JSON.stringify({ mfaToken: pending.mfaToken, code, ...staffDevice() }) });
  const data = await dataOf<StaffAuthResult>(response);
  await finishSession(data);
  return data;
}

export async function startStaffMfaEnrollment() {
  const pending = pendingMfaState;
  if (!pending || pending.state !== "MFA_ENROLLMENT_REQUIRED") throw new Error("MFA enrollment is not available.");
  const response = await fetch(`${api}/v1/auth/mfa/totp/enroll`, { method: "POST", headers: { "content-type": "application/json" }, credentials: Platform.OS === "web" ? "include" : undefined, body: JSON.stringify({ mfaToken: pending.mfaToken }) });
  return dataOf<StaffAuthResult & { secret?: string; otpauthUri?: string }>(response);
}

export async function confirmStaffMfaEnrollment(code: string) {
  const pending = pendingMfaState;
  if (!pending || pending.state !== "MFA_ENROLLMENT_REQUIRED") throw new Error("MFA enrollment is not available.");
  const response = await fetch(`${api}/v1/auth/mfa/totp/confirm`, { method: "POST", headers: { "content-type": "application/json" }, credentials: Platform.OS === "web" ? "include" : undefined, body: JSON.stringify({ mfaToken: pending.mfaToken, code, ...staffDevice() }) });
  const data = await dataOf<StaffAuthResult>(response);
  await finishSession(data);
  return data;
}

export function pendingStaffWorkspace() { return pendingWorkspaceState; }
export function pendingStaffMfa() { return pendingMfaState; }
export function clearPendingAuth() { pendingWorkspaceState = undefined; pendingMfaState = undefined; }

export async function clearStaffSession() {
  clearSession();
  clearPendingAuth();
  clearStaffBranchContext();
  await SecureStore.deleteItemAsync("refreshToken").catch(() => undefined);
  await clearStaffLocalDrafts();
}

export async function logoutStaff() {
  try {
    const session = getSession();
    if (session.accessToken) {
      await fetch(`${api}/v1/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" }, credentials: Platform.OS === "web" ? "include" : undefined });
    }
  } finally {
    await clearStaffSession();
  }
}

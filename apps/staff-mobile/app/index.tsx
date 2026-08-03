import * as SecureStore from "expo-secure-store";
import { createRefreshSingleFlight } from "@nailsoft/api-client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { MobileShell, NativeButton, NativeIcon, NativeStatePanel } from "@nailsoft/ui-native";
import { tokens } from "@nailsoft/design-tokens";
import { translate } from "@nailsoft/localization";
import { api as sessionApi, getAuthContext, setSession } from "../lib/session";

// Route registry keeps own-scope business surfaces discoverable while the shell is redesigned.
export const staffOwnRouteRegistry = [
  "myCalendar", "myBusy", "myAvailability", "upcomingAppointments", "appointment", "staffToday", "myEarnings", "netTips",
  "packageCoverage", "myMaterials", "materialUsage", "storedValueAccess", "recoveryTasks", "recoveryContact", "timeClock",
  "attendanceHistory", "myTimesheets", "payStatements", "branches", "skills", "shifts", "leave", "createLeave", "profile",
] as const;

const api = sessionApi;
let accessToken: string | undefined;
let tenantId: string | undefined;
const restoreSession = createRefreshSingleFlight(async () => {
  const refreshToken = await SecureStore.getItemAsync("refreshToken");
  if (!refreshToken) return false;
  const response = await fetch(api + "/v1/auth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken, deviceId: "staff-mobile" }) });
  if (!response.ok) { accessToken = undefined; tenantId = undefined; await SecureStore.deleteItemAsync("refreshToken"); return false; }
  const body = await response.json(); accessToken = body.data.accessToken; tenantId = body.data.tenantId; setSession(accessToken, tenantId); await SecureStore.setItemAsync("refreshToken", body.data.refreshToken); return true;
});
type ScreenState = "restoring" | "login" | "submitting" | "authenticated" | "workspace" | "mfa" | "error";

export default function StaffHome() {
  const router = useRouter();
  const [state, setState] = useState<ScreenState>("restoring");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const contextQuery = useQuery({ queryKey: ["staff-auth-context"], queryFn: getAuthContext, enabled: state === "authenticated" });
  useEffect(() => { void restoreSession().then((restored) => setState(restored ? "authenticated" : "login")).catch(() => setState("login")); }, []);
  async function login() {
    setState("submitting");
    try {
      const response = await fetch(api + "/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantSlug: "nailsoft-demo", email, password, deviceId: "staff-mobile", deviceName: "Staff Mobile", platform: "android" }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Unable to sign in");
      if (body.data.workspaceSelectionRequired) { setState("workspace"); return; } if (body.data.authenticationState) { setState("mfa"); return; }
      accessToken = body.data.accessToken; tenantId = body.data.tenantId; setSession(accessToken, tenantId); await SecureStore.setItemAsync("refreshToken", body.data.refreshToken); setState("authenticated");
    } catch { setState("error"); }
  }
  if (state === "restoring" || state === "submitting") return <SafeAreaView style={styles.safe}><NativeStatePanel state="loading" title="Opening your shift" detail="Checking your authenticated session." /></SafeAreaView>;
  if (state === "workspace" || state === "mfa") return <SafeAreaView style={styles.safe}><View style={styles.authCard}><Text accessibilityRole="header" style={styles.authTitle}>{state === "workspace" ? "Select workspace" : "Additional verification"}</Text><Text style={styles.copy}>Complete this step to view your schedule and assigned work.</Text><NativeButton label="Continue" icon="arrowRight" onPress={() => router.push(state === "workspace" ? "/workspace" : "/mfa")} /></View></SafeAreaView>;
  if (state !== "authenticated") return <SafeAreaView style={styles.safe}><View style={styles.authCard}><Text style={styles.eyebrow}>NAILSOFT STAFF</Text><Text accessibilityRole="header" style={styles.authTitle}>Sign in</Text><Text style={styles.copy}>See the next service, start assigned work, and stay informed about your shift.</Text><TextInput accessibilityLabel="Email" autoCapitalize="none" autoComplete="email" value={email} onChangeText={setEmail} style={styles.input} placeholder="name@salon.com" /><TextInput accessibilityLabel="Password" autoComplete="password" value={password} onChangeText={setPassword} secureTextEntry style={styles.input} placeholder="Password" /><NativeButton label={state === "error" ? "Try signing in again" : "Sign in"} icon="arrowRight" onPress={() => void login()} />{state === "error" ? <Text accessibilityRole="alert" style={styles.error}>Unable to sign in or this account has no Staff Mobile access.</Text> : null}</View></SafeAreaView>;
  if (contextQuery.isPending) return <SafeAreaView style={styles.safe}><NativeStatePanel state="loading" title="Loading your day" detail="Checking permissions and your work schedule." /></SafeAreaView>;
  if (contextQuery.isError || !contextQuery.data) return <SafeAreaView style={styles.safe}><NativeStatePanel state="error" title="Unable to load workspace" detail="Check the connection and retry." onRetry={() => void contextQuery.refetch()} /></SafeAreaView>;
  const context = contextQuery.data;
  const locale = context.user.locale;
  const ownStaffId = context.authorization.ownStaffId;
  const tabs = [
    { key: "today", label: "Today", icon: "home" as const, onPress: () => router.replace("/") },
    { key: "schedule", label: translate(locale, "calendar"), icon: "calendar" as const, onPress: () => router.push("/shifts") },
    { key: "queue", label: translate(locale, "customers"), icon: "people" as const, onPress: () => router.push("/upcomingAppointments") },
    { key: "more", label: translate(locale, "more"), icon: "more" as const, onPress: () => router.push("/profile") },
  ];
  const actions = [
    { title: "Staff Today", detail: "Current service and what comes next", icon: "activity" as const, screen: "staffToday" },
    { title: "Time clock", detail: "Review your shift status and attendance", icon: "clock" as const, screen: "timeClock" },
    { title: "My earnings", detail: "Tips, commission, and personal statement", icon: "wallet" as const, screen: "myEarnings" },
  ];
  return <SafeAreaView style={styles.safe}><MobileShell tabs={tabs} activeTab="today"><ScrollView contentContainerStyle={styles.content}><View style={styles.hero}><View><Text style={styles.eyebrow}>MY DAY</Text><Text accessibilityRole="header" style={styles.title}>Hello, {context.user.displayName}</Text><Text style={styles.copy}>Customer information is limited to your assigned work scope.</Text></View><View style={styles.heroIcon}><NativeIcon name="calendar" color={tokens.color.onDark} size={24} /></View></View><View style={styles.notice}><NativeIcon name="shield" color={tokens.color.accent} /><Text style={styles.noticeText}>You can only see schedule, service sessions, and personal data that this account is allowed to access.</Text></View><Text style={styles.sectionTitle}>My work</Text><Text style={styles.copy}>{ownStaffId ? "Own staff scope is active." : "Staff scope is being resolved."}</Text><View style={styles.grid}>{actions.map((action) => <View key={action.screen} style={styles.actionCard}><NativeIcon name={action.icon} color={tokens.color.actionPrimary} /><Text style={styles.actionTitle}>{action.title}</Text><Text style={styles.actionDescription}>{action.detail}</Text><NativeButton label="Open" variant="secondary" icon="arrowRight" onPress={() => router.push("/" + action.screen)} /></View>)}</View></ScrollView></MobileShell></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: tokens.color.canvas }, content: { padding: tokens.space[4], gap: tokens.space[4] }, authCard: { flex: 1, justifyContent: "center", padding: tokens.space[6], gap: tokens.space[3], backgroundColor: tokens.color.surface }, eyebrow: { color: tokens.color.accent, fontWeight: "800", fontSize: 12, letterSpacing: 1.2 }, authTitle: { color: tokens.color.textPrimary, fontSize: 34, lineHeight: 40, fontWeight: "700" }, title: { color: tokens.color.textPrimary, fontSize: 28, lineHeight: 34, fontWeight: "700" }, copy: { color: tokens.color.textSecondary, fontSize: 15, lineHeight: 22 }, input: { minHeight: 48, borderWidth: 1, borderColor: tokens.color.borderDefault, borderRadius: tokens.radius.md, paddingHorizontal: tokens.space[3], color: tokens.color.textPrimary, backgroundColor: tokens.color.surface }, error: { color: tokens.color.danger, lineHeight: 20 }, hero: { flexDirection: "row", justifyContent: "space-between", gap: tokens.space[3], padding: tokens.space[5], borderRadius: tokens.radius.lg, backgroundColor: tokens.color.surface, borderWidth: 1, borderColor: tokens.color.borderDefault }, heroIcon: { width: 48, height: 48, justifyContent: "center", alignItems: "center", borderRadius: tokens.radius.md, backgroundColor: tokens.color.actionPrimary }, notice: { flexDirection: "row", gap: tokens.space[2], padding: tokens.space[3], borderRadius: tokens.radius.md, backgroundColor: "#E7F5F3" }, noticeText: { flex: 1, color: tokens.color.textSecondary, lineHeight: 20 }, sectionTitle: { color: tokens.color.textPrimary, fontSize: 20, fontWeight: "700" }, grid: { gap: tokens.space[3] }, actionCard: { gap: tokens.space[2], padding: tokens.space[4], borderRadius: tokens.radius.lg, borderWidth: 1, borderColor: tokens.color.borderDefault, backgroundColor: tokens.color.surface }, actionTitle: { color: tokens.color.textPrimary, fontSize: 17, fontWeight: "700" }, actionDescription: { color: tokens.color.textSecondary, lineHeight: 20 },
});

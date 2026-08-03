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

// Route registry keeps legacy business surfaces discoverable while Wave 0 redesigns the shell.
export const ownerOperationalRouteRegistry = [
  "calendarDay", "calendarWeek", "availability", "explain", "blocks", "createBlock",
  "appointmentsToday", "appointments", "appointment", "operationalSummary", "walkInQueue",
  "pendingRefunds", "commissionReadiness", "benefitLiability", "pendingLoyaltyAdjustments",
  "inventoryLowStock", "inventoryValuation", "storedValueLiability", "storedValueIssuance", "storedValueRedemption",
  "customerCreditOutstanding", "storedValueApprovals", "storedValueExceptions", "campaignApprovals", "lowRatingAlerts",
  "recoverySla", "compensationApprovals", "attendanceSummary", "missingPunchAlerts", "timesheetApprovals",
  "payrollApprovals", "payoutApprovals", "payrollFailures", "billingPlan", "billingQuotas", "billingInvoices",
  "billingWarnings", "supportAccess", "procurementVendors", "procurementRequests", "procurementOrders", "procurementBills",
  "procurementAp", "procurementPayments", "assetSummary", "assetApprovals", "assetMaintenance", "assetTransfers", "assetDisposals",
] as const;

const api = sessionApi;
let accessToken: string | undefined;
let tenantId: string | undefined;
const restoreSession = createRefreshSingleFlight(async () => {
  const refreshToken = await SecureStore.getItemAsync("refreshToken");
  if (!refreshToken) return false;
  const response = await fetch(api + "/v1/auth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken, deviceId: "owner-mobile" }) });
  if (!response.ok) { accessToken = undefined; tenantId = undefined; await SecureStore.deleteItemAsync("refreshToken"); return false; }
  const body = await response.json(); accessToken = body.data.accessToken; tenantId = body.data.tenantId; setSession(accessToken, tenantId); await SecureStore.setItemAsync("refreshToken", body.data.refreshToken); return true;
});

type ScreenState = "restoring" | "login" | "submitting" | "authenticated" | "workspace" | "mfa" | "error" | "forbidden";

export default function OwnerHome() {
  const router = useRouter();
  const [state, setState] = useState<ScreenState>("restoring");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const contextQuery = useQuery({ queryKey: ["owner-auth-context"], queryFn: getAuthContext, enabled: state === "authenticated" });
  useEffect(() => { void restoreSession().then((restored) => setState(restored ? "authenticated" : "login")).catch(() => setState("login")); }, []);
  async function login() {
    setState("submitting");
    try {
      const response = await fetch(api + "/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantSlug: "nailsoft-demo", email, password, deviceId: "owner-mobile", deviceName: "Owner Mobile", platform: "android" }) });
      if (response.status === 403) { setState("forbidden"); return; }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Unable to sign in");
      if (body.data.workspaceSelectionRequired) { setState("workspace"); return; }
      if (body.data.authenticationState) { setState("mfa"); return; }
      accessToken = body.data.accessToken; tenantId = body.data.tenantId; setSession(accessToken, tenantId); await SecureStore.setItemAsync("refreshToken", body.data.refreshToken); setState("authenticated");
    } catch { setState("error"); }
  }
  if (state === "restoring" || state === "submitting") return <SafeAreaView style={styles.safe}><NativeStatePanel state="loading" title="Opening workspace" detail="Checking your authenticated session." /></SafeAreaView>;
  if (state === "workspace" || state === "mfa") return <SafeAreaView style={styles.safe}><View style={styles.authCard}><Text accessibilityRole="header" style={styles.authTitle}>{state === "workspace" ? "Select workspace" : "Additional verification"}</Text><Text style={styles.copy}>Your identity has been verified. Complete this step to open Owner Mobile.</Text><NativeButton label="Continue" icon="arrowRight" onPress={() => router.push(state === "workspace" ? "/workspace" : "/mfa")} /></View></SafeAreaView>;
  if (state !== "authenticated") return <SafeAreaView style={styles.safe}><View style={styles.authCard}><Text style={styles.eyebrow}>NAILSOFT OWNER</Text><Text accessibilityRole="header" style={styles.authTitle}>Sign in</Text><Text style={styles.copy}>Monitor salon operations, approvals, and the metrics that need your attention.</Text><TextInput accessibilityLabel="Email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} style={styles.input} placeholder="name@salon.com" /><TextInput accessibilityLabel="Password" autoComplete="password" value={password} onChangeText={setPassword} secureTextEntry style={styles.input} placeholder="Password" /><NativeButton label={state === "error" ? "Try signing in again" : "Sign in"} icon="arrowRight" onPress={() => void login()} />{state === "error" ? <Text accessibilityRole="alert" style={styles.error}>Unable to sign in. Check your details and try again.</Text> : null}{state === "forbidden" ? <Text accessibilityRole="alert" style={styles.error}>This account cannot use Owner Mobile.</Text> : null}</View></SafeAreaView>;
  if (contextQuery.isPending) return <SafeAreaView style={styles.safe}><NativeStatePanel state="loading" title="Loading dashboard" detail="Checking permissions and branch scope." /></SafeAreaView>;
  if (contextQuery.isError || !contextQuery.data) return <SafeAreaView style={styles.safe}><NativeStatePanel state="error" title="Unable to load workspace" detail="Check the connection and retry." onRetry={() => void contextQuery.refetch()} /></SafeAreaView>;
  const context = contextQuery.data;
  const locale = context.user.locale;
  const tabs = [
    { key: "home", label: translate(locale, "dashboard"), icon: "home" as const, onPress: () => router.replace("/") },
    { key: "bookings", label: translate(locale, "bookings"), icon: "calendar" as const, onPress: () => router.push("/appointmentsToday") },
    { key: "insights", label: translate(locale, "analytics"), icon: "chart" as const, onPress: () => router.push("/analyticsOverview") },
    { key: "more", label: translate(locale, "more"), icon: "more" as const, onPress: () => router.push("/profile") },
  ];
  const quickActions = [
    { title: "Today operations", description: "Queue, active services, and checkout readiness", icon: "activity" as const, screen: "operationalSummary" },
    { title: "Approvals", description: "Payroll, procurement, and refunds awaiting review", icon: "check" as const, screen: "payrollApprovals" },
    { title: "Finance", description: "Daily revenue and balance overview", icon: "wallet" as const, screen: "financialSummary" },
    { title: "Alerts", description: "Inventory, attendance, and SLA signals", icon: "alert" as const, screen: "analyticsAlerts" },
  ];
  return <SafeAreaView style={styles.safe}><MobileShell tabs={tabs} activeTab="home"><ScrollView contentContainerStyle={styles.content}><View style={styles.hero}><View><Text style={styles.eyebrow}>OWNER WORKSPACE</Text><Text accessibilityRole="header" style={styles.title}>Hello, {context.user.displayName}</Text><Text style={styles.copy}>{context.workspace.tenantName} - {context.branches.length} branches in your scope</Text></View><View style={styles.heroIcon}><NativeIcon name="trend" color={tokens.color.onDark} size={24} /></View></View><View style={styles.notice}><NativeIcon name="shield" color={tokens.color.accent} /><Text style={styles.noticeText}>Data follows the current tenant, branch scope, and effective permissions.</Text></View><Text style={styles.sectionTitle}>Quick control</Text><View style={styles.grid}>{quickActions.map((action) => <View key={action.screen} style={styles.actionCard}><NativeIcon name={action.icon} color={tokens.color.actionPrimary} /><Text style={styles.actionTitle}>{action.title}</Text><Text style={styles.actionDescription}>{action.description}</Text><NativeButton label="Open" variant="secondary" icon="arrowRight" onPress={() => router.push("/" + action.screen)} /></View>)}</View></ScrollView></MobileShell></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: tokens.color.canvas }, content: { padding: tokens.space[4], gap: tokens.space[4] },
  authCard: { flex: 1, justifyContent: "center", padding: tokens.space[6], gap: tokens.space[3], backgroundColor: tokens.color.surface }, eyebrow: { color: tokens.color.accent, fontWeight: "800", fontSize: 12, letterSpacing: 1.2 },
  authTitle: { color: tokens.color.textPrimary, fontSize: 34, lineHeight: 40, fontWeight: "700" }, title: { color: tokens.color.textPrimary, fontSize: 28, lineHeight: 34, fontWeight: "700" }, copy: { color: tokens.color.textSecondary, fontSize: 15, lineHeight: 22 },
  input: { minHeight: 48, borderWidth: 1, borderColor: tokens.color.borderDefault, borderRadius: tokens.radius.md, paddingHorizontal: tokens.space[3], color: tokens.color.textPrimary, backgroundColor: tokens.color.surface }, error: { color: tokens.color.danger, lineHeight: 20 },
  hero: { flexDirection: "row", justifyContent: "space-between", gap: tokens.space[3], padding: tokens.space[5], borderRadius: tokens.radius.lg, backgroundColor: tokens.color.surface, borderWidth: 1, borderColor: tokens.color.borderDefault }, heroIcon: { width: 48, height: 48, justifyContent: "center", alignItems: "center", borderRadius: tokens.radius.md, backgroundColor: tokens.color.actionPrimary },
  notice: { flexDirection: "row", gap: tokens.space[2], padding: tokens.space[3], borderRadius: tokens.radius.md, backgroundColor: "#E7F5F3" }, noticeText: { flex: 1, color: tokens.color.textSecondary, lineHeight: 20 }, sectionTitle: { color: tokens.color.textPrimary, fontSize: 20, fontWeight: "700" },
  grid: { gap: tokens.space[3] }, actionCard: { gap: tokens.space[2], padding: tokens.space[4], borderRadius: tokens.radius.lg, borderWidth: 1, borderColor: tokens.color.borderDefault, backgroundColor: tokens.color.surface }, actionTitle: { color: tokens.color.textPrimary, fontSize: 17, fontWeight: "700" }, actionDescription: { color: tokens.color.textSecondary, lineHeight: 20 },
});

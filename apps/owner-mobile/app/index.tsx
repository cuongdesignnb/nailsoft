import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { MobileShell, NativeButton, NativeIcon, NativeStatePanel } from "@nailsoft/ui-native";
import { tokens } from "@nailsoft/design-tokens";
import type { AuthContext, Locale } from "@nailsoft/domain-types";
import { translate } from "@nailsoft/localization";
import { getAuthContext, apiFetch } from "../lib/session";
import {
  confirmOwnerMfaEnrollment,
  loginOwner,
  logoutOwner,
  pendingMfa,
  pendingWorkspace,
  persistSessionIfPresent,
  restoreOwnerSession,
  selectOwnerWorkspace,
  startOwnerMfaEnrollment,
  verifyOwnerMfa,
} from "../lib/wave8/auth-flow";
import { getOwnerBranchContext, selectActiveBranch, syncBranchContext } from "../lib/wave8/branch-context";
import { accessModeAllowsRoute, canReadRoute, ownerRouteRegistry, routeDescriptor } from "../lib/wave8/permissions";
import { ownerText } from "../lib/wave8/i18n";

// Legacy route keys remain discoverable for existing mobile smoke contracts.
export const ownerOperationalRouteRegistry = [
  "calendarDay", "calendarWeek", "availability", "explain", "blocks", "createBlock", "appointmentsToday", "appointments", "appointment", "operationalSummary", "walkInQueue",
  "pendingRefunds", "commissionReadiness", "benefitLiability", "pendingLoyaltyAdjustments", "inventoryLowStock", "inventoryValuation", "storedValueLiability", "storedValueIssuance", "storedValueRedemption", "customerCreditOutstanding", "storedValueApprovals", "storedValueExceptions", "campaignApprovals", "lowRatingAlerts", "recoverySla", "compensationApprovals", "attendanceSummary", "missingPunchAlerts", "timesheetApprovals", "payrollApprovals", "payoutApprovals", "payrollFailures", "billingPlan", "billingQuotas", "billingInvoices", "billingWarnings", "supportAccess", "procurementVendors", "procurementRequests", "procurementOrders", "procurementBills", "procurementAp", "procurementPayments", "assetSummary", "assetApprovals", "assetMaintenance", "assetTransfers", "assetDisposals",
] as const;

type AuthState = "restoring" | "login" | "submitting" | "workspace" | "mfa" | "enrollment" | "authenticated" | "error" | "forbidden";
type WorkspaceChoice = { membershipId: string; tenantId: string; name: string; slug: string };
type PendingMfaState = { mfaToken: string; state: "MFA_REQUIRED" | "MFA_ENROLLMENT_REQUIRED"; expiresIn: number };

const homeDefinitions = [
  { screen: "operationalSummary", title: "todayOperations", description: "operationsDescription", icon: "activity" as const, path: "/v1/operations/summary", permissions: ["operations.board.read"], aggregate: false },
  { screen: "payrollApprovals", title: "approvals", description: "approvalsDescription", icon: "check" as const, path: "/v1/payroll/runs", permissions: ["payroll.run.read"], aggregate: true },
  { screen: "financialSummary", title: "finance", description: "financeDescription", icon: "wallet" as const, path: "/v1/financial/summary", permissions: ["financial.summary.read"], aggregate: false },
  { screen: "analyticsAlerts", title: "alerts", description: "alertsDescription", icon: "alert" as const, path: "/v1/analytics/alerts", permissions: ["analytics.dashboard.read"], aggregate: true },
] as const;

async function readData<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  const body = await response.json().catch(() => ({} as { error?: { message?: string }; data?: T }));
  if (!response.ok) throw new Error(body.error?.message ?? "Unable to load data");
  return body.data as T;
}

function BranchPicker({ context, refresh }: { context: AuthContext; refresh: () => void }) {
  const branchContext = getOwnerBranchContext();
  if (branchContext.authorizedBranches.length <= 1) return null;
  return <View style={styles.branchPicker} accessibilityRole="radiogroup">
    <Text style={styles.fieldLabel}>{ownerText(context.user.locale, "branch")}</Text>
    <NativeButton label={branchContext.activeBranchId ? branchContext.authorizedBranches.find((branch) => branch.id === branchContext.activeBranchId)?.name ?? ownerText(context.user.locale, "branch") : ownerText(context.user.locale, "allBranches")} variant="secondary" icon="chevronDown" onPress={() => undefined} />
    <View style={styles.branchOptions}>
      <NativeButton label={ownerText(context.user.locale, "allBranches")} variant={!branchContext.activeBranchId ? "primary" : "secondary"} onPress={() => { selectActiveBranch(undefined); refresh(); }} />
      {branchContext.authorizedBranches.map((branch) => <NativeButton key={branch.id} label={branch.name} variant={branch.id === branchContext.activeBranchId ? "primary" : "secondary"} onPress={() => { selectActiveBranch(branch.id); refresh(); }} />)}
    </View>
  </View>;
}

export default function OwnerHome() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>("restoring");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [workspace, setWorkspace] = useState<{ token: string; choices: WorkspaceChoice[] }>();
  const [pendingMfaState, setPendingMfaState] = useState<PendingMfaState>();
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRecovery, setMfaRecovery] = useState(false);
  const [enrollmentSecret, setEnrollmentSecret] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [, setBranchVersion] = useState(0);

  const contextQuery = useQuery({ queryKey: ["owner-auth-context"], queryFn: getAuthContext, enabled: state === "authenticated", staleTime: 30_000 });
  const context = contextQuery.data;
  const locale: Locale = context?.user.locale ?? "en-US";

  useEffect(() => { void restoreOwnerSession().then((restored) => setState(restored ? "authenticated" : "login")).catch(() => setState("login")); }, []);
  useEffect(() => { if (context) { syncBranchContext(context); setBranchVersion((value) => value + 1); } }, [context]);
  useEffect(() => {
    if (state !== "enrollment" || !pendingMfaState) return;
    void startOwnerMfaEnrollment(pendingMfaState.mfaToken).then((data) => setEnrollmentSecret(data.secret ?? data.otpauthUri ?? "")).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Unable to start enrollment"));
  }, [pendingMfaState, state]);

  const visibleCards = useMemo(() => context ? homeDefinitions.filter((card) => {
    const route = ownerRouteRegistry.find((item) => item.screen === card.screen);
    return !!route && accessModeAllowsRoute(context.workspace.accessMode, route) && canReadRoute({ ...context, authorization: { ...context.authorization, permissions: context.authorization.permissions } }, card.screen);
  }) : [], [context]);
  const cardQueries = useQueries({ queries: visibleCards.map((card) => ({ queryKey: ["owner-home", card.screen, getOwnerBranchContext().activeBranchId], queryFn: () => readData<unknown>(card.aggregate ? card.path : `${card.path}${getOwnerBranchContext().activeBranchId ? `?branchId=${getOwnerBranchContext().activeBranchId}` : ""}`), enabled: !!context && (card.aggregate || !!getOwnerBranchContext().activeBranchId), staleTime: 30_000 })) });
  const partialHome = cardQueries.some((query) => query.isError);

  async function applyAuth(data: Awaited<ReturnType<typeof loginOwner>>) {
    const nextWorkspace = pendingWorkspace(data);
    if (nextWorkspace) { setWorkspace({ token: nextWorkspace.workspaceToken, choices: nextWorkspace.workspaces }); setState("workspace"); return; }
    const nextMfa = pendingMfa(data);
    if (nextMfa) { setPendingMfaState(nextMfa); setState(nextMfa.state === "MFA_REQUIRED" ? "mfa" : "enrollment"); return; }
    await persistSessionIfPresent(data);
    setWorkspace(undefined); setPendingMfaState(undefined); setState("authenticated");
  }

  async function login() {
    setState("submitting"); setMessage("");
    try { await applyAuth(await loginOwner(email, password)); } catch (error: unknown) { setState(error instanceof Error && error.message.includes("permission") ? "forbidden" : "error"); setMessage(error instanceof Error ? error.message : "Unable to sign in"); }
  }

  async function chooseWorkspace(membershipId: string) {
    if (!workspace) return;
    setState("submitting"); setMessage("");
    try { await applyAuth(await selectOwnerWorkspace(workspace.token, membershipId)); } catch (error: unknown) { setWorkspace(undefined); setState("login"); setMessage(error instanceof Error ? error.message : "Workspace is not available"); }
  }

  async function verifyMfa() {
    if (!pendingMfaState || !mfaCode.trim()) return;
    setState("submitting"); setMessage("");
    try { await applyAuth(await verifyOwnerMfa(pendingMfaState.mfaToken, mfaCode.trim(), mfaRecovery)); setMfaCode(""); } catch (error: unknown) { setPendingMfaState(undefined); setMfaCode(""); setState("login"); setMessage(error instanceof Error ? error.message : "Verification failed"); }
  }

  async function confirmEnrollment() {
    if (!pendingMfaState || !mfaCode.trim()) return;
    setState("submitting"); setMessage("");
    try { const data = await confirmOwnerMfaEnrollment(pendingMfaState.mfaToken, mfaCode.trim()); setRecoveryCodes(data.recoveryCodes ?? []); await applyAuth(data); setMfaCode(""); } catch (error: unknown) { setPendingMfaState(undefined); setMfaCode(""); setState("login"); setMessage(error instanceof Error ? error.message : "Enrollment failed"); }
  }

  async function logout() {
    await logoutOwner();
    queryClient.clear();
    setWorkspace(undefined); setPendingMfaState(undefined); setRecoveryCodes([]); setState("login");
  }

  if (state === "restoring" || state === "submitting") return <SafeAreaView style={styles.safe}><NativeStatePanel state="loading" title={ownerText(locale, "loading")} detail={state === "restoring" ? "Checking your secure session." : "Completing authentication."} /></SafeAreaView>;
  if (state === "workspace" && workspace) return <SafeAreaView style={styles.safe}><View style={styles.authCard}><Text style={styles.eyebrow}>NAILSOFT OWNER</Text><Text accessibilityRole="header" style={styles.authTitle}>{ownerText(locale, "selectWorkspace")}</Text><Text style={styles.copy}>Choose the workspace you are authorized to open.</Text>{workspace.choices.map((choice) => <NativeButton key={choice.membershipId} label={`${choice.name} · ${choice.slug}`} onPress={() => void chooseWorkspace(choice.membershipId)} />)}{message ? <Text accessibilityRole="alert" style={styles.error}>{message}</Text> : null}</View></SafeAreaView>;
  if ((state === "mfa" || state === "enrollment") && pendingMfaState) return <SafeAreaView style={styles.safe}><View style={styles.authCard}><Text style={styles.eyebrow}>NAILSOFT OWNER</Text><Text accessibilityRole="header" style={styles.authTitle}>{state === "mfa" ? ownerText(locale, "verify") : ownerText(locale, "enrollMfa")}</Text>{enrollmentSecret ? <Text selectable style={styles.copy}>{enrollmentSecret}</Text> : null}<TextInput accessibilityLabel={ownerText(locale, "mfaCode")} keyboardType="number-pad" value={mfaCode} onChangeText={setMfaCode} style={styles.input} placeholder={ownerText(locale, "mfaCode")} maxLength={mfaRecovery ? 32 : 6} secureTextEntry={mfaRecovery} /><NativeButton label={ownerText(locale, "verify")} icon="shield" onPress={() => void (state === "enrollment" ? confirmEnrollment() : verifyMfa())} />{state === "mfa" ? <NativeButton label={ownerText(locale, "recoveryCode")} variant="secondary" onPress={() => setMfaRecovery((value) => !value)} /> : null}{message ? <Text accessibilityRole="alert" style={styles.error}>{message}</Text> : null}</View></SafeAreaView>;
  if (state !== "authenticated") return <SafeAreaView style={styles.safe}><View style={styles.authCard}><Text style={styles.eyebrow}>NAILSOFT OWNER</Text><Text accessibilityRole="header" style={styles.authTitle}>{ownerText(locale, "signIn")}</Text><Text style={styles.copy}>Securely monitor the workspaces you are authorized to manage.</Text><TextInput accessibilityLabel={ownerText(locale, "email")} autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} style={styles.input} placeholder="name@salon.com" /><TextInput accessibilityLabel={ownerText(locale, "password")} autoComplete="current-password" value={password} onChangeText={setPassword} secureTextEntry style={styles.input} placeholder="Password" /><NativeButton label={ownerText(locale, "signIn")} icon="arrowRight" onPress={() => void login()} />{message ? <Text accessibilityRole="alert" style={styles.error}>{message}</Text> : null}</View></SafeAreaView>;
  if (contextQuery.isPending) return <SafeAreaView style={styles.safe}><NativeStatePanel state="loading" title={ownerText(locale, "loading")} detail="Checking permissions and branch scope." /></SafeAreaView>;
  if (contextQuery.isError || !context) return <SafeAreaView style={styles.safe}><NativeStatePanel state="error" title="Unable to load workspace" detail="Check the connection and retry." onRetry={() => void contextQuery.refetch()} /></SafeAreaView>;
  const recoveryMode = ["BILLING_ONLY", "SUSPENDED"].includes(context.workspace.accessMode);
  if (context.capabilities?.ownerMobileEnabled !== true && !recoveryMode || context.workspace.accessMode === "TERMINATED") return <SafeAreaView style={styles.safe}><View style={styles.authCard}><Text accessibilityRole="header" style={styles.authTitle}>{ownerText(locale, "ownerUnavailable")}</Text><Text style={styles.copy}>Use a recovery-safe billing or profile channel when available.</Text><NativeButton label={ownerText(locale, "signOut")} icon="logout" onPress={() => void logout()} /></View></SafeAreaView>;
  if (recoveryMode) {
    const recoveryRoutes = ["billingPlan", "billingInvoices", "billingWarnings", "supportAccess", "profile", "sessions"]
      .map((screen) => routeDescriptor(screen))
      .filter((route): route is NonNullable<ReturnType<typeof routeDescriptor>> => !!route && canReadRoute(context, route.screen));
    const recoveryTabs = [
      { key: "home" as const, label: translate(locale, "dashboard"), icon: "home" as const, onPress: () => router.replace("/") },
      { key: "more" as const, label: translate(locale, "more"), icon: "more" as const, onPress: () => router.push("/profile") },
    ];
    return <SafeAreaView style={styles.safe}><MobileShell tabs={recoveryTabs} activeTab="more"><ScrollView contentContainerStyle={styles.content}><View style={styles.authCard}><Text accessibilityRole="header" style={styles.authTitle}>{ownerText(locale, "ownerUnavailable")}</Text><Text style={styles.copy}>Salon operations are temporarily unavailable. Recovery-safe billing, security and profile actions remain available.</Text>{recoveryRoutes.map((route) => <NativeButton key={route.screen} label={ownerText(locale, route.titleKey)} variant="secondary" icon={route.domain === "billing" ? "payment" : "shield"} onPress={() => router.push(`/${route.screen}`)} />)}<NativeButton label={ownerText(locale, "signOut")} icon="logout" onPress={() => void logout()} /></View></ScrollView></MobileShell></SafeAreaView>;
  }
  const tabs = [
    { key: "home", label: translate(locale, "dashboard"), icon: "home" as const, onPress: () => router.replace("/") },
    { key: "bookings", label: translate(locale, "bookings"), icon: "calendar" as const, onPress: () => router.push("/appointmentsToday") },
    { key: "insights", label: translate(locale, "analytics"), icon: "chart" as const, onPress: () => router.push("/analyticsOverview") },
    { key: "more", label: translate(locale, "more"), icon: "more" as const, onPress: () => router.push("/profile") },
  ];
  const branchContext = getOwnerBranchContext();
  const readOnly = context.workspace.accessMode === "READ_ONLY";
  return <SafeAreaView style={styles.safe}><MobileShell tabs={tabs} activeTab="home"><ScrollView contentContainerStyle={styles.content}><View style={styles.hero}><View style={styles.heroCopy}><Text style={styles.eyebrow}>OWNER WORKSPACE</Text><Text accessibilityRole="header" style={styles.title}>Hello, {context.user.displayName}</Text><Text style={styles.copy}>{context.workspace.tenantName} · {branchContext.authorizedBranches.length} authorized branches</Text></View><View style={styles.heroIcon}><NativeIcon name="trend" color={tokens.color.onDark} size={24} /></View></View><BranchPicker context={context} refresh={() => setBranchVersion((value) => value + 1)} />{readOnly ? <View style={styles.readOnly}><NativeIcon name="lock" color={tokens.color.actionPrimary} /><Text style={styles.copy}>{ownerText(locale, "readOnly")}</Text></View> : null}{partialHome ? <View style={styles.readOnly}><NativeIcon name="alert" color={tokens.color.actionPrimary} /><Text style={styles.copy}>{ownerText(locale, "partial")}</Text></View> : null}<Text style={styles.sectionTitle}>Executive overview</Text><View style={styles.grid}>{visibleCards.map((card, index) => { const result = cardQueries[index]; return <View key={card.screen} style={styles.actionCard}><NativeIcon name={card.icon} color={tokens.color.actionPrimary} /><Text style={styles.actionTitle}>{ownerText(locale, card.title)}</Text><Text style={styles.actionDescription}>{card.description}</Text>{result?.isPending ? <Text style={styles.copy}>{ownerText(locale, "loading")}</Text> : result?.isError ? <Text accessibilityRole="alert" style={styles.error}>{ownerText(locale, "partial")}</Text> : <Text style={styles.copy}>{ownerText(locale, "refresh")}: server-authoritative</Text>}<NativeButton label="Open" variant="secondary" icon="arrowRight" onPress={() => router.push(`/${card.screen}`)} /></View>; })}</View>{recoveryCodes.length ? <View style={styles.recovery}><Text accessibilityRole="header" style={styles.actionTitle}>{ownerText(locale, "recoveryCodes")}</Text><Text selectable style={styles.copy}>{recoveryCodes.join("\n")}</Text><NativeButton label={ownerText(locale, "close")} variant="secondary" onPress={() => setRecoveryCodes([])} /></View> : null}<NativeButton label={ownerText(locale, "signOut")} variant="secondary" icon="logout" onPress={() => void logout()} /></ScrollView></MobileShell></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: tokens.color.canvas },
  content: { padding: tokens.space[4], gap: tokens.space[4] },
  authCard: { flex: 1, justifyContent: "center", padding: tokens.space[6], gap: tokens.space[3], backgroundColor: tokens.color.surface },
  eyebrow: { color: tokens.color.accent, fontWeight: "800", fontSize: 12, letterSpacing: 1.2 },
  authTitle: { color: tokens.color.textPrimary, fontSize: 30, lineHeight: 36, fontWeight: "700" },
  title: { color: tokens.color.textPrimary, fontSize: 28, lineHeight: 34, fontWeight: "700" },
  copy: { color: tokens.color.textSecondary, fontSize: 15, lineHeight: 22 },
  input: { minHeight: 48, borderWidth: 1, borderColor: tokens.color.borderDefault, borderRadius: tokens.radius.md, paddingHorizontal: tokens.space[3], color: tokens.color.textPrimary, backgroundColor: tokens.color.surface },
  error: { color: tokens.color.danger, lineHeight: 20 },
  hero: { flexDirection: "row", justifyContent: "space-between", gap: tokens.space[3], padding: tokens.space[5], borderRadius: tokens.radius.lg, backgroundColor: tokens.color.surface, borderWidth: 1, borderColor: tokens.color.borderDefault },
  heroCopy: { flex: 1, gap: tokens.space[1] },
  heroIcon: { width: 48, height: 48, justifyContent: "center", alignItems: "center", borderRadius: tokens.radius.md, backgroundColor: tokens.color.actionPrimary },
  sectionTitle: { color: tokens.color.textPrimary, fontSize: 20, fontWeight: "700" },
  grid: { gap: tokens.space[3] },
  actionCard: { gap: tokens.space[2], padding: tokens.space[4], borderRadius: tokens.radius.lg, borderWidth: 1, borderColor: tokens.color.borderDefault, backgroundColor: tokens.color.surface },
  actionTitle: { color: tokens.color.textPrimary, fontSize: 17, fontWeight: "700" },
  actionDescription: { color: tokens.color.textSecondary, lineHeight: 20 },
  readOnly: { flexDirection: "row", alignItems: "center", gap: tokens.space[2], padding: tokens.space[3], borderRadius: tokens.radius.md, backgroundColor: "#E7F5F3" },
  branchPicker: { gap: tokens.space[2], padding: tokens.space[3], backgroundColor: tokens.color.surface, borderRadius: tokens.radius.md, borderWidth: 1, borderColor: tokens.color.borderDefault },
  fieldLabel: { color: tokens.color.textSecondary, fontWeight: "700" },
  branchOptions: { gap: tokens.space[2] },
  recovery: { gap: tokens.space[2], padding: tokens.space[4], borderRadius: tokens.radius.lg, backgroundColor: tokens.color.surface, borderWidth: 1, borderColor: tokens.color.borderDefault },
});

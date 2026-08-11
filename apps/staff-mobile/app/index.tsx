import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { MobileShell, NativeButton, NativeIcon, NativeStatePanel } from "@nailsoft/ui-native";
import { tokens } from "@nailsoft/design-tokens";
import { getAuthContext } from "../lib/session";
import { clearStaffSession, loginStaff, restoreStaffSession } from "../lib/wave9/auth-flow";
import { syncStaffBranchContext } from "../lib/wave9/branch-context";
import { canReadStaffRoute, staffRouteRegistry, visibleStaffTabs } from "../lib/wave9/permissions";
import { staffText } from "../lib/wave9/i18n";

/** Compatibility export for existing smoke tests; authorization uses descriptors in wave9/permissions.ts. */
export const staffOwnRouteRegistry = staffRouteRegistry.map((route) => route.screen);

type AuthState = "restoring" | "login" | "submitting" | "authenticated" | "error";

export default function StaffHome() {
  const router = useRouter();
  const [state, setState] = useState<AuthState>("restoring");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const contextQuery = useQuery({ queryKey: ["staff-auth-context"], queryFn: getAuthContext, enabled: state === "authenticated" });

  useEffect(() => {
    void restoreStaffSession().then((restored) => setState(restored ? "authenticated" : "login")).catch(() => setState("login"));
  }, []);

  async function submitLogin() {
    setState("submitting");
    setMessage("");
    try {
      const result = await loginStaff(email, password);
      if (result.workspaceSelectionRequired) router.replace("/workspace");
      else if (result.authenticationState) router.replace("/mfa");
      else setState("authenticated");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to sign in safely.");
      setState("error");
    }
  }

  if (state === "restoring" || state === "submitting") return <AuthPanel title={staffText(undefined, "loading")} detail="Checking your secure session." />;
  if (state !== "authenticated") return <LoginPanel email={email} password={password} message={message} onEmail={setEmail} onPassword={setPassword} onSubmit={() => void submitLogin()} />;
  if (contextQuery.isPending) return <AuthPanel title={staffText(undefined, "loading")} detail="Checking permissions and assigned work." />;
  if (contextQuery.isError || !contextQuery.data) return <AuthPanel title="Unable to load workspace" detail="Check the connection and retry." retry={() => void contextQuery.refetch()} />;

  const context = contextQuery.data;
  const locale = context.user.locale;
  syncStaffBranchContext(context);
  const capability = context.capabilities?.staffMobileEnabled === true;
  const ownStaffId = context.authorization.ownStaffId;
  const accessMode = context.workspace.accessMode;
  if (!capability) return <UnavailablePanel text={staffText(locale, "unavailable")} />;
  if (!ownStaffId) return <UnavailablePanel text={staffText(locale, "missingStaff")} />;
  if (["BILLING_ONLY", "SUSPENDED", "TERMINATED"].includes(accessMode)) return <UnavailablePanel text={staffText(locale, "unavailable")} />;

  const tabs = (() => {
    const visible = visibleStaffTabs(context);
    const tab = (key: "today" | "schedule" | "queue" | "more", labelKey: string, icon: "home" | "calendar" | "people" | "more", path: string) => ({ key, label: staffText(locale, labelKey), icon, onPress: () => router.replace(path as never) });
    return [
      tab("today", "home", "home", "/"),
      tab("schedule", "schedule", "calendar", "/shifts"),
      tab("queue", "queue", "people", "/upcomingAppointments"),
      tab("more", "more", "more", "/profile"),
    ].filter((item) => visible.includes(item.key));
  })();
  const actions = [
    { screen: "staffToday", title: staffText(locale, "currentService"), detail: staffText(locale, "assignedScope"), icon: "activity" as const },
    { screen: "timeClock", title: staffText(locale, "timeClock"), detail: staffText(locale, "attendance"), icon: "clock" as const },
    { screen: "myEarnings", title: staffText(locale, "earnings"), detail: staffText(locale, "assignedScope"), icon: "wallet" as const },
  ].filter((action) => canReadStaffRoute(context, action.screen));

  return <SafeAreaView style={styles.safe}><MobileShell tabs={tabs} activeTab="today"><ScrollView contentContainerStyle={styles.content}>
    <View style={styles.hero}><View style={styles.heroCopy}><Text style={styles.eyebrow}>{staffText(locale, "home")}</Text><Text accessibilityRole="header" style={styles.title}>{context.user.displayName}</Text><Text style={styles.copy}>{staffText(locale, "assignedScope")}</Text></View><View style={styles.heroIcon}><NativeIcon name="calendar" color={tokens.color.onDark} size={24} /></View></View>
    <View style={styles.notice}><NativeIcon name="shield" color={tokens.color.accent} /><Text style={styles.noticeText}>{staffText(locale, "assignedScope")}</Text></View>
    <Text style={styles.sectionTitle}>{staffText(locale, "myWork")}</Text>
    {actions.length ? <View style={styles.grid}>{actions.map((action) => <View key={action.screen} style={styles.actionCard}><NativeIcon name={action.icon} color={tokens.color.actionPrimary} /><Text style={styles.actionTitle}>{action.title}</Text><Text style={styles.actionDescription}>{action.detail}</Text><NativeButton label={staffText(locale, "open")} variant="secondary" icon="arrowRight" onPress={() => router.push(`/${action.screen}` as never)} /></View>)}</View> : <NativeStatePanel state="forbidden" title={staffText(locale, "noPermission")} />}
  </ScrollView></MobileShell></SafeAreaView>;
}

function LoginPanel({ email, password, message, onEmail, onPassword, onSubmit }: { email: string; password: string; message: string; onEmail: (value: string) => void; onPassword: (value: string) => void; onSubmit: () => void }) {
  return <SafeAreaView style={styles.safe}><View style={styles.authCard}><Text style={styles.eyebrow}>NAILSOFT STAFF</Text><Text accessibilityRole="header" style={styles.authTitle}>{staffText(undefined, "signIn")}</Text><Text style={styles.copy}>Open assigned work for your active workspace.</Text><TextInput accessibilityLabel={staffText(undefined, "email")} autoCapitalize="none" autoComplete="email" value={email} onChangeText={onEmail} style={styles.input} placeholder="name@salon.com" /><TextInput accessibilityLabel={staffText(undefined, "password")} autoComplete="password" value={password} onChangeText={onPassword} secureTextEntry style={styles.input} placeholder={staffText(undefined, "password")} /><NativeButton label={staffText(undefined, "signIn")} icon="arrowRight" onPress={onSubmit} />{message ? <Text accessibilityRole="alert" style={styles.error}>{message}</Text> : null}</View></SafeAreaView>;
}

function AuthPanel({ title, detail, retry }: { title: string; detail: string; retry?: () => void }) {
  return <SafeAreaView style={styles.safe}><NativeStatePanel state={retry ? "error" : "loading"} title={title} detail={detail} onRetry={retry} /></SafeAreaView>;
}

function UnavailablePanel({ text }: { text: string }) {
  return <SafeAreaView style={styles.safe}><View style={styles.authCard}><NativeStatePanel state="forbidden" title={text} detail={staffText(undefined, "noPermission")} /><NativeButton label={staffText(undefined, "signOut")} variant="secondary" icon="logout" onPress={() => void clearStaffSession()} /></View></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: tokens.color.canvas }, content: { padding: tokens.space[4], gap: tokens.space[4] }, authCard: { flex: 1, justifyContent: "center", padding: tokens.space[6], gap: tokens.space[3], backgroundColor: tokens.color.surface }, eyebrow: { color: tokens.color.accent, fontWeight: "800", fontSize: 12, letterSpacing: 1.2 }, authTitle: { color: tokens.color.textPrimary, fontSize: 34, lineHeight: 40, fontWeight: "700" }, title: { color: tokens.color.textPrimary, fontSize: 28, lineHeight: 34, fontWeight: "700" }, copy: { color: tokens.color.textSecondary, fontSize: 15, lineHeight: 22 }, input: { minHeight: 48, borderWidth: 1, borderColor: tokens.color.borderDefault, borderRadius: tokens.radius.md, paddingHorizontal: tokens.space[3], color: tokens.color.textPrimary, backgroundColor: tokens.color.surface }, error: { color: tokens.color.danger, lineHeight: 20 }, hero: { flexDirection: "row", justifyContent: "space-between", gap: tokens.space[3], padding: tokens.space[5], borderRadius: tokens.radius.lg, backgroundColor: tokens.color.surface, borderWidth: 1, borderColor: tokens.color.borderDefault }, heroCopy: { flex: 1 }, heroIcon: { width: 48, height: 48, justifyContent: "center", alignItems: "center", borderRadius: tokens.radius.md, backgroundColor: tokens.color.actionPrimary }, notice: { flexDirection: "row", gap: tokens.space[2], padding: tokens.space[3], borderRadius: tokens.radius.md, backgroundColor: "#E7F5F3" }, noticeText: { flex: 1, color: tokens.color.textSecondary, lineHeight: 20 }, sectionTitle: { color: tokens.color.textPrimary, fontSize: 20, fontWeight: "700" }, grid: { gap: tokens.space[3] }, actionCard: { gap: tokens.space[2], padding: tokens.space[4], borderRadius: tokens.radius.lg, borderWidth: 1, borderColor: tokens.color.borderDefault, backgroundColor: tokens.color.surface }, actionTitle: { color: tokens.color.textPrimary, fontSize: 17, fontWeight: "700" }, actionDescription: { color: tokens.color.textSecondary, lineHeight: 20 },
});

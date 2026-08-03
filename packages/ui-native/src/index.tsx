import { createElement, type ComponentType, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { tokens } from "@nailsoft/design-tokens";
import type { IconName } from "@nailsoft/icons";

const nativeIcons: Record<IconName, string> = {
  activity: "activity", alert: "alert-circle", archive: "archive", arrowLeft: "arrow-left", arrowRight: "arrow-right", calendar: "calendar", camera: "camera", chart: "bar-chart-2", check: "check", chevronDown: "chevron-down", chevronLeft: "chevron-left", chevronRight: "chevron-right", clock: "clock", close: "x", creditCard: "credit-card", customer: "user", download: "download", edit: "edit-2", externalLink: "external-link", file: "file-text", filter: "filter", gift: "gift", home: "home", inventory: "box", lock: "lock", logout: "log-out", menu: "menu", more: "more-horizontal", notification: "bell", package: "package", payment: "credit-card", people: "users", phone: "phone", plus: "plus", receipt: "file-text", refresh: "refresh-cw", search: "search", settings: "settings", shield: "shield", staff: "users", store: "shopping-bag", tag: "tag", transfer: "sliders", trend: "trending-up", user: "user", wallet: "credit-card",
};

type FeatherProps = { name: string; color?: string; size?: number; accessibilityElementsHidden?: boolean };
const FeatherGlyph = Feather as unknown as ComponentType<FeatherProps>;

export const nativeStyles = StyleSheet.create({
  appShell: { flex: 1, backgroundColor: tokens.color.canvas }, appContent: { flex: 1 },
  screen: { flex: 1, backgroundColor: tokens.color.canvas, padding: tokens.space[4], gap: tokens.space[4] },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: tokens.space[3] },
  title: { color: tokens.color.textPrimary, fontSize: tokens.typography.size.xl, fontWeight: "700" },
  button: { minHeight: tokens.touchTarget.minimum, borderRadius: tokens.radius.md, justifyContent: "center", paddingHorizontal: tokens.space[4] },
  buttonContent: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: tokens.space[2] },
  primary: { backgroundColor: tokens.color.actionPrimary }, danger: { backgroundColor: tokens.color.danger }, secondary: { backgroundColor: tokens.color.actionSecondary },
  primaryText: { color: tokens.color.onDark, fontWeight: "700" }, secondaryText: { color: tokens.color.actionPrimary, fontWeight: "700" }, pressed: { opacity: 0.82 }, disabled: { opacity: 0.5 },
  state: { alignItems: "center", gap: tokens.space[2], backgroundColor: tokens.color.surface, borderColor: tokens.color.borderDefault, borderWidth: 1, borderRadius: tokens.radius.lg, padding: tokens.space[6] },
  stateTitle: { color: tokens.color.textPrimary, fontSize: tokens.typography.size.lg, fontWeight: "700", textAlign: "center" }, stateDetail: { color: tokens.color.textSecondary, textAlign: "center" },
  tabBar: { flexDirection: "row", minHeight: 64, paddingTop: tokens.space[1], borderTopColor: tokens.color.borderDefault, borderTopWidth: 1, backgroundColor: tokens.color.surface },
  tab: { flex: 1, minHeight: 56, alignItems: "center", justifyContent: "center", gap: 2, borderRadius: tokens.radius.sm }, tabActive: { backgroundColor: tokens.color.actionSecondary },
  tabText: { color: tokens.color.textSecondary, fontSize: tokens.typography.size.xs, fontWeight: "600" }, tabTextActive: { color: tokens.color.actionPrimary },
});

export function NativeIcon({ name, color = tokens.color.textPrimary, size = 20 }: { name: IconName; color?: string; size?: number }) { return createElement(FeatherGlyph, { name: nativeIcons[name], color, size, accessibilityElementsHidden: true }); }

export function NativeButton({ label, icon, onPress, disabled = false, variant = "primary" }: { label: string; icon?: IconName; onPress: () => void; disabled?: boolean; variant?: "primary" | "secondary" | "danger" }) {
  const palette = variant === "primary" ? nativeStyles.primary : variant === "danger" ? nativeStyles.danger : nativeStyles.secondary;
  const text = variant === "secondary" ? nativeStyles.secondaryText : nativeStyles.primaryText;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [nativeStyles.button, palette, pressed && nativeStyles.pressed, disabled && nativeStyles.disabled]}><View style={nativeStyles.buttonContent}>{icon ? <NativeIcon name={icon} color={variant === "secondary" ? tokens.color.actionPrimary : tokens.color.onDark} /> : null}<Text style={text}>{label}</Text></View></Pressable>;
}

export function NativeStatePanel({ state, title, detail, onRetry }: { state: "loading" | "empty" | "error" | "forbidden" | "offline"; title: string; detail?: string; onRetry?: () => void }) {
  const icon: Record<typeof state, IconName> = { loading: "activity", empty: "file", error: "alert", forbidden: "lock", offline: "alert" };
  return <View accessibilityRole={state === "error" || state === "forbidden" ? "alert" : "summary"} style={nativeStyles.state}><NativeIcon name={icon[state]} /><Text style={nativeStyles.stateTitle}>{title}</Text>{detail ? <Text style={nativeStyles.stateDetail}>{detail}</Text> : null}{onRetry ? <NativeButton label="Retry" variant="secondary" icon="refresh" onPress={onRetry} /> : null}</View>;
}

export function MobileScreen({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) { return <View style={nativeStyles.screen}><View style={nativeStyles.header}><Text accessibilityRole="header" style={nativeStyles.title}>{title}</Text>{action}</View>{children}</View>; }

export type MobileTab = { key: string; label: string; icon: IconName; onPress: () => void };
export function MobileShell({ children, tabs, activeTab }: { children: ReactNode; tabs: MobileTab[]; activeTab: string }) {
  return <View style={nativeStyles.appShell}><View style={nativeStyles.appContent}>{children}</View><View accessibilityRole="tablist" style={nativeStyles.tabBar}>{tabs.map((tab) => {
    const active = tab.key === activeTab;
    return <Pressable key={tab.key} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={tab.label} onPress={tab.onPress} style={[nativeStyles.tab, active && nativeStyles.tabActive]}><NativeIcon name={tab.icon} color={active ? tokens.color.actionPrimary : tokens.color.textSecondary} size={20} /><Text style={[nativeStyles.tabText, active && nativeStyles.tabTextActive]}>{tab.label}</Text></Pressable>;
  })}</View></View>;
}

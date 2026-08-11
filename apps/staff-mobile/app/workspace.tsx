import { useState } from "react";
import { useRouter } from "expo-router";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";
import { NativeButton } from "@nailsoft/ui-native";
import { tokens } from "@nailsoft/design-tokens";
import { pendingStaffWorkspace, selectStaffWorkspace } from "../lib/wave9/auth-flow";
import { staffText } from "../lib/wave9/i18n";

export default function StaffWorkspace() {
  const router = useRouter();
  const pending = pendingStaffWorkspace();
  const [selected, setSelected] = useState(pending?.workspaces[0]?.membershipId ?? "");
  const [error, setError] = useState("");
  if (!pending) return <SafeAreaView style={styles.screen}><Text accessibilityRole="alert">Workspace selection has expired. Sign in again.</Text><NativeButton label={staffText(undefined, "signIn")} onPress={() => router.replace("/")} /></SafeAreaView>;
  return <SafeAreaView style={styles.screen}><View style={styles.card}><Text accessibilityRole="header" style={styles.title}>{staffText(undefined, "workspaceChoice")}</Text>{pending.workspaces.map((workspace) => <NativeButton key={workspace.membershipId} label={`${workspace.name} (${workspace.slug})`} variant={selected === workspace.membershipId ? "primary" : "secondary"} onPress={() => setSelected(workspace.membershipId)} />)}<NativeButton label={staffText(undefined, "open")} disabled={!selected} onPress={() => void selectStaffWorkspace(pending.workspaceToken, selected).then((result) => router.replace(result.authenticationState ? "/mfa" : "/")).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Workspace selection failed safely."))} />{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}</View></SafeAreaView>;
}

const styles = StyleSheet.create({ screen: { flex: 1, justifyContent: "center", padding: tokens.space[5], backgroundColor: tokens.color.canvas }, card: { gap: tokens.space[3], padding: tokens.space[5], borderRadius: tokens.radius.lg, backgroundColor: tokens.color.surface }, title: { fontSize: 26, fontWeight: "700", color: tokens.color.textPrimary }, error: { color: tokens.color.danger } });

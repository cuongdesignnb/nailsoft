import { useState } from "react";
import { useRouter } from "expo-router";
import { SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { NativeButton } from "@nailsoft/ui-native";
import { tokens } from "@nailsoft/design-tokens";
import { confirmStaffMfaEnrollment, pendingStaffMfa, startStaffMfaEnrollment, verifyStaffMfa } from "../lib/wave9/auth-flow";
import { staffText } from "../lib/wave9/i18n";

export default function StaffMfa() {
  const router = useRouter();
  // Keep the challenge view alive long enough to show one-time recovery codes
  // after the server has issued the authenticated session and cleared memory.
  const [pending] = useState(() => pendingStaffMfa());
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [enrollment, setEnrollment] = useState<{ otpauthUri?: string; secret?: string }>();
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  if (!pending) return <SafeAreaView style={styles.screen}><Text accessibilityRole="alert">{staffText(undefined, "mfaExpired")}</Text><NativeButton label={staffText(undefined, "signIn")} onPress={() => router.replace("/")} /></SafeAreaView>;
  const submit = async () => {
    try {
      if (pending.state === "MFA_ENROLLMENT_REQUIRED" && !enrollment) {
        const setup = await startStaffMfaEnrollment();
        setEnrollment({ otpauthUri: setup.otpauthUri, secret: setup.secret });
        return;
      }
      const result = pending.state === "MFA_ENROLLMENT_REQUIRED" ? await confirmStaffMfaEnrollment(code) : await verifyStaffMfa(code, recovery);
      if (result.recoveryCodes) setRecoveryCodes(result.recoveryCodes);
      else router.replace("/");
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : staffText(undefined, "mfaFailed")); }
  };
  return <SafeAreaView style={styles.screen}><View style={styles.card}><Text accessibilityRole="header" style={styles.title}>{pending.state === "MFA_ENROLLMENT_REQUIRED" ? staffText(undefined, "enrollMfa") : staffText(undefined, "mfa")}</Text>{enrollment ? <Text selectable>{enrollment.otpauthUri ?? enrollment.secret}</Text> : null}<TextInput accessibilityLabel={staffText(undefined, "code")} keyboardType="number-pad" maxLength={recovery ? 32 : 6} value={code} onChangeText={setCode} style={styles.input} placeholder={recovery ? staffText(undefined, "recoveryCode") : "000000"} /><NativeButton label={staffText(undefined, "verify")} onPress={() => void submit()} />{pending.state === "MFA_REQUIRED" ? <NativeButton label={staffText(undefined, "recoveryCode")} variant="secondary" onPress={() => setRecovery((value) => !value)} /> : null}{recoveryCodes.length ? <View><Text>{staffText(undefined, "recoveryCodes")}</Text>{recoveryCodes.map((value) => <Text key={value} selectable>{value}</Text>)}<NativeButton label={staffText(undefined, "open")} onPress={() => router.replace("/")} /></View> : null}{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}</View></SafeAreaView>;
}

const styles = StyleSheet.create({ screen: { flex: 1, justifyContent: "center", padding: tokens.space[5], backgroundColor: tokens.color.canvas }, card: { gap: tokens.space[3], padding: tokens.space[5], borderRadius: tokens.radius.lg, backgroundColor: tokens.color.surface }, title: { fontSize: 26, fontWeight: "700", color: tokens.color.textPrimary }, input: { minHeight: 48, borderWidth: 1, borderColor: tokens.color.borderDefault, paddingHorizontal: tokens.space[3], color: tokens.color.textPrimary }, error: { color: tokens.color.danger } });

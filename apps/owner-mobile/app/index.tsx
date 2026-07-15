import * as SecureStore from "expo-secure-store";
import { createRefreshSingleFlight } from "@nailsoft/api-client";
import { useEffect, useState } from "react";
import { Link } from "expo-router";
import {
  ActivityIndicator,
  Button,
  SafeAreaView,
  Text,
  TextInput,
  View,
} from "react-native";
import { api as sessionApi, setSession } from "../lib/session";

const api = sessionApi;
let accessToken: string | undefined;
let tenantId: string | undefined;
const restoreSession = createRefreshSingleFlight(async () => {
  const refreshToken = await SecureStore.getItemAsync("refreshToken");
  if (!refreshToken) return false;
  const response = await fetch(`${api}/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken, deviceId: "owner-mobile" }),
  });
  if (!response.ok) {
    accessToken = undefined;
    tenantId = undefined;
    await SecureStore.deleteItemAsync("refreshToken");
    return false;
  }
  const body = await response.json();
  accessToken = body.data.accessToken;
  tenantId = body.data.tenantId;
  setSession(accessToken, tenantId);
  await SecureStore.setItemAsync("refreshToken", body.data.refreshToken);
  return true;
});

export default function Home() {
  const [state, setState] = useState<
    | "restoring"
    | "login"
    | "loading"
    | "ready"
    | "error"
    | "forbidden"
    | "workspace"
    | "mfa"
  >("restoring");
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  useEffect(() => {
    void restoreSession()
      .then((restored) => setState(restored ? "ready" : "login"))
      .catch(() => setState("login"));
  }, []);
  async function login() {
    setState("loading");
    try {
      const response = await fetch(`${api}/v1/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantSlug: "nailsoft-demo",
          email,
          password,
          deviceId: "owner-mobile",
          deviceName: "Owner Mobile",
          platform: "android",
        }),
      });
      if (response.status === 403) {
        setState("forbidden");
        return;
      }
      const body = await response.json();
      if (!response.ok) throw new Error();
      if (body.data.workspaceSelectionRequired) {
        setState("workspace");
        return;
      }
      if (body.data.authenticationState) {
        setState("mfa");
        return;
      }
      accessToken = body.data.accessToken;
      tenantId = body.data.tenantId;
      setSession(accessToken, tenantId);
      await SecureStore.setItemAsync("refreshToken", body.data.refreshToken);
      setState("ready");
    } catch {
      setState("error");
    }
  }
  if (state === "restoring" || state === "loading")
    return (
      <SafeAreaView>
        <ActivityIndicator accessibilityLabel="Đang tải" />
      </SafeAreaView>
    );
  if (state === "ready")
    return (
      <SafeAreaView>
        <View style={{ padding: 24, gap: 12 }}>
          <Text style={{ fontSize: 12, color: "#6D28D9" }}>OWNER</Text>
          <Text style={{ fontSize: 32, fontWeight: "700" }}>
            Salon overview
          </Text>
          <Text>Phiên đăng nhập đã được khôi phục an toàn.</Text>
          <Text>
            {accessToken
              ? `Workspace ${tenantId ?? "active"} is authenticated.`
              : "Session unavailable."}
          </Text>
          {[
            "appointmentsToday",
            "appointments",
            "calendarDay",
            "calendarWeek",
            "availability",
            "explain",
            "blocks",
            "createBlock",
            "organization",
            "branches",
            "services",
            "staff",
            "shifts",
            "leave",
            "team",
            "sessions",
            "profile",
            "language",
          ].map((screen) => (
            <Link key={screen} href={`/${screen}` as never}>
              {screen}
            </Link>
          ))}
        </View>
      </SafeAreaView>
    );
  if (state === "workspace" || state === "mfa")
    return (
      <SafeAreaView>
        <View style={{ padding: 24, gap: 12 }}>
          <Text style={{ fontSize: 28, fontWeight: "700" }}>
            {state === "workspace"
              ? "Select workspace"
              : "Additional verification"}
          </Text>
          <Text>
            Your primary identity is verified. Continue without storing an
            incomplete session.
          </Text>
          <Link href={state === "workspace" ? "/workspace" : "/mfa"}>
            Continue
          </Link>
        </View>
      </SafeAreaView>
    );
  return (
    <SafeAreaView>
      <View style={{ padding: 24, gap: 12 }}>
        <Text style={{ fontSize: 32, fontWeight: "700" }}>Đăng nhập</Text>
        <TextInput
          accessibilityLabel="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          style={{ borderWidth: 1, padding: 12 }}
        />
        <TextInput
          accessibilityLabel="Mật khẩu"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          style={{ borderWidth: 1, padding: 12 }}
        />
        <Button
          title={state === "error" ? "Thử lại" : "Đăng nhập"}
          onPress={() => void login()}
        />
        {state === "error" && (
          <Text accessibilityRole="alert">Không thể đăng nhập.</Text>
        )}
        {state === "forbidden" && (
          <Text accessibilityRole="alert">
            Bạn không có quyền truy cập Owner App.
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

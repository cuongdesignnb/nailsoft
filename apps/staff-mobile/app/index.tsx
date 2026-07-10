import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Button,
  SafeAreaView,
  Text,
  TextInput,
  View,
} from "react-native";
export default function Home() {
  const [state, setState] = useState<
    "restoring" | "login" | "loading" | "ready" | "error"
  >("restoring");
  const [email, setEmail] = useState("staff5@example.test"),
    [password, setPassword] = useState("");
  useEffect(() => {
    void SecureStore.getItemAsync("refreshToken")
      .then((token) => setState(token ? "ready" : "login"))
      .catch(() => setState("login"));
  }, []);
  async function login() {
    setState("loading");
    try {
      const response = await fetch(
        `${process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001"}/v1/auth/login`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            tenantSlug: "nailsoft-demo",
            email,
            password,
            deviceId: "staff-mobile",
            deviceName: "Staff Mobile",
            platform: "android",
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error();
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
          <Text style={{ fontSize: 12, color: "#6D28D9" }}>STAFF</Text>
          <Text style={{ fontSize: 32, fontWeight: "700" }}>Today</Text>
          <Text>Empty schedule state — chưa có lịch được giao.</Text>
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
          <Text accessibilityRole="alert">
            Không thể đăng nhập hoặc không có quyền.
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

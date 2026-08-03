import { Stack, usePathname, useRouter } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { MobileShell } from "@nailsoft/ui-native";

export default function Layout() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 2, staleTime: 60_000 } } }));
  return <QueryClientProvider client={client}><StaffNavigator /></QueryClientProvider>;
}

function StaffNavigator() {
  const pathname = usePathname();
  const router = useRouter();
  const publicRoute = pathname === "/" || ["/workspace", "/mfa", "/invitation"].includes(pathname);
  const stack = <Stack screenOptions={{ headerShown: false }} />;
  if (publicRoute) return stack;
  const active = pathname.includes("shift") || pathname.includes("calendar") ? "schedule" : pathname.includes("appointment") ? "queue" : "more";
  return <MobileShell activeTab={active} tabs={[
    { key: "today", label: "Today", icon: "home", onPress: () => router.replace("/") },
    { key: "schedule", label: "Schedule", icon: "calendar", onPress: () => router.push("/shifts") },
    { key: "queue", label: "Guests", icon: "people", onPress: () => router.push("/upcomingAppointments") },
    { key: "more", label: "More", icon: "more", onPress: () => router.push("/profile") },
  ]}>{stack}</MobileShell>;
}

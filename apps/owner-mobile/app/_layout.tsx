import { Stack, usePathname, useRouter } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { MobileShell } from "@nailsoft/ui-native";

export default function Layout() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 2, staleTime: 60_000 } } }));
  return <QueryClientProvider client={client}><OwnerNavigator /></QueryClientProvider>;
}

function OwnerNavigator() {
  const pathname = usePathname(); const router = useRouter();
  const publicRoute = pathname === "/" || ["/workspace", "/mfa", "/invitation"].includes(pathname);
  const stack = <Stack screenOptions={{ headerShown: false }} />;
  if (publicRoute) return stack;
  const active = pathname.includes("appointment") ? "bookings" : pathname.includes("analytics") ? "insights" : "more";
  return <MobileShell activeTab={active} tabs={[
    { key: "home", label: "Overview", icon: "home", onPress: () => router.replace("/") },
    { key: "bookings", label: "Bookings", icon: "calendar", onPress: () => router.push("/appointmentsToday") },
    { key: "insights", label: "Insights", icon: "chart", onPress: () => router.push("/analyticsOverview") },
    { key: "more", label: "More", icon: "more", onPress: () => router.push("/profile") },
  ]}>{stack}</MobileShell>;
}

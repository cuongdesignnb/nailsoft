import { Stack, usePathname, useRouter } from "expo-router";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { MobileShell } from "@nailsoft/ui-native";
import { getAuthContext, getSession } from "../lib/session";
import { staffTabForPath, visibleStaffTabs } from "../lib/wave9/permissions";
import { staffText } from "../lib/wave9/i18n";

export default function Layout() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 2, staleTime: 60_000 } } }));
  return <QueryClientProvider client={client}><StaffNavigator /></QueryClientProvider>;
}

function StaffNavigator() {
  const pathname = usePathname();
  const router = useRouter();
  const publicRoute = pathname === "/" || ["/workspace", "/mfa", "/invitation"].includes(pathname);
  const stack = <Stack screenOptions={{ headerShown: false }} />;
  const contextQuery = useQuery({ queryKey: ["staff-shell-context"], queryFn: getAuthContext, enabled: !publicRoute && !!getSession().accessToken, staleTime: 60_000 });
  if (publicRoute) return stack;
  if (!contextQuery.data || contextQuery.data.capabilities?.staffMobileEnabled !== true) return stack;
  const context = contextQuery.data;
  const visible = visibleStaffTabs(context);
  const tabs = [
    { key: "today" as const, label: staffText(context.user.locale, "home"), icon: "home" as const, onPress: () => router.replace("/") },
    { key: "schedule" as const, label: staffText(context.user.locale, "schedule"), icon: "calendar" as const, onPress: () => router.push("/shifts") },
    { key: "queue" as const, label: staffText(context.user.locale, "queue"), icon: "people" as const, onPress: () => router.push("/upcomingAppointments") },
    { key: "more" as const, label: staffText(context.user.locale, "more"), icon: "more" as const, onPress: () => router.push("/profile") },
  ].filter((tab) => visible.includes(tab.key));
  return <MobileShell activeTab={staffTabForPath(pathname)} tabs={tabs}>{stack}</MobileShell>;
}

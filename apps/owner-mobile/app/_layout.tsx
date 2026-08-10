import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Stack, usePathname, useRouter } from "expo-router";
import { useState } from "react";
import { MobileShell } from "@nailsoft/ui-native";
import { translate } from "@nailsoft/localization";
import { getAuthContext } from "../lib/session";
import { routeTabForPath, visibleTabs } from "../lib/wave8/permissions";

export default function Layout() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 2, staleTime: 60_000 } } }));
  return <QueryClientProvider client={client}><OwnerNavigator /></QueryClientProvider>;
}

function OwnerNavigator() {
  const pathname = usePathname();
  const router = useRouter();
  const publicRoute = pathname === "/" || ["/workspace", "/mfa", "/invitation"].includes(pathname);
  const contextQuery = useQuery({ queryKey: ["owner-auth-context", "navigation"], queryFn: getAuthContext, enabled: !publicRoute, staleTime: 30_000 });
  const stack = <Stack screenOptions={{ headerShown: false }} />;
  if (publicRoute || !contextQuery.data) return stack;
  const context = contextQuery.data;
  const tabKeys = visibleTabs(context).map((tab) => tab.key);
  const locale = context.user.locale;
  const tabs = [
    { key: "home", label: translate(locale, "dashboard"), icon: "home" as const, onPress: () => router.replace("/") },
    { key: "bookings", label: translate(locale, "bookings"), icon: "calendar" as const, onPress: () => router.push("/appointmentsToday") },
    { key: "insights", label: translate(locale, "analytics"), icon: "chart" as const, onPress: () => router.push("/analyticsOverview") },
    { key: "more", label: translate(locale, "more"), icon: "more" as const, onPress: () => router.push("/profile") },
  ].filter((tab) => tabKeys.includes(tab.key as "home" | "bookings" | "insights" | "more"));
  return <MobileShell activeTab={routeTabForPath(pathname)} tabs={tabs}>{stack}</MobileShell>;
}

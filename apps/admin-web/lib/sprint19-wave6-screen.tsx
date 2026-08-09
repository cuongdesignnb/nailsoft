"use client";

import { usePathname } from "next/navigation";
import { routeForWave6, isWave6Path } from "./sprint19-wave6/routes";
import AccountingWorkspace from "./sprint19-wave6/accounting";
import BankingWorkspace from "./sprint19-wave6/banking";
import TenantBillingWorkspace from "./sprint19-wave6/tenant-billing";
import PlatformCatalogWorkspace from "./sprint19-wave6/platform-catalog";
import PlatformTenantsWorkspace from "./sprint19-wave6/platform-tenants";
import PlatformPaymentsWorkspace from "./sprint19-wave6/platform-payments";
import SupportAccessWorkspace from "./sprint19-wave6/support-access";
import AnalyticsWorkspace from "./sprint19-wave6/analytics";

export { isWave6Path };

export default function Sprint19Wave6Screen({ pathname: explicitPath }: { pathname?: string } = {}) {
  const currentPath = usePathname(); const pathname = explicitPath ?? currentPath; const route = routeForWave6(pathname);
  if (route.area === "accounting") return <AccountingWorkspace route={route} />;
  if (route.area === "banking") return <BankingWorkspace route={route} />;
  if (route.area === "tenant-billing") return <TenantBillingWorkspace route={route} />;
  if (route.area === "platform-catalog") return <PlatformCatalogWorkspace route={route} />;
  if (route.area === "platform-tenants") return <PlatformTenantsWorkspace route={route} />;
  if (route.area === "platform-payments") return <PlatformPaymentsWorkspace route={route} />;
  if (route.area === "support-access") return <SupportAccessWorkspace route={route} />;
  return <AnalyticsWorkspace route={route} />;
}

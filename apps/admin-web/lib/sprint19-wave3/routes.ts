export function isWave3CustomerPath(pathname: string) {
  return (
    pathname === "/admin/customers" ||
    pathname === "/admin/customers/" ||
    pathname === "/admin/customers/new" ||
    /^\/admin\/customers\/[^/]+$/.test(pathname)
  );
}

export function isWave3CustomerEngagementPath(pathname: string) {
  return /^\/admin\/customers\/[^/]+\/engagement$/.test(pathname);
}

export function isWave3Cluster2Path(pathname: string) {
  return pathname === "/admin/benefits" || pathname === "/admin/benefits/" ||
    /^\/admin\/benefits\/customers\/[^/]+$/.test(pathname) ||
    pathname === "/admin/loyalty/programs" || pathname === "/admin/loyalty/adjustments" ||
    /^\/admin\/loyalty\/customers\/[^/]+$/.test(pathname) ||
    pathname === "/admin/membership/tiers" || /^\/admin\/membership\/customers\/[^/]+$/.test(pathname) ||
    pathname === "/admin/packages/catalog" || /^\/admin\/packages\/catalog\/[^/]+$/.test(pathname) ||
    pathname === "/admin/packages/entitlements" || /^\/admin\/packages\/entitlements\/[^/]+$/.test(pathname);
}

export function isWave3Cluster3Path(pathname: string) {
  return pathname === "/admin/vouchers/campaigns" ||
    /^\/admin\/vouchers\/campaigns\/[^/]+$/.test(pathname) ||
    pathname === "/admin/vouchers/codes" ||
    pathname === "/admin/gift-cards" ||
    pathname === "/admin/gift-cards/products" ||
    pathname === "/admin/gift-cards/issuance" ||
    /^\/admin\/gift-cards\/[^/]+$/.test(pathname) ||
    pathname === "/admin/customer-credit" ||
    pathname === "/admin/stored-value/adjustments";
}

export function isWave3Cluster4Path(pathname: string) {
  return pathname === "/admin/communications/templates" ||
    pathname === "/admin/communications/rules" ||
    pathname === "/admin/communications/messages" ||
    pathname === "/admin/communications/suppressions" ||
    pathname === "/admin/marketing/segments" ||
    pathname === "/admin/marketing/campaigns" ||
    /^\/admin\/marketing\/campaigns\/[^/]+$/.test(pathname) ||
    pathname === "/admin/reviews" ||
    /^\/admin\/reviews\/[^/]+$/.test(pathname) ||
    pathname === "/admin/review-requests" ||
    pathname === "/admin/service-recovery" ||
    /^\/admin\/service-recovery\/[^/]+$/.test(pathname);
}

export function isWave3Path(pathname: string) {
  return isWave3CustomerPath(pathname) || isWave3Cluster2Path(pathname) || isWave3Cluster3Path(pathname) || isWave3Cluster4Path(pathname);
}

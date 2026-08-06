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

export function isWave3Path(pathname: string) {
  return isWave3CustomerPath(pathname) || isWave3Cluster2Path(pathname);
}

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

export type Wave6Area =
  | "accounting"
  | "banking"
  | "tenant-billing"
  | "platform-catalog"
  | "platform-tenants"
  | "platform-payments"
  | "support-access"
  | "analytics";

export type Wave6Route = {
  screenId: string;
  title: string;
  area: Wave6Area;
  href: string;
  description: string;
};

export const wave6Routes: Wave6Route[] = [
  { screenId: "19.6.1", title: "Accounting control center", area: "accounting", href: "/admin/accounting", description: "Books, periods, postings and close readiness." },
  { screenId: "19.6.2", title: "Books & chart", area: "accounting", href: "/admin/accounting/books", description: "Books and the chart of accounts." },
  { screenId: "19.6.3", title: "Accounting periods", area: "accounting", href: "/admin/accounting/periods", description: "Dual-control period lifecycle." },
  { screenId: "19.6.4", title: "Journal workbench", area: "accounting", href: "/admin/accounting/journals", description: "Balanced journals and immutable posting evidence." },
  { screenId: "19.6.5", title: "Posting queue", area: "accounting", href: "/admin/accounting/posting-candidates", description: "Source events waiting for posting." },
  { screenId: "19.6.6", title: "Open items", area: "accounting", href: "/admin/accounting/open-items", description: "Tenant-scoped settlement work." },
  { screenId: "19.6.7", title: "Financial reports", area: "accounting", href: "/admin/accounting/reports", description: "Server-generated statements and report periods." },
  { screenId: "19.6.8", title: "Bank accounts & imports", area: "banking", href: "/admin/accounting/reconciliation", description: "Bank accounts and statement import evidence." },
  { screenId: "19.6.9", title: "Statement lines & matching", area: "banking", href: "/admin/accounting/reconciliation/statement-lines", description: "Review statement lines and existing matches." },
  { screenId: "19.6.10", title: "Reconciliation & exceptions", area: "banking", href: "/admin/accounting/reconciliation/exceptions", description: "Reconciliation lifecycle and persisted exceptions." },
  { screenId: "19.6.11", title: "Statement snapshots", area: "banking", href: "/admin/accounting/statement-snapshots", description: "Immutable statement snapshot evidence." },
  { screenId: "19.6.12", title: "Billing overview", area: "tenant-billing", href: "/admin/billing", description: "Subscription billing, access and renewal." },
  { screenId: "19.6.13", title: "Subscription", area: "tenant-billing", href: "/admin/billing/subscription", description: "Server-authoritative subscription lifecycle." },
  { screenId: "19.6.14", title: "Plans, entitlements & usage", area: "tenant-billing", href: "/admin/billing/usage", description: "Plan, effective entitlements, quota and usage." },
  { screenId: "19.6.15", title: "Invoices & history", area: "tenant-billing", href: "/admin/billing/invoices", description: "Platform subscription invoices, not salon POS invoices." },
  { screenId: "19.6.16", title: "Invoice detail", area: "tenant-billing", href: "/admin/billing/invoices/detail", description: "Immutable invoice evidence and collection status." },
  { screenId: "19.6.17", title: "Payment methods", area: "tenant-billing", href: "/admin/billing/payment-methods", description: "Masked provider payment methods." },
  { screenId: "19.6.18", title: "Tenant support access", area: "tenant-billing", href: "/admin/support-access", description: "Scoped support grants with expiry and dual control." },
  { screenId: "19.6.19", title: "Plan, price & discount catalog", area: "platform-catalog", href: "/platform/plans", description: "Immutable plan and price lifecycle; discounts are read-only." },
  { screenId: "19.6.20", title: "Tenant directory", area: "platform-tenants", href: "/platform/tenants", description: "Global platform tenant directory or scoped support target." },
  { screenId: "19.6.21", title: "Tenant detail & lifecycle", area: "platform-tenants", href: "/platform/tenants/detail", description: "Tenant billing lifecycle without salon operations." },
  { screenId: "19.6.22", title: "Tenant subscription", area: "platform-tenants", href: "/platform/tenants/subscription", description: "Tenant subscription status and plan." },
  { screenId: "19.6.23", title: "Tenant entitlements & usage", area: "platform-tenants", href: "/platform/tenants/entitlements", description: "Effective server-authoritative entitlements and usage." },
  { screenId: "19.6.24", title: "Tenant invoices & payments", area: "platform-tenants", href: "/platform/tenants/invoices", description: "Target tenant invoices and payment evidence." },
  { screenId: "19.6.25", title: "Platform invoice & payment operations", area: "platform-payments", href: "/platform/invoices", description: "Invoice and payment operations with explicit status." },
  { screenId: "19.6.26", title: "Refund & reconciliation", area: "platform-payments", href: "/platform/refunds", description: "Independent refund approval and unknown-outcome reconciliation." },
  { screenId: "19.6.27", title: "Dunning & platform reports", area: "platform-payments", href: "/platform/dunning", description: "Read-only delinquency monitoring and SaaS reports." },
  { screenId: "19.6.28", title: "Platform support access", area: "support-access", href: "/platform/support-access", description: "Platform support grant administration and scope." },
  { screenId: "19.6.29", title: "Break-glass safety", area: "support-access", href: "/platform/break-glass", description: "Emergency access is intentionally disabled." },
  { screenId: "19.6.30", title: "Analytics command center", area: "analytics", href: "/admin/analytics", description: "KPIs, trends, branches, alerts and freshness." },
  { screenId: "19.6.31", title: "Sales analytics", area: "analytics", href: "/admin/analytics/sales", description: "Server-generated sales and service performance." },
  { screenId: "19.6.32", title: "Booking analytics", area: "analytics", href: "/admin/analytics/bookings", description: "Business-date booking and utilization metrics." },
  { screenId: "19.6.33", title: "Staff analytics", area: "analytics", href: "/admin/analytics/staff", description: "Permission-scoped workforce analytics." },
  { screenId: "19.6.34", title: "Data quality, alerts & exports", area: "analytics", href: "/admin/analytics/data-quality", description: "Projection health, alerts, exports and rebuild evidence." },
];

export function isWave6AnalyticsPath(pathname: string) {
  return ["/admin/analytics", "/admin/analytics/sales", "/admin/analytics/bookings", "/admin/analytics/staff", "/admin/analytics/data-quality"].includes(pathname);
}

export function isWave6Path(pathname: string) {
  if (isWave6AnalyticsPath(pathname)) return true;
  if (pathname === "/admin/accounting" || pathname.startsWith("/admin/accounting/")) return true;
  if (pathname === "/admin/billing" || pathname.startsWith("/admin/billing/") || pathname === "/admin/support-access") return true;
  if (pathname === "/platform" || pathname.startsWith("/platform/")) return true;
  return false;
}

export function routeForWave6(pathname: string) {
  if (isWave6AnalyticsPath(pathname)) return wave6Routes.find((route) => route.href === pathname) ?? wave6Routes[29]!;
  const direct = wave6Routes.find((route) => route.href === pathname);
  if (direct) return direct;
  const aliases: Record<string, number> = {
    "/platform/prices": 18,
    "/platform/discounts": 18,
    "/platform/payments": 24,
    "/platform/reconciliation": 25,
    "/platform/reports": 26,
  };
  if (pathname in aliases) {
    const base = wave6Routes[aliases[pathname]!]!;
    return { ...base, href: pathname, title: pathname === "/platform/prices" ? "Price catalog" : pathname === "/platform/discounts" ? "Discount catalog" : pathname === "/platform/payments" ? "Payment operations" : pathname === "/platform/reconciliation" ? "Payment reconciliation" : "Platform reports" };
  }
  if (/^\/admin\/billing\/invoices\/[^/]+$/.test(pathname)) return { ...wave6Routes[15]!, href: pathname, title: "Invoice detail" };
  if (/^\/platform\/tenants\/[^/]+/.test(pathname)) {
    const suffix = pathname.split("/").slice(4).join("/");
    const title = suffix ? `Tenant ${suffix.replaceAll("-", " ")}` : "Tenant detail & lifecycle";
    return { ...wave6Routes[20]!, href: pathname, title };
  }
  if (pathname === "/platform") return wave6Routes[18]!;
  return wave6Routes.find((route) => route.area === "platform-catalog") ?? wave6Routes[18]!;
}

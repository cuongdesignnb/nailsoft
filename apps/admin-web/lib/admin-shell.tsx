"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { translate } from "@nailsoft/localization";
import { Button, Icon, StatePanel } from "@nailsoft/ui-web";
import { ACTIVE_BRANCH_CHANGED_EVENT, getActiveBranchId, getAuthContext, setActiveBranchId } from "./auth";
import { canSeeNavigation, navigationRegistry } from "./navigation-registry";

export function AdminShell({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } }));
  return <QueryClientProvider client={client}><AuthenticatedAdminShell>{children}</AuthenticatedAdminShell></QueryClientProvider>;
}

function AuthenticatedAdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [activeBranchId, setShellActiveBranchId] = useState<string | undefined>(() => getActiveBranchId());
  const contextQuery = useQuery({ queryKey: ["auth-context"], queryFn: getAuthContext });
  const context = contextQuery.data;
  useEffect(() => {
    const handleBranchChange = (event: Event) => {
      setShellActiveBranchId((event as CustomEvent<string | undefined>).detail);
    };
    window.addEventListener(ACTIVE_BRANCH_CHANGED_EVENT, handleBranchChange);
    return () => window.removeEventListener(ACTIVE_BRANCH_CHANGED_EVENT, handleBranchChange);
  }, []);
  useEffect(() => {
    if (!context) return;
    const grantedBranchIds = context.supportAccess?.branchIds ?? context.authorization.branchIds;
    const authorizedBranches = context.branches.filter((branch) => grantedBranchIds.includes(branch.id) && branch.status === "ACTIVE");
    const storedBranchId = getActiveBranchId();
    const storedBranchIsAuthorized = Boolean(storedBranchId && authorizedBranches.some((branch) => branch.id === storedBranchId));
    if (authorizedBranches.length === 1 && authorizedBranches[0]) {
      const nextBranchId = authorizedBranches[0].id;
      setShellActiveBranchId(nextBranchId);
      if (storedBranchId !== nextBranchId) setActiveBranchId(nextBranchId);
    } else if (authorizedBranches.length > 1 && storedBranchIsAuthorized) {
      setShellActiveBranchId(storedBranchId);
    } else {
      setShellActiveBranchId(undefined);
      if (storedBranchId) setActiveBranchId(undefined);
    }
  }, [context]);
  useEffect(() => {
    const handleInternalNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as Element | null;
      const anchor = target?.closest("a");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return;
      event.preventDefault();
      setNavigationOpen(false);
      router.push(`${url.pathname}${url.search}${url.hash}`);
    };
    document.addEventListener("click", handleInternalNavigation);
    return () => document.removeEventListener("click", handleInternalNavigation);
  }, [router]);
  const visibleGroups = context ? navigationRegistry.map((group) => ({ ...group, items: group.items.filter((item) => canSeeNavigation(item, context)) })).filter((group) => group.items.length > 0) : [];
  if (contextQuery.isPending) return <div className="ns-shell-loading"><StatePanel state="loading" title="Đang tải không gian làm việc" detail="Đang kiểm tra quyền truy cập và phạm vi chi nhánh của bạn." /></div>;
  if (contextQuery.isError || !context) return <UnauthenticatedAdminShell>{children}</UnauthenticatedAdminShell>;
  const locale = context.user.locale;
  const platformRoute = pathname === "/platform" || pathname.startsWith("/platform/");
  const grantedBranchIds = context.supportAccess?.branchIds ?? context.authorization.branchIds;
  const authorizedBranches = context.branches.filter((branch) => grantedBranchIds.includes(branch.id) && branch.status === "ACTIVE");
  const branchId = activeBranchId && authorizedBranches.some((branch) => branch.id === activeBranchId) ? activeBranchId : undefined;
  const selectBranch = (nextBranchId: string | undefined) => {
    const authorizedSelection = nextBranchId && authorizedBranches.some((branch) => branch.id === nextBranchId) ? nextBranchId : undefined;
    setShellActiveBranchId(authorizedSelection);
    setActiveBranchId(authorizedSelection);
  };
  const roleLabel = context.authorization.roles[0] === "SALON_OWNER" ? "Chủ salon" : context.authorization.roles[0] === "PLATFORM_SUPER_ADMIN" ? "Quản trị nền tảng" : "Quản trị viên";
  return <div className={`ns-app-frame ${compact ? "ns-app-frame--compact" : ""}`}>
    <a className="ns-skip-link" href="#main-content">{translate(locale, "skipToContent")}</a>
    <aside className={`ns-admin-sidebar ${navigationOpen ? "ns-admin-sidebar--open" : ""}`} aria-label={translate(locale, "navigation")}>
      <Link className="ns-brand" href="/admin/dashboard"><span className="ns-brand__mark"><span>N</span></span><span className="ns-brand__wordmark"><strong>NailSoft</strong><small>— CMS —</small></span></Link>
       <nav>{visibleGroups.map((group) => <section key={group.label} className="ns-nav-group"><p>{translate(locale, group.label)}</p>{group.items.map((item) => { const isAppointmentsRoute = item.href === "/admin/calendar" && (pathname === "/admin/appointments" || pathname.startsWith("/admin/appointments/")); const isCustomerMarketingRoute = pathname === "/admin/marketing/segments" || pathname === "/admin/marketing/campaigns" || pathname.startsWith("/admin/marketing/campaigns/"); const isCustomerBenefitsRoute = item.href === "/admin/customers" && (pathname === "/admin/benefits" || pathname.startsWith("/admin/benefits/") || pathname === "/admin/membership" || pathname.startsWith("/admin/membership/") || pathname.startsWith("/admin/loyalty/") || pathname.startsWith("/admin/packages/") || pathname.startsWith("/admin/vouchers/") || pathname.startsWith("/admin/gift-cards") || pathname === "/admin/customer-credit" || pathname.startsWith("/admin/stored-value/") || pathname === "/admin/customer-care" || pathname.startsWith("/admin/customer-care/") || isCustomerMarketingRoute); const isMarketingTopLevelRoute = item.href === "/admin/marketing" && isCustomerMarketingRoute; const isCurrent = !isMarketingTopLevelRoute && (pathname === item.href || pathname.startsWith(`${item.href}/`) || isAppointmentsRoute || isCustomerBenefitsRoute); return <Link key={item.href} href={item.href} aria-label={translate(locale, item.label)} aria-current={isCurrent ? "page" : undefined}><Icon name={item.icon} /> <span>{translate(locale, item.label)}</span></Link>; })}</section>)}</nav>
      <Button variant="quiet" className="ns-sidebar-collapse" onClick={() => setCompact((value) => !value)} aria-label="Thu gọn menu"><Icon name="chevronLeft" /> <span>Thu gọn menu</span></Button>
    </aside>
    {navigationOpen ? <button className="ns-nav-backdrop" aria-label="Đóng menu điều hướng" onClick={() => setNavigationOpen(false)} /> : null}
    <div className="ns-app-body">
      <header className="ns-admin-header">
        <Button variant="quiet" className="ns-mobile-menu" aria-label={translate(locale, "menu")} onClick={() => setNavigationOpen(true)}><Icon name="menu" /></Button>
        <Link className="ns-global-search" href="/admin/customers" aria-label="Mở tìm kiếm khách hàng"><Icon name="search" /><span>Tìm kiếm nhanh...</span></Link>
        <div className="ns-header-actions">
          {platformRoute ? <span className="ns-status ns-status--info">PLATFORM ADMIN</span> : <label className="ns-branch-picker"><span className="sr-only">{translate(locale, "branch")}</span><Icon name="store" /><select value={branchId ?? ""} onChange={(event) => selectBranch(event.target.value || undefined)}>{authorizedBranches.length === 0 || authorizedBranches.length > 1 ? <option value="" aria-label={translate(locale, "workspace")}>Workspace</option> : null}{authorizedBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
          <div className="ns-header-date"><Icon name="calendar" /><span>Hôm nay · {new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date())}</span><Icon name="chevronDown" /></div>
          <Link className="ns-notification-link" href="/admin/communications" aria-label={translate(locale, "notifications")}><Icon name="notification" /></Link>
          <Link className="ns-user-menu" href="/admin/profile"><span className="ns-avatar">{context.user.displayName.slice(0, 1).toUpperCase()}</span><span className="ns-user-details"><strong>{context.user.displayName}</strong><small>{roleLabel}</small></span><Icon name="chevronDown" /></Link>
        </div>
      </header>
      <div id="main-content" className="ns-route-slot" tabIndex={-1}>{children}</div>
    </div>
  </div>;
}

function UnauthenticatedAdminShell({ children }: { children: ReactNode }) {
  return <div className="ns-app-frame"><a className="ns-skip-link" href="#main-content">Bỏ qua đến nội dung chính</a><aside className="ns-admin-sidebar" aria-label="Điều hướng"><Link className="ns-brand" href="/admin/dashboard"><span className="ns-brand__mark">N</span><span>Nailsoft</span></Link><nav><section className="ns-nav-group"><p>Không gian làm việc</p><Link href="/admin/dashboard"><Icon name="home" /><span>Tổng quan</span></Link><Link href="/auth/login"><Icon name="lock" /><span>Đăng nhập</span></Link></section></nav></aside><div className="ns-app-body"><header className="ns-admin-header"><div className="ns-breadcrumb"><strong>Cần đăng nhập để truy cập</strong></div><Link className="ns-user-menu" href="/auth/login"><Icon name="lock" /><span>Đăng nhập</span></Link></header><div id="main-content" className="ns-route-slot" tabIndex={-1}>{children}</div></div></div>;
}

"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { translate } from "@nailsoft/localization";
import { Button, Icon, StatePanel } from "@nailsoft/ui-web";
import { ACTIVE_BRANCH_CHANGED_EVENT, getActiveBranchId, getAuthContext, setActiveBranchId } from "./auth";
import {
  activeNavigationItemId,
  activeNavigationGroupIds,
  visibleNavigation,
  type NavigationGroup,
} from "./navigation-registry";

export function AdminShell({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } }));
  return <QueryClientProvider client={client}><AuthenticatedAdminShell>{children}</AuthenticatedAdminShell></QueryClientProvider>;
}

function AuthenticatedAdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
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
  const visibleGroups = context ? visibleNavigation(context) : [];
  const activeGroupIds = activeNavigationGroupIds(visibleGroups, pathname);
  useEffect(() => {
    if (!activeGroupIds.length) return;
    setOpenGroups((current) => {
      const next = { ...current };
      activeGroupIds.forEach((id) => { next[id] = true; });
      return next;
    });
  }, [activeGroupIds.join("|")]);
  useEffect(() => {
    if (!navigationOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavigationOpen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [navigationOpen]);
  if (contextQuery.isPending) return <div className="ns-shell-loading"><StatePanel state="loading" title="Đang tải không gian làm việc" detail="Đang kiểm tra quyền truy cập và phạm vi chi nhánh." /></div>;
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
      <NavigationTree
        groups={visibleGroups}
        pathname={pathname}
        compact={compact}
        openGroups={openGroups}
        onToggle={(id) => setOpenGroups((current) => ({ ...current, [id]: !current[id] }))}
        onNavigate={() => setNavigationOpen(false)}
      />
      <Button variant="quiet" className="ns-sidebar-collapse" onClick={() => setCompact((value) => !value)} aria-label={compact ? "Mở rộng menu" : "Thu gọn menu"}><Icon name="chevronLeft" /> <span>{compact ? "Mở rộng menu" : "Thu gọn menu"}</span></Button>
    </aside>
    {navigationOpen ? <button className="ns-nav-backdrop" aria-label="Đóng điều hướng" onClick={() => setNavigationOpen(false)} /> : null}
    <div className="ns-app-body">
      <header className="ns-admin-header">
        <Button variant="quiet" className="ns-mobile-menu" aria-label={translate(locale, "menu")} onClick={() => setNavigationOpen(true)}><Icon name="menu" /></Button>
        <Link className="ns-global-search" href="/admin/customers" aria-label="Mở tìm kiếm khách hàng"><Icon name="search" /><span>Tìm kiếm nhanh...</span></Link>
        <div className="ns-header-actions">
          {platformRoute ? <span className="ns-status ns-status--info">PLATFORM ADMIN</span> : <label className="ns-branch-picker"><span className="sr-only">{translate(locale, "branch")}</span><Icon name="store" /><select value={branchId ?? ""} onChange={(event) => selectBranch(event.target.value || undefined)}>{authorizedBranches.length === 0 || authorizedBranches.length > 1 ? <option value="" aria-label={translate(locale, "workspace")}>Không gian làm việc</option> : null}{authorizedBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
          <div className="ns-header-date"><Icon name="calendar" /><span>Hôm nay · {new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date())}</span><Icon name="chevronDown" /></div>
          <Link className="ns-notification-link" href="/admin/communications" aria-label={translate(locale, "notifications")}><Icon name="notification" /></Link>
          <Link className="ns-user-menu" href="/admin/profile"><span className="ns-avatar">{context.user.displayName.slice(0, 1).toUpperCase()}</span><span className="ns-user-details"><strong>{context.user.displayName}</strong><small>{roleLabel}</small></span><Icon name="chevronDown" /></Link>
        </div>
      </header>
      <div id="main-content" className="ns-route-slot" tabIndex={-1}>{children}</div>
    </div>
  </div>;
}

function NavigationTree({
  groups,
  pathname,
  compact,
  openGroups,
  onToggle,
  onNavigate,
}: {
  groups: NavigationGroup[];
  pathname: string;
  compact: boolean;
  openGroups: Record<string, boolean>;
  onToggle: (id: string) => void;
  onNavigate: () => void;
}) {
  return <nav className="ns-navigation-tree ns-nav-group" aria-label="Điều hướng chính">
    {groups.map((group) => {
      const activeItemId = activeNavigationItemId(group, pathname);
      const active = Boolean(activeItemId);
      const open = openGroups[group.id] ?? active;
      const controlId = `ns-nav-children-${group.id}`;
      const single = group.items.length === 1;
      return <section key={group.id} className={`ns-nav-section${active ? " ns-nav-section--active" : ""}${open ? " ns-nav-section--open" : ""}`} data-open={open ? "true" : "false"} data-active={active ? "true" : "false"}>
        {single ? <a className="ns-nav-parent ns-nav-parent--single" href={group.items[0]!.href} aria-current={activeItemId === group.items[0]!.id ? "page" : undefined} onClick={onNavigate}>
          <Icon name={group.icon} /><span>{group.label}</span>
        </a> : <button className="ns-nav-parent" type="button" aria-expanded={open} aria-controls={controlId} onClick={() => onToggle(group.id)}>
          <Icon name={group.icon} /><span>{group.label}</span><Icon name="chevronDown" />
        </button>}
        {!single ? <div id={controlId} className="ns-nav-children" aria-hidden={!open}>
          {group.items.map((item) => {
            const current = activeItemId === item.id;
            return <a key={item.id} className="ns-nav-child" href={item.href} aria-current={current ? "page" : undefined} onClick={onNavigate}>
              <Icon name={item.icon} /><span>{item.label}</span>
            </a>;
          })}
        </div> : null}
      </section>;
    })}
    <span className="sr-only">{compact ? "Menu thu gọn: chọn một nhóm để mở các trang con." : "Mỗi nhóm có thể mở rộng để hiển thị các trang con."}</span>
  </nav>;
}

function UnauthenticatedAdminShell({ children }: { children: ReactNode }) {
  return <div className="ns-app-frame"><a className="ns-skip-link" href="#main-content">Bỏ qua đến nội dung</a><aside className="ns-admin-sidebar" aria-label="Điều hướng"><Link className="ns-brand" href="/admin/dashboard"><span className="ns-brand__mark">N</span><span>Nailsoft</span></Link><nav><section className="ns-nav-group"><p>Không gian làm việc</p><Link href="/admin/dashboard"><Icon name="home" /><span>Tổng quan</span></Link><Link href="/auth/login"><Icon name="lock" /><span>Đăng nhập</span></Link></section></nav></aside><div className="ns-app-body"><header className="ns-admin-header"><div className="ns-breadcrumb"><strong>Cần đăng nhập để tiếp tục</strong></div><Link className="ns-user-menu" href="/auth/login"><Icon name="lock" /><span>Đăng nhập</span></Link></header><div id="main-content" className="ns-route-slot" tabIndex={-1}>{children}</div></div></div>;
}

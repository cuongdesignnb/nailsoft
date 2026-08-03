"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { translate } from "@nailsoft/localization";
import { Button, Icon, StatePanel, StatusBadge } from "@nailsoft/ui-web";
import { getActiveBranchId, getAuthContext, setActiveBranchId } from "./auth";
import { canSeeNavigation, navigationRegistry } from "./navigation-registry";

export function AdminShell({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } }));
  return <QueryClientProvider client={client}><AuthenticatedAdminShell>{children}</AuthenticatedAdminShell></QueryClientProvider>;
}

function AuthenticatedAdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const contextQuery = useQuery({ queryKey: ["auth-context"], queryFn: getAuthContext });
  const context = contextQuery.data;
  const visibleGroups = context ? navigationRegistry.map((group) => ({ ...group, items: group.items.filter((item) => canSeeNavigation(item, context)) })).filter((group) => group.items.length > 0) : [];
  const page = useMemo(() => visibleGroups.flatMap((group) => group.items).find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)), [pathname, visibleGroups]);
  if (contextQuery.isPending) return <div className="ns-shell-loading"><StatePanel state="loading" title="Loading workspace" detail="Checking your current access and branch scope." /></div>;
  if (contextQuery.isError || !context) return <UnauthenticatedAdminShell>{children}</UnauthenticatedAdminShell>;
  const locale = context.user.locale;
  const branchId = getActiveBranchId() ?? context.authorization.branchIds[0];
  const selectedBranch = context.branches.find((branch) => branch.id === branchId);
  return <div className={`ns-app-frame ${compact ? "ns-app-frame--compact" : ""}`}>
    <a className="ns-skip-link" href="#main-content">{translate(locale, "skipToContent")}</a>
    <aside className={`ns-admin-sidebar ${navigationOpen ? "ns-admin-sidebar--open" : ""}`} aria-label={translate(locale, "navigation")}>
      <a className="ns-brand" href="/admin/dashboard"><span className="ns-brand__mark">N</span><span>Nailsoft</span></a>
      <nav>{visibleGroups.map((group) => <section key={group.label} className="ns-nav-group"><p>{translate(locale, group.label)}</p>{group.items.map((item) => <a key={item.href} href={item.href} aria-current={pathname === item.href || pathname.startsWith(`${item.href}/`) ? "page" : undefined}><Icon name={item.icon} /> <span>{translate(locale, item.label)}</span></a>)}</section>)}</nav>
      <Button variant="quiet" className="ns-sidebar-collapse" onClick={() => setCompact((value) => !value)} aria-label="Toggle navigation density"><Icon name="chevronLeft" /> <span>Compact</span></Button>
    </aside>
    {navigationOpen ? <button className="ns-nav-backdrop" aria-label="Close navigation" onClick={() => setNavigationOpen(false)} /> : null}
    <div className="ns-app-body">
      <header className="ns-admin-header">
        <Button variant="quiet" className="ns-mobile-menu" aria-label={translate(locale, "menu")} onClick={() => setNavigationOpen(true)}><Icon name="menu" /></Button>
        <div className="ns-breadcrumb"><span>{context.workspace.tenantName}</span><span aria-hidden="true">/</span><strong>{page ? translate(locale, page.label) : translate(locale, "dashboard")}</strong></div>
        <div className="ns-header-actions">
          <label className="ns-branch-picker"><span className="sr-only">{translate(locale, "branch")}</span><Icon name="store" /><select value={branchId ?? ""} onChange={(event) => setActiveBranchId(event.target.value || undefined)}>{context.branches.length === 0 ? <option value="">{translate(locale, "workspace")}</option> : context.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <StatusBadge tone={context.workspace.accessMode === "FULL" || context.workspace.accessMode === "GRACE" ? "success" : "warning"}>{selectedBranch?.name ?? context.workspace.accessMode}</StatusBadge>
          <Button variant="quiet" aria-label={translate(locale, "notifications")}><Icon name="notification" /></Button>
          <a className="ns-user-menu" href="/admin/profile"><span className="ns-avatar">{context.user.displayName.slice(0, 1).toUpperCase()}</span><span>{context.user.displayName}</span></a>
        </div>
      </header>
      <div id="main-content" className="ns-route-slot" tabIndex={-1}>{children}</div>
    </div>
  </div>;
}

function UnauthenticatedAdminShell({ children }: { children: ReactNode }) {
  return <div className="ns-app-frame"><a className="ns-skip-link" href="#main-content">Skip to content</a><aside className="ns-admin-sidebar" aria-label="Navigation"><a className="ns-brand" href="/admin/dashboard"><span className="ns-brand__mark">N</span><span>Nailsoft</span></a><nav><section className="ns-nav-group"><p>Workspace</p><a href="/admin/dashboard"><Icon name="home" /><span>Dashboard</span></a><a href="/auth/login"><Icon name="lock" /><span>Sign in</span></a></section></nav></aside><div className="ns-app-body"><header className="ns-admin-header"><div className="ns-breadcrumb"><strong>Workspace access required</strong></div><a className="ns-user-menu" href="/auth/login"><Icon name="lock" /><span>Sign in</span></a></header><div id="main-content" className="ns-route-slot" tabIndex={-1}>{children}</div></div></div>;
}

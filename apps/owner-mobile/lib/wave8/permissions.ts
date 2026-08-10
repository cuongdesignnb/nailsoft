import type { AuthContext } from "@nailsoft/domain-types";

export type OwnerTab = "home" | "bookings" | "insights" | "more";
export type OwnerScope = "TENANT_WIDE" | "BRANCH_FILTERABLE" | "BRANCH_REQUIRED" | "USER";
export type OwnerRoute = {
  screen: string;
  titleKey: string;
  tab: OwnerTab;
  domain: string;
  readPermissions: string[];
  writePermissions?: string[];
  scope: OwnerScope;
};

const routes: OwnerRoute[] = [];
const add = (screen: string, tab: OwnerTab, domain: string, readPermissions: string[], scope: OwnerScope, writePermissions?: string[]) => {
  routes.push({ screen, titleKey: screen, tab, domain, readPermissions, scope, ...(writePermissions?.length ? { writePermissions } : {}) });
};

// Each screen has one descriptor.  This prevents a broad approval card from
// accidentally authorizing the same route as an inventory or finance card.
add("operationalSummary", "home", "operations", ["operations.board.read", "walkin.read"], "BRANCH_REQUIRED");
add("walkInQueue", "home", "operations", ["walkin.read"], "BRANCH_REQUIRED");
add("appointmentsToday", "bookings", "bookings", ["appointment.read_branch"], "BRANCH_REQUIRED");
for (const screen of ["appointments", "appointment"]) add(screen, "bookings", "bookings", ["appointment.read_branch"], "BRANCH_REQUIRED", ["appointment.confirm", "appointment.cancel", "appointment.waive_deposit"]);
for (const screen of ["calendarDay", "calendarWeek"]) add(screen, "bookings", "bookings", ["calendar.read_branch", "calendar.read_own"], "BRANCH_REQUIRED");
for (const screen of ["availability", "explain"]) add(screen, "bookings", "bookings", ["availability.read"], "BRANCH_REQUIRED");
for (const screen of ["blocks", "createBlock"]) add(screen, "bookings", "bookings", ["availability_block.read"], "BRANCH_REQUIRED", ["availability_block.create", "availability_block.update", "availability_block.cancel"]);
for (const screen of ["analyticsOverview", "analyticsBranches", "analyticsAlerts"]) add(screen, "insights", "analytics", ["analytics.dashboard.read"], "BRANCH_FILTERABLE");
add("lowRatingAlerts", "insights", "recovery", ["service_recovery.read"], "BRANCH_FILTERABLE", ["service_recovery.triage"]);
add("recoverySla", "insights", "recovery", ["service_recovery.read"], "BRANCH_FILTERABLE", ["service_recovery.triage"]);
add("financialSummary", "insights", "finance", ["financial.summary.read"], "BRANCH_FILTERABLE");
add("refundTotals", "insights", "finance", ["financial.refund_report.read"], "BRANCH_FILTERABLE");
add("commissionPeriods", "insights", "finance", ["financial.commission_report.read"], "BRANCH_FILTERABLE");
add("commissionReadiness", "insights", "finance", ["financial.commission_report.read"], "BRANCH_FILTERABLE");
for (const screen of ["benefitSummary", "benefitLiability", "voucherUsage", "membershipCounts", "expiringBenefits"]) add(screen, "insights", "benefits", ["analytics.benefit.read", "benefit.report.read", "benefit.liability.read"], "BRANCH_FILTERABLE");
for (const screen of ["storedValueLiability", "storedValueIssuance", "storedValueRedemption", "storedValueExceptions"]) add(screen, "insights", "stored-value", ["stored_value.report.read", "stored_value.liability.read"], "BRANCH_FILTERABLE");
add("customerCreditOutstanding", "insights", "stored-value", ["customer_credit.read"], "BRANCH_FILTERABLE");
add("pendingRefunds", "more", "approvals", ["refund.read"], "BRANCH_FILTERABLE", ["refund.approve", "refund.reject"]);
add("pendingLoyaltyAdjustments", "more", "approvals", ["loyalty.adjustment.request", "loyalty.adjustment.approve"], "BRANCH_FILTERABLE");
add("storedValueApprovals", "more", "approvals", ["customer_credit.adjustment.read"], "BRANCH_FILTERABLE", ["customer_credit.adjustment.approve"]);
add("campaignApprovals", "more", "approvals", ["marketing.campaign.read"], "BRANCH_FILTERABLE", ["marketing.campaign.approve"]);
add("compensationApprovals", "more", "approvals", ["service_recovery.compensation.request", "service_recovery.compensation.approve"], "BRANCH_FILTERABLE", ["service_recovery.compensation.approve"]);
add("leave", "more", "workforce", ["leave.read_branch", "leave.read_own"], "BRANCH_FILTERABLE");
add("leaveReview", "more", "workforce", ["leave.read_branch", "leave.read_own"], "BRANCH_FILTERABLE", ["leave.approve", "leave.reject"]);
add("timesheetApprovals", "more", "workforce", ["timesheet.read"], "BRANCH_FILTERABLE", ["timesheet.approve"]);
add("payrollApprovals", "more", "workforce", ["payroll.run.read"], "BRANCH_FILTERABLE", ["payroll.run.approve", "payroll.run.finalize"]);
add("payoutApprovals", "more", "workforce", ["payout.batch.read"], "BRANCH_FILTERABLE", ["payout.batch.approve"]);
for (const screen of ["attendanceSummary", "missingPunchAlerts"]) add(screen, "more", "workforce", ["workforce.report.read", "time_clock.exception.read"], "BRANCH_FILTERABLE");
add("payrollFailures", "more", "workforce", ["payroll.run.read"], "BRANCH_FILTERABLE");
add("inventoryLowStock", "more", "inventory-procurement", ["inventory.alert.read", "inventory.stock.read"], "BRANCH_FILTERABLE");
add("inventoryExpiry", "more", "inventory-procurement", ["inventory.alert.read", "inventory.stock.read"], "BRANCH_FILTERABLE");
add("inventoryVariances", "more", "inventory-procurement", ["inventory.adjustment.read", "inventory.stock.read"], "BRANCH_FILTERABLE");
add("inventoryValuation", "more", "inventory-procurement", ["inventory.cost.read", "inventory.report.read"], "BRANCH_FILTERABLE");
add("inventoryApprovals", "more", "inventory-procurement", ["inventory.purchase_order.read"], "BRANCH_FILTERABLE", ["inventory.purchase_order.approve"]);
add("procurementVendors", "more", "inventory-procurement", ["procurement.vendor.read"], "BRANCH_FILTERABLE");
add("procurementRequests", "more", "inventory-procurement", ["procurement.request.read"], "BRANCH_FILTERABLE", ["procurement.request.approve"]);
add("procurementOrders", "more", "inventory-procurement", ["procurement.po.read"], "BRANCH_FILTERABLE", ["procurement.po.approve"]);
add("procurementBills", "more", "inventory-procurement", ["procurement.bill.read"], "BRANCH_FILTERABLE");
add("procurementAp", "more", "inventory-procurement", ["procurement.ap.read"], "BRANCH_FILTERABLE");
add("procurementPayments", "more", "inventory-procurement", ["procurement.payment.read"], "BRANCH_FILTERABLE", ["procurement.payment.approve"]);
add("assetSummary", "more", "assets", ["asset.register.read", "asset.report.read"], "BRANCH_FILTERABLE");
add("assetApprovals", "more", "assets", ["asset.capitalization.read"], "BRANCH_FILTERABLE", ["asset.capitalization.approve"]);
add("assetMaintenance", "more", "assets", ["asset.maintenance.read"], "BRANCH_FILTERABLE");
add("assetTransfers", "more", "assets", ["asset.transfer.read"], "BRANCH_FILTERABLE");
add("assetDisposals", "more", "assets", ["asset.disposal.read"], "BRANCH_FILTERABLE");
for (const screen of ["billingPlan", "billingQuotas", "billingInvoices", "billingWarnings"]) add(screen, "more", "billing", ["tenant.billing.read"], "TENANT_WIDE");
add("supportAccess", "more", "security", ["tenant.support_grant.read"], "TENANT_WIDE", ["tenant.support_grant.approve"]);
for (const screen of ["sessions", "organization", "branches", "team", "invitation", "profile", "workspace", "mfa"]) add(screen, "more", "security", [screen === "sessions" ? "session.read_tenant" : screen === "organization" ? "organization.read" : screen === "branches" ? "branch.read" : "user.read"], "USER", screen === "sessions" ? ["session.revoke_tenant"] : undefined);

export const ownerRouteRegistry = routes;
export const ownerOperationalRouteRegistry = routes.map((route) => route.screen);

export function routeDescriptor(screen: string) {
  return ownerRouteRegistry.find((route) => route.screen === screen);
}

export function hasAnyPermission(context: AuthContext, permissions: string[] = []) {
  return !permissions.length || permissions.some((permission) => context.authorization.permissions.includes(permission));
}

export function canReadRoute(context: AuthContext, screen: string) {
  const route = routeDescriptor(screen);
  return !!route && hasAnyPermission(context, route.readPermissions);
}

export function canWriteRoute(context: AuthContext, screen: string, permission?: string) {
  const route = routeDescriptor(screen);
  return !!route && !!route.writePermissions?.length && (!permission || route.writePermissions.includes(permission)) && hasAnyPermission(context, route.writePermissions);
}

export function accessModeAllowsRoute(accessMode: string, route: OwnerRoute) {
  if (["TERMINATED", "SUSPENDED", "BILLING_ONLY"].includes(accessMode)) return route.domain === "billing" || route.domain === "security";
  return true;
}

export function routeTabForPath(pathname: string): OwnerTab {
  const screen = pathname.replace(/^\//, "").split("?")[0] ?? "";
  return routeDescriptor(screen)?.tab ?? (pathname === "/" ? "home" : "more");
}

export function visibleTabs(context: AuthContext) {
  const hasTab = (tab: OwnerTab) => ownerRouteRegistry.some((route) => route.tab === tab && accessModeAllowsRoute(context.workspace.accessMode, route) && canReadRoute(context, route.screen));
  return [
    { key: "home" as const, visible: true },
    { key: "bookings" as const, visible: hasTab("bookings") },
    { key: "insights" as const, visible: hasTab("insights") },
    { key: "more" as const, visible: true },
  ].filter((tab) => tab.visible);
}

import type { IconName } from "@nailsoft/icons";
import type { AuthContext, Role } from "@nailsoft/domain-types";

/**
 * The admin navigation is intentionally the only route taxonomy used by the
 * shell. A group is a level-one product area and each item is a level-two
 * destination. Workflow, detail and command routes stay discoverable from
 * their owning screen instead of becoming sidebar noise.
 */
export type NavigationItem = {
  id: string;
  href: string;
  label: string;
  icon: IconName;
  activePrefixes?: string[];
  permissionPrefixes?: string[];
  roles?: Role[];
};

export type NavigationGroup = {
  id: string;
  label: string;
  icon: IconName;
  items: NavigationItem[];
  permissionPrefixes?: string[];
  roles?: Role[];
};

const group = (
  id: string,
  label: string,
  icon: IconName,
  items: NavigationItem[],
  gate?: Pick<NavigationGroup, "permissionPrefixes" | "roles">,
): NavigationGroup => ({ id, label, icon, items, ...gate });

const item = (
  id: string,
  href: string,
  label: string,
  icon: IconName,
  gate?: Pick<NavigationItem, "activePrefixes" | "permissionPrefixes" | "roles">,
): NavigationItem => ({ id, href, label, icon, ...gate });

export const navigationRegistry: NavigationGroup[] = [
  group("overview", "Tổng quan", "home", [
    item("dashboard", "/admin/dashboard", "Tổng quan salon", "home"),
  ]),
  group("appointments", "Lịch hẹn", "calendar", [
    item("appointments", "/admin/appointments", "Danh sách lịch hẹn", "calendar", {
      activePrefixes: ["/admin/appointments"],
      permissionPrefixes: ["appointment.", "calendar."],
    }),
    item("calendar", "/admin/calendar", "Lịch salon", "calendar", {
      activePrefixes: ["/admin/calendar"],
      permissionPrefixes: ["appointment.", "calendar.", "availability."],
    }),
    item("availability", "/admin/availability", "Khả dụng", "check", {
      activePrefixes: ["/admin/availability"],
      permissionPrefixes: ["availability."],
    }),
    item("salon-operations", "/admin/operations/board", "Bảng vận hành", "activity", {
      activePrefixes: ["/admin/operations", "/admin/service-sessions"],
      permissionPrefixes: ["operations.", "walkin.", "service_session."],
    }),
  ]),
  group("customers", "Khách hàng", "customer", [
    item("customer-directory", "/admin/customers", "Danh sách khách hàng", "customer", {
      activePrefixes: ["/admin/customers"],
      permissionPrefixes: ["customer."],
    }),
    item("customer-care", "/admin/customer-care", "Liên hệ & chăm sóc", "phone", {
      activePrefixes: ["/admin/customer-care"],
      permissionPrefixes: ["customer.", "communication.", "service_recovery."],
    }),
    item("loyalty", "/admin/loyalty/programs", "Loyalty", "gift", {
      activePrefixes: ["/admin/loyalty"],
      permissionPrefixes: ["loyalty."],
    }),
    item("membership", "/admin/membership", "Membership", "people", {
      activePrefixes: ["/admin/membership"],
      permissionPrefixes: ["membership."],
    }),
    item("packages", "/admin/packages/catalog", "Gói dịch vụ", "package", {
      activePrefixes: ["/admin/packages"],
      permissionPrefixes: ["package."],
    }),
    item("vouchers", "/admin/vouchers/codes", "Voucher", "tag", {
      activePrefixes: ["/admin/vouchers"],
      permissionPrefixes: ["voucher."],
    }),
    item("gift-cards", "/admin/gift-cards", "Gift Card", "gift", {
      activePrefixes: ["/admin/gift-cards"],
      permissionPrefixes: ["gift_card."],
    }),
    item("customer-credit", "/admin/customer-credit", "Store Credit", "wallet", {
      activePrefixes: ["/admin/customer-credit", "/admin/stored-value"],
      permissionPrefixes: ["customer_credit.", "stored_value."],
    }),
  ]),
  group("services", "Dịch vụ", "package", [
    item("service-catalog", "/admin/catalog/services", "Danh mục dịch vụ", "package", {
      activePrefixes: ["/admin/catalog/services"],
      permissionPrefixes: ["service."],
    }),
    item("service-categories", "/admin/catalog/categories", "Nhóm dịch vụ", "tag", {
      activePrefixes: ["/admin/catalog/categories"],
      permissionPrefixes: ["service."],
    }),
    item("service-skills", "/admin/catalog/skills", "Kỹ năng", "check", {
      activePrefixes: ["/admin/catalog/skills"],
      permissionPrefixes: ["service.", "staff."],
    }),
    item("service-resources", "/admin/catalog/resources", "Tài nguyên phục vụ", "archive", {
      activePrefixes: ["/admin/catalog/resources"],
      permissionPrefixes: ["service.", "resource."],
    }),
  ]),
  group("staff", "Nhân sự", "staff", [
    item("staff-directory", "/admin/staff/list", "Danh sách nhân sự", "staff", {
      activePrefixes: ["/admin/staff"],
      permissionPrefixes: ["staff."],
    }),
    item("shift-scheduling", "/admin/scheduling/shifts", "Ca làm việc", "calendar", {
      activePrefixes: ["/admin/scheduling/shifts"],
      permissionPrefixes: ["shift.", "scheduling."],
    }),
    item("leave-requests", "/admin/scheduling/leave-requests", "Nghỉ phép", "calendar", {
      activePrefixes: ["/admin/scheduling/leave-requests"],
      permissionPrefixes: ["leave."],
    }),
    item("time-clock", "/admin/time-clock", "Chấm công", "clock", {
      activePrefixes: ["/admin/time-clock"],
      permissionPrefixes: ["time_clock."],
    }),
    item("timesheets", "/admin/timesheets", "Bảng công", "file", {
      activePrefixes: ["/admin/timesheets", "/admin/timesheet-periods"],
      permissionPrefixes: ["timesheet."],
    }),
    item("payroll", "/admin/payroll/periods", "Bảng lương", "wallet", {
      activePrefixes: ["/admin/payroll", "/admin/payout"],
      permissionPrefixes: ["payroll.", "payout."],
    }),
  ]),
  group("sales", "POS & Bán hàng", "payment", [
    item("pos-workspace", "/admin/pos", "Quầy bán hàng", "payment", {
      activePrefixes: ["/admin/pos"],
      permissionPrefixes: ["pos.", "payment."],
    }),
    item("pos-orders", "/admin/pos/orders", "Đơn hàng", "receipt", {
      activePrefixes: ["/admin/pos/orders"],
      permissionPrefixes: ["pos.", "payment.", "invoice."],
    }),
    item("pos-registers", "/admin/pos/registers", "Quầy thu ngân", "store", {
      activePrefixes: ["/admin/pos/registers"],
      permissionPrefixes: ["cash_session.", "pos."],
    }),
    item("cash-sessions", "/admin/pos/cash-sessions", "Ca thu ngân", "wallet", {
      activePrefixes: ["/admin/pos/cash-sessions"],
      permissionPrefixes: ["cash_session."],
    }),
  ]),
  group("inventory-assets", "Kho & Tài sản", "inventory", [
    item("inventory", "/admin/inventory", "Kho hàng", "inventory", {
      activePrefixes: ["/admin/inventory"],
      permissionPrefixes: ["inventory."],
    }),
    item("procurement", "/admin/procurement", "Mua hàng", "package", {
      activePrefixes: ["/admin/procurement"],
      permissionPrefixes: ["procurement.", "vendor."],
    }),
    item("assets", "/admin/assets", "Tài sản", "archive", {
      activePrefixes: ["/admin/assets"],
      permissionPrefixes: ["asset."],
    }),
  ]),
  group("finance", "Tài chính & Kế toán", "wallet", [
    item("financial", "/admin/financial", "Tài chính", "wallet", {
      activePrefixes: ["/admin/financial"],
      permissionPrefixes: ["financial.", "invoice.", "payment."],
    }),
    item("invoices", "/admin/financial/invoices", "Hóa đơn", "receipt", {
      activePrefixes: ["/admin/financial/invoices"],
      permissionPrefixes: ["invoice."],
    }),
    item("payments", "/admin/financial/payments", "Giao dịch thanh toán", "creditCard", {
      activePrefixes: ["/admin/financial/payments"],
      permissionPrefixes: ["payment."],
    }),
    item("reconciliation", "/admin/financial/reconciliation", "Đối soát", "check", {
      activePrefixes: ["/admin/financial/reconciliation", "/admin/accounting/reconciliation"],
      permissionPrefixes: ["financial.", "accounting.", "bank."],
    }),
    item("accounting", "/admin/accounting", "Kế toán", "file", {
      activePrefixes: ["/admin/accounting"],
      permissionPrefixes: ["accounting.", "journal."],
    }),
    item("refunds", "/admin/refunds", "Hoàn tiền", "transfer", {
      activePrefixes: ["/admin/refunds", "/admin/financial/refunds"],
      permissionPrefixes: ["refund."],
    }),
    item("credit-notes", "/admin/credit-notes", "Credit Note", "file", {
      activePrefixes: ["/admin/credit-notes"],
      permissionPrefixes: ["credit_note."],
    }),
    item("commissions", "/admin/financial/commission", "Hoa hồng", "people", {
      activePrefixes: ["/admin/financial/commission", "/admin/commission"],
      permissionPrefixes: ["commission."],
    }),
    item("payouts", "/admin/payouts", "Chi trả", "transfer", {
      activePrefixes: ["/admin/payouts", "/admin/payout-reconciliation", "/admin/payout"],
      permissionPrefixes: ["payout."],
    }),
    item("billing", "/admin/billing", "Gói & thanh toán", "creditCard", {
      activePrefixes: ["/admin/billing"],
      permissionPrefixes: ["billing.", "tenant_billing."],
    }),
  ]),
  group("marketing-care", "Marketing & CSKH", "trend", [
    item("marketing-campaigns", "/admin/marketing/campaigns", "Marketing khách hàng", "trend", {
      activePrefixes: ["/admin/marketing/campaigns"],
      permissionPrefixes: ["marketing.", "communication."],
    }),
    item("marketing-segments", "/admin/marketing/segments", "Nhóm khách hàng", "customer", {
      activePrefixes: ["/admin/marketing/segments"],
      permissionPrefixes: ["marketing.segment."],
    }),
    item("communications", "/admin/communications/messages", "Email & giao tiếp", "notification", {
      activePrefixes: ["/admin/communications"],
      permissionPrefixes: ["communication."],
    }),
    item("reviews", "/admin/reviews", "Đánh giá & phản hồi", "check", {
      activePrefixes: ["/admin/reviews", "/admin/review-requests"],
      permissionPrefixes: ["review."],
    }),
    item("service-recovery", "/admin/service-recovery", "Service Recovery", "activity", {
      activePrefixes: ["/admin/service-recovery"],
      permissionPrefixes: ["service_recovery."],
    }),
  ]),
  group("reports", "Báo cáo & Phân tích", "chart", [
    item("analytics", "/admin/analytics", "Tổng quan phân tích", "chart", {
      activePrefixes: ["/admin/analytics"],
      permissionPrefixes: ["analytics."],
    }),
    item("sales-analytics", "/admin/analytics/sales", "Doanh thu & dịch vụ", "trend", {
      activePrefixes: ["/admin/analytics/sales"],
      permissionPrefixes: ["analytics."],
    }),
    item("booking-analytics", "/admin/analytics/bookings", "Lịch hẹn & công suất", "calendar", {
      activePrefixes: ["/admin/analytics/bookings"],
      permissionPrefixes: ["analytics."],
    }),
    item("staff-analytics", "/admin/analytics/staff", "Hiệu suất nhân sự", "people", {
      activePrefixes: ["/admin/analytics/staff"],
      permissionPrefixes: ["analytics."],
    }),
    item("data-quality", "/admin/analytics/data-quality", "Chất lượng dữ liệu", "check", {
      activePrefixes: ["/admin/analytics/data-quality"],
      permissionPrefixes: ["analytics."],
    }),
  ]),
  group("settings", "Cài đặt", "settings", [
    item("organization", "/admin/organization/general", "Thông tin salon", "settings", {
      activePrefixes: ["/admin/organization"],
      permissionPrefixes: ["organization."],
    }),
    item("branches", "/admin/organization/branches", "Chi nhánh", "store", {
      activePrefixes: ["/admin/organization/branches"],
      permissionPrefixes: ["branch.", "organization."],
    }),
    item("users", "/admin/team/users", "Tài khoản & quyền", "user", {
      activePrefixes: ["/admin/team"],
      permissionPrefixes: ["user.", "role.", "security."],
    }),
    item("sessions", "/admin/security/sessions", "Phiên đăng nhập", "lock", {
      activePrefixes: ["/admin/security"],
      permissionPrefixes: ["security."],
    }),
  ]),
  group("platform", "Nền tảng", "shield", [
    item("platform-tenants", "/platform/tenants", "Tenant", "shield", {
      activePrefixes: ["/platform/tenants"],
      roles: ["PLATFORM_SUPER_ADMIN"],
    }),
    item("platform-catalog", "/platform/plans", "Gói & bảng giá", "package", {
      activePrefixes: ["/platform/plans", "/platform/prices", "/platform/discounts"],
      roles: ["PLATFORM_SUPER_ADMIN"],
    }),
    item("platform-payments", "/platform/invoices", "Thanh toán nền tảng", "wallet", {
      activePrefixes: ["/platform/invoices", "/platform/payments", "/platform/refunds", "/platform/reconciliation"],
      roles: ["PLATFORM_SUPER_ADMIN"],
    }),
    item("support-access", "/platform/support-access", "Quyền hỗ trợ", "lock", {
      activePrefixes: ["/platform/support-access", "/platform/break-glass"],
      roles: ["PLATFORM_SUPER_ADMIN"],
    }),
  ], { roles: ["PLATFORM_SUPER_ADMIN"] }),
];

function effectivePermissions(context: AuthContext) {
  return new Set([
    ...context.authorization.permissions,
    ...(context.supportAccess?.permissions ?? []),
  ]);
}

export function canSeeNavigation(item: Pick<NavigationItem, "permissionPrefixes" | "roles"> | Pick<NavigationGroup, "permissionPrefixes" | "roles">, context: AuthContext) {
  const roles = item.roles ?? [];
  if (roles.length) return roles.some((role) => context.authorization.roles.includes(role));
  const prefixes = item.permissionPrefixes ?? [];
  if (!prefixes.length) {
    return !context.authorization.roles.includes("PLATFORM_SUPER_ADMIN") || Boolean(context.supportAccess);
  }
  const permissions = effectivePermissions(context);
  return [...permissions].some((permission) => prefixes.some((prefix) => permission.startsWith(prefix)));
}

export function visibleNavigation(context: AuthContext) {
  return navigationRegistry
    .map((navigationGroup) => ({
      ...navigationGroup,
      items: navigationGroup.items.filter((navigationItem) => canSeeNavigation(navigationItem, context)),
    }))
    .filter((navigationGroup) =>
      navigationGroup.items.length > 0 && canSeeNavigation(navigationGroup, context),
    );
}

function normalizePath(pathname: string) {
  const normalized = pathname.replace(/\/$/, "");
  return normalized || "/";
}

export function isNavigationItemActive(item: NavigationItem, pathname: string) {
  return navigationItemMatchLength(item, pathname) > 0;
}

export function navigationItemMatchLength(item: NavigationItem, pathname: string) {
  const current = normalizePath(pathname);
  return [item.href, ...(item.activePrefixes ?? [])].reduce((longest, candidate) => {
    const route = normalizePath(candidate);
    const matches = current === route || current.startsWith(`${route}/`);
    return matches ? Math.max(longest, route.length) : longest;
  }, 0);
}

export function activeNavigationItemId(group: NavigationGroup, pathname: string) {
  return group.items.reduce<string | undefined>((activeId, item) => {
    const matchLength = navigationItemMatchLength(item, pathname);
    if (!matchLength) return activeId;
    const activeLength = activeId
      ? navigationItemMatchLength(group.items.find((candidate) => candidate.id === activeId)!, pathname)
      : 0;
    return matchLength > activeLength ? item.id : activeId;
  }, undefined);
}

export function activeNavigationGroupIds(groups: NavigationGroup[], pathname: string) {
  return groups
    .filter((navigationGroup) => activeNavigationItemId(navigationGroup, pathname))
    .map((navigationGroup) => navigationGroup.id);
}

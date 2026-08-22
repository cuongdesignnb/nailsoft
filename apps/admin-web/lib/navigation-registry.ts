import type { IconName } from "@nailsoft/icons";
import type { MessageKey } from "@nailsoft/localization";
import type { AuthContext, Role } from "@nailsoft/domain-types";

export type NavigationItem = {
  href: string;
  label: MessageKey;
  icon: IconName;
  permissionPrefixes?: string[];
  roles?: Role[];
};
export type NavigationGroup = { label: MessageKey; items: NavigationItem[] };

export const navigationRegistry: NavigationGroup[] = [
  { label: "workspaceGroup", items: [
    { href: "/admin/dashboard", label: "dashboard", icon: "home" },
    { href: "/admin/calendar", label: "calendar", icon: "calendar", permissionPrefixes: ["appointment.", "calendar.", "availability."] },
    { href: "/admin/operations/board", label: "operations", icon: "activity", permissionPrefixes: ["operations.", "walkin.", "service_session."] },
    { href: "/admin/pos", label: "pos", icon: "payment", permissionPrefixes: ["pos.", "payment.", "invoice.", "cash_session."] },
  ] },
  { label: "businessGroup", items: [
    { href: "/admin/customers", label: "customers", icon: "customer", permissionPrefixes: ["customer.", "loyalty.", "membership.", "voucher.", "package."] },
    { href: "/admin/staff/list", label: "team", icon: "staff", permissionPrefixes: ["staff.", "shift.", "leave.", "time_clock.", "timesheet.", "payroll."] },
    { href: "/admin/inventory", label: "inventory", icon: "inventory", permissionPrefixes: ["inventory."] },
    { href: "/admin/procurement", label: "procurement", icon: "package", permissionPrefixes: ["procurement.", "vendor."] },
    { href: "/admin/assets", label: "assets", icon: "archive", permissionPrefixes: ["asset."] },
  ] },
  { label: "controlGroup", items: [
    { href: "/admin/financial", label: "finance", icon: "wallet", permissionPrefixes: ["financial.", "refund.", "credit_note.", "commission."] },
    { href: "/admin/accounting", label: "accounting", icon: "file", permissionPrefixes: ["accounting.", "journal.", "bank."] },
    { href: "/admin/analytics", label: "analytics", icon: "chart", permissionPrefixes: ["analytics."] },
    { href: "/admin/marketing", label: "marketing", icon: "trend", permissionPrefixes: ["marketing.", "communication.", "review."] },
    { href: "/platform/tenants", label: "platform", icon: "shield", roles: ["PLATFORM_SUPER_ADMIN"] },
  ] },
];

export function canSeeNavigation(item: NavigationItem, context: AuthContext) {
  if (item.roles?.some((role) => context.authorization.roles.includes(role))) return true;
  if (!item.permissionPrefixes?.length) return !context.authorization.roles.includes("PLATFORM_SUPER_ADMIN") || Boolean(context.supportAccess);
  return context.authorization.permissions.some((permission) => item.permissionPrefixes?.some((prefix) => permission.startsWith(prefix)));
}

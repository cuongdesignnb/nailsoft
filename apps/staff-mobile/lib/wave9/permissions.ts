import type { AuthContext } from "@nailsoft/domain-types";

export type StaffScope = "OWN_STAFF" | "ASSIGNED_APPOINTMENT" | "ASSIGNED_SESSION" | "ASSIGNED_TASK" | "AUTHORIZED_BRANCH" | "USER";
export type StaffTab = "today" | "schedule" | "queue" | "more";
export type StaffRoute = {
  screen: string;
  logicalScreenId: `19.9.${number}`;
  tab: StaffTab;
  readPermissions: string[];
  writePermissions?: string[];
  scope: StaffScope;
  offlinePolicy: "DENIED" | "LOCAL_NOTE_DRAFT";
};

const add = (screen: string, logicalScreenId: `19.9.${number}`, tab: StaffTab, readPermissions: string[], scope: StaffScope, writePermissions?: string[], offlinePolicy: StaffRoute["offlinePolicy"] = "DENIED") => ({ screen, logicalScreenId, tab, readPermissions, scope, ...(writePermissions ? { writePermissions } : {}), offlinePolicy });

export const staffRouteRegistry: StaffRoute[] = [
  add("staffToday", "19.9.1", "today", ["service_session.read_own"], "ASSIGNED_SESSION", ["service_session.start", "service_session.pause", "service_session.resume", "service_session.complete", "service_session.note"]),
  add("myCalendar", "19.9.2", "schedule", ["calendar.read_own", "calendar.read_branch"], "OWN_STAFF"),
  add("myBusy", "19.9.2", "schedule", ["availability_block.read"], "OWN_STAFF"),
  add("myAvailability", "19.9.2", "schedule", ["availability.read"], "AUTHORIZED_BRANCH"),
  add("shifts", "19.9.2", "schedule", ["shift.read"], "OWN_STAFF"),
  add("upcomingAppointments", "19.9.3", "queue", ["appointment.read", "appointment.read_branch", "appointment.read_own"], "ASSIGNED_APPOINTMENT"),
  add("appointment", "19.9.3", "queue", ["appointment.read", "appointment.read_branch", "appointment.read_own"], "ASSIGNED_APPOINTMENT"),
  add("packageCoverage", "19.9.3", "queue", ["package.entitlement.read"], "ASSIGNED_APPOINTMENT"),
  add("staffTodayExecution", "19.9.4", "today", ["service_session.read_own"], "ASSIGNED_SESSION", ["service_session.start", "service_session.pause", "service_session.resume", "service_session.complete", "service_session.note"], "LOCAL_NOTE_DRAFT"),
  add("timeClock", "19.9.5", "today", ["time_clock.self.use"], "OWN_STAFF", ["time_clock.self.use"]),
  add("attendanceHistory", "19.9.5", "today", ["timesheet.self.read"], "OWN_STAFF"),
  add("leave", "19.9.6", "more", ["leave.read_own", "leave.read_branch"], "OWN_STAFF"),
  add("createLeave", "19.9.6", "more", ["leave.read_own", "leave.read_branch"], "OWN_STAFF", ["leave.create_own"]),
  add("leaveDetail", "19.9.6", "more", ["leave.read_own", "leave.read_branch"], "OWN_STAFF"),
  add("myTimesheets", "19.9.6", "more", ["timesheet.self.read"], "OWN_STAFF", ["timesheet.self.submit", "timesheet.adjustment.request"]),
  add("myPerformance", "19.9.7", "more", ["analytics.staff.personal.read"], "OWN_STAFF"),
  add("myEarnings", "19.9.7", "more", ["commission.entry.read_own"], "OWN_STAFF"),
  add("commissionHistory", "19.9.7", "more", ["commission.entry.read_own"], "OWN_STAFF"),
  add("netTips", "19.9.7", "more", ["commission.entry.read_own"], "OWN_STAFF"),
  add("payStatements", "19.9.7", "more", ["payroll.statement.read"], "OWN_STAFF"),
  add("myMaterials", "19.9.8", "today", ["inventory.service.reserve", "inventory.service.consume"], "ASSIGNED_SESSION"),
  add("materialUsage", "19.9.8", "today", ["inventory.service.consume"], "ASSIGNED_SESSION", ["inventory.service.consume"]),
  add("storedValueAccess", "19.9.8", "today", ["gift_card.read"], "ASSIGNED_APPOINTMENT"),
  add("assetMaintenance", "19.9.8", "today", ["asset.maintenance.read"], "ASSIGNED_TASK"),
  add("assetInspection", "19.9.8", "today", ["asset.inspection.read"], "ASSIGNED_TASK"),
  add("assetTransfer", "19.9.8", "today", ["asset.transfer.read"], "ASSIGNED_TASK"),
  add("recoveryTasks", "19.9.9", "queue", ["service_recovery.read"], "ASSIGNED_TASK"),
  add("recoveryContact", "19.9.9", "queue", ["service_recovery.read"], "ASSIGNED_TASK", ["service_recovery.contact"]),
  add("profile", "19.9.10", "more", ["staff.read"], "USER"),
  add("branches", "19.9.10", "more", ["staff.read"], "USER"),
  add("skills", "19.9.10", "more", ["staff.read"], "USER"),
  add("workspace", "19.9.10", "more", [], "USER"),
  add("mfa", "19.9.10", "more", [], "USER"),
  add("invitation", "19.9.10", "more", ["user.read"], "USER"),
];

export function routeDescriptor(screen: string) {
  return staffRouteRegistry.find((route) => route.screen === screen);
}

export function hasAnyPermission(context: AuthContext, permissions: string[]) {
  return permissions.length === 0 || permissions.some((permission) => context.authorization.permissions.includes(permission));
}

export function accessModeAllowsStaff(accessMode: string, write = false) {
  if (["BILLING_ONLY", "SUSPENDED", "TERMINATED"].includes(accessMode)) return false;
  return !write || accessMode !== "READ_ONLY";
}

export function canReadStaffRoute(context: AuthContext, screen: string) {
  const route = routeDescriptor(screen);
  if (!route || context.capabilities?.staffMobileEnabled !== true || !accessModeAllowsStaff(context.workspace.accessMode)) return false;
  if (route.scope !== "USER" && !context.authorization.ownStaffId) return false;
  return hasAnyPermission(context, route.readPermissions);
}

export function canWriteStaffRoute(context: AuthContext, screen: string, permission?: string) {
  const route = routeDescriptor(screen);
  if (!route?.writePermissions?.length || !accessModeAllowsStaff(context.workspace.accessMode, true)) return false;
  if (route.scope !== "USER" && !context.authorization.ownStaffId) return false;
  return hasAnyPermission(context, permission ? [permission] : route.writePermissions);
}

export function visibleStaffTabs(context: AuthContext) {
  if (context.capabilities?.staffMobileEnabled !== true) return [];
  return (["today", "schedule", "queue", "more"] as StaffTab[]).filter((tab) => staffRouteRegistry.some((route) => route.tab === tab && canReadStaffRoute(context, route.screen)));
}

export function staffTabForPath(pathname: string): StaffTab {
  const screen = pathname.replace(/^\//, "").split("?")[0] ?? "";
  return routeDescriptor(screen)?.tab ?? (pathname === "/" ? "today" : "more");
}

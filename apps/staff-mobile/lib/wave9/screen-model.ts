import type { AuthContext } from "@nailsoft/domain-types";
import { getActiveStaffBranchId, resolveStaffOperationalBranch } from "./branch-context";

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function range(days: number) {
  const start = new Date();
  const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  return { from: start.toISOString(), to: end.toISOString() };
}

export function pathForStaffScreen(screen: string, params: { id?: string; branchId?: string; serviceId?: string }, context?: AuthContext) {
  const branchId = context ? resolveStaffOperationalBranch(context, params.branchId, getActiveStaffBranchId()) : undefined;
  if (screen === "myPerformance") return "/v1/analytics/staff/me";
  if (screen === "assetMaintenance") return "/v1/assets/maintenance-work-orders";
  if (screen === "assetInspection") return "/v1/assets/inspections";
  if (screen === "assetTransfer") return "/v1/assets/transfers";
  if (screen === "timeClock") return "/v1/staff/me/time-clock/status";
  if (screen === "attendanceHistory") return "/v1/staff/me/attendance";
  if (screen === "myTimesheets") return "/v1/staff/me/timesheets";
  if (screen === "payStatements") return "/v1/staff/me/pay-statements";
  if (screen === "staffToday") return "/v1/staff/me/today";
  if (["myEarnings", "commissionHistory"].includes(screen)) return "/v1/staff/me/commissions";
  if (screen === "netTips") return "/v1/staff/me/tips";
  if (screen === "upcomingAppointments") {
    const dates = range(90);
    return `/v1/appointments?from=${encodeURIComponent(dates.from)}&to=${encodeURIComponent(dates.to)}`;
  }
  if (screen === "appointment") return params.id ? `/v1/appointments/${encodeURIComponent(params.id)}` : null;
  if (screen === "packageCoverage") return params.id ? `/v1/appointments/${encodeURIComponent(params.id)}/benefits` : null;
  if (["myMaterials", "materialUsage"].includes(screen)) return "/v1/staff/me/materials";
  if (screen === "storedValueAccess") return null;
  if (screen === "recoveryTasks") return "/v1/service-recovery/tasks/me";
  if (screen === "recoveryContact") return "/v1/service-recovery/tasks/me";
  if (["profile", "branches", "skills"].includes(screen)) return "/v1/staff/me";
  if (screen === "shifts") return "/v1/shifts";
  if (screen === "leave") return "/v1/leave-requests";
  if (screen === "leaveDetail") return params.id ? `/v1/leave-requests/${encodeURIComponent(params.id)}` : null;
  if (screen === "myCalendar") return branchId ? `/v1/calendar/events?branchId=${encodeURIComponent(branchId)}&from=${encodeURIComponent(range(7).from)}&to=${encodeURIComponent(range(7).to)}` : null;
  if (screen === "myBusy") return branchId ? `/v1/availability-blocks?branchId=${encodeURIComponent(branchId)}&from=${encodeURIComponent(range(30).from)}&to=${encodeURIComponent(range(30).to)}` : null;
  if (screen === "myAvailability") return branchId && params.serviceId ? `/v1/availability?branchId=${encodeURIComponent(branchId)}&serviceId=${encodeURIComponent(params.serviceId)}&dateFrom=${isoDay(new Date())}&dateTo=${isoDay(new Date())}` : null;
  return null;
}

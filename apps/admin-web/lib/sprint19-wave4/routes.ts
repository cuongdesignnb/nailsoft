export function isWave4Path(pathname: string) {
  const exact = [
    "/admin/staff/list", "/admin/staff/new", "/admin/scheduling/shifts", "/admin/scheduling/leave-requests",
    "/admin/time-clock", "/admin/time-clock/sessions", "/admin/time-clock/exceptions", "/admin/time-clock/devices",
    "/admin/timesheets", "/admin/timesheet-periods", "/admin/workforce/policies", "/admin/workforce/compliance", "/admin/workforce/reports",
    "/admin/payroll/calendars", "/admin/payroll/periods", "/admin/payroll/runs", "/admin/payroll/exceptions", "/admin/payroll/statements", "/admin/payroll/reports", "/admin/payouts", "/admin/payout-reconciliation",
  ];
  return exact.includes(pathname) || /^\/admin\/staff\/[^/]+(?:\/pay-profile)?$/.test(pathname) || /^\/admin\/scheduling\/shifts\/[^/]+$/.test(pathname) || /^\/admin\/scheduling\/leave-requests\/[^/]+$/.test(pathname) || /^\/admin\/(timesheets|payroll\/runs|payouts)\/[^/]+$/.test(pathname);
}

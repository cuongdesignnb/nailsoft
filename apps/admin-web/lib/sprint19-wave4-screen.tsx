"use client";
import { isWave4Path } from "./sprint19-wave4/routes";
import StaffWorkspace from "./sprint19-wave4/staff";
import SchedulingWorkspace from "./sprint19-wave4/scheduling";
import AttendanceWorkspace from "./sprint19-wave4/attendance";
import PayrollWorkspace from "./sprint19-wave4/payroll";
import { WorkforceWorkspace, PayProfileWorkspace } from "./sprint19-wave4/workforce";
export { isWave4Path };

export default function Sprint19Wave4Screen({ pathname }: { pathname: string }) {
  if (/^\/admin\/staff\/[^/]+\/pay-profile$/.test(pathname)) return <PayProfileWorkspace staffId={pathname.split("/")[3] ?? ""} />;
  if (pathname === "/admin/staff/list" || pathname === "/admin/staff/new") return <StaffWorkspace pathname={pathname} />;
  if (/^\/admin\/staff\/[^/]+$/.test(pathname)) return <StaffWorkspace pathname={pathname} />;
  if (pathname.startsWith("/admin/scheduling/")) return <SchedulingWorkspace pathname={pathname} />;
  if (pathname.startsWith("/admin/time-clock") || pathname === "/admin/timesheets" || pathname === "/admin/timesheet-periods") return <AttendanceWorkspace pathname={pathname} />;
  if (pathname.startsWith("/admin/workforce")) return <WorkforceWorkspace pathname={pathname} />;
  return <PayrollWorkspace pathname={pathname} />;
}

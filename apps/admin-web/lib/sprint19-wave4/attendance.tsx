"use client";
import { ActionButton, Page, StatePanel, Table, useMutation, useResource } from "./shared";

export default function AttendanceWorkspace({ pathname }: { pathname: string }) {
  const config: Record<string, { title: string; endpoint: string; description: string; actions?: string[] }> = {
    "/admin/time-clock": { title: "Live time clock", endpoint: "/v1/time-clock/sessions", description: "Server-time attendance view for the current branch." },
    "/admin/time-clock/sessions": { title: "Attendance sessions", endpoint: "/v1/time-clock/sessions", description: "Scheduled versus actual time and break evidence." },
    "/admin/time-clock/exceptions": { title: "Attendance exceptions", endpoint: "/v1/time-clock/exceptions", description: "Resolve missed punches and compliance exceptions with audit evidence.", actions: ["acknowledge", "resolve", "waive"] },
    "/admin/time-clock/devices": { title: "Trusted clock devices", endpoint: "/v1/time-clock/devices", description: "Branch-bound kiosk and device trust.", actions: ["revoke"] },
    "/admin/timesheets": { title: "Staff timesheets", endpoint: "/v1/timesheets", description: "Review, correct and lock source timesheets.", actions: ["submit", "approve", "reject", "reopen", "lock"] },
    "/admin/timesheet-periods": { title: "Timesheet periods", endpoint: "/v1/timesheet-periods", description: "Submission and review windows with immutable lock states." },
  };
  const cfg = config[pathname] ?? config["/admin/time-clock"]!;
  return <AttendanceTable {...cfg} />;
}
function AttendanceTable({ title, endpoint, description, actions = [] }: { title: string; endpoint: string; description: string; actions?: string[] }) {
  const resource = useResource(endpoint); const mutation = useMutation(resource.reload);
  const rows = resource.rows;
  const columns = rows.length ? Object.keys(rows[0] ?? {}).filter((key) => !key.toLowerCase().includes("json")).slice(0, 7).map((key) => [key, key.replace(/[A-Z]/g, (letter) => ` ${letter}`).replace(/^./, (letter) => letter.toUpperCase())] as [string, string]) : [["id", "ID"], ["status", "Status"]] as [string, string][];
  return <Page eyebrow="Attendance" title={title} description={description}><section className="s19-card"><div className="s19-w4-toolbar"><span className="s19-w4-live-indicator">● Live server data</span><button className="s19-button s19-button-secondary" onClick={resource.reload}>Refresh</button></div><StatePanel state={resource.state} error={resource.error} retry={resource.reload} empty="No attendance records match the current scope." />{resource.state === "ready" && <Table rows={rows} columns={columns} />}{actions.length > 0 && resource.state === "ready" && <div className="s19-inline-actions"><span className="s19-helper">Select a record to run a state-safe action:</span>{rows.slice(0, 5).map((row) => actions.slice(0, 3).map((action) => <ActionButton key={`${row.id}-${action}`} label={`${action} ${String(row.id ?? "").slice(0, 6)}`} onClick={() => mutation.run(`${endpoint}/${row.id}/${action}`, { version: row.version })} danger={action === "waive" || action === "reject"} />))}</div>}{mutation.notice && <p className="s19-notice s19-notice-success">{mutation.notice}</p>}{mutation.error && <p className="s19-notice s19-notice-danger">{mutation.error}</p>}</section></Page>;
}

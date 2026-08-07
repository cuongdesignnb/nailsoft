"use client";
import { ActionButton, Page, StatePanel, Table, useMutation, useResource } from "./shared";

export default function PayrollWorkspace({ pathname }: { pathname: string }) {
  const detail = pathname.match(/^\/admin\/(payroll\/runs|payouts)\/([^/]+)$/);
  const configs: Record<string, [string, string, string]> = {
    "/admin/payroll/calendars": ["Payroll calendars", "/v1/payroll-calendars", "Timezone-aware configurable payroll frequency."],
    "/admin/payroll/periods": ["Payroll periods", "/v1/payroll/periods", "Periods generated from locked timesheet windows."],
    "/admin/payroll/runs": ["Payroll runs", "/v1/payroll/runs", "Deterministic sources, independent approval and immutable finalization."],
    "/admin/payroll/exceptions": ["Payroll exceptions", "/v1/payroll/exceptions", "Blocking source, policy, currency and payout readiness issues."],
    "/admin/payroll/statements": ["Pay statements", "/v1/pay-statements", "Private immutable finalized statements."],
    "/admin/payroll/reports": ["Payroll reports", "/v1/payroll/reports/summary", "Earnings, commission, tips and source reconciliation."],
    "/admin/payouts": ["Payout batches", "/v1/payout-batches", "Evidence-led payout processing with dual control."],
    "/admin/payout-reconciliation": ["Payout reconciliation", "/v1/payout-reconciliations", "Expected, confirmed, reversed and variance evidence."],
  };
  const key = detail ? `/${detail[1]}`.replace("/payroll/runs", "/admin/payroll/runs").replace("/payouts", "/admin/payouts") : pathname; const cfg = configs[key] ?? configs["/admin/payroll/runs"]!;
  return <PayrollTable title={cfg[0]} endpoint={detail ? `${cfg[1]}/${detail[2]}` : cfg[1]} description={cfg[2]} kind={key.includes("payout") ? "payout" : key.includes("run") ? "run" : "standard"} />;
}
function PayrollTable({ title, endpoint, description, kind }: { title: string; endpoint: string; description: string; kind: "payout" | "run" | "standard" }) {
  const resource = useResource(endpoint); const mutation = useMutation(resource.reload); const rows = resource.rows;
  const columns = rows.length ? Object.keys(rows[0] ?? {}).filter((key) => !key.toLowerCase().includes("json")).slice(0, 8).map((key) => [key, key.replace(/[A-Z]/g, (letter) => ` ${letter}`).replace(/^./, (letter) => letter.toUpperCase())] as [string, string]) : [["id", "ID"], ["status", "Status"]] as [string, string][];
  const actions = kind === "run" ? ["calculate", "submit", "approve", "finalize"] : kind === "payout" ? ["submit", "approve", "process", "cancel"] : [];
  return <Page eyebrow={kind === "payout" ? "Payout" : "Payroll"} title={title} description={description}><section className="s19-card"><div className="s19-w4-toolbar"><span className="s19-w4-live-indicator">● Server authoritative</span><button className="s19-button s19-button-secondary" onClick={resource.reload}>Refresh</button></div><StatePanel state={resource.state} error={resource.error} retry={resource.reload} empty="No records are available in this scope." />{resource.state === "ready" && <Table rows={rows} columns={columns} />}{actions.length > 0 && resource.state === "ready" && <div className="s19-inline-actions">{rows.slice(0, 5).flatMap((row) => actions.map((action) => <ActionButton key={`${row.id}-${action}`} label={`${action} ${String(row.id ?? "").slice(0, 6)}`} onClick={() => mutation.run(`${endpoint}/${row.id}/${action}`, { version: row.version })} danger={action === "cancel"} />))}</div>}{mutation.notice && <p className="s19-notice s19-notice-success">{mutation.notice}</p>}{mutation.error && <p className="s19-notice s19-notice-danger">{mutation.error}</p>}</section></Page>;
}

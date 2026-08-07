/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useState } from "react";
import { ActionButton, Field, Page, StatePanel, Table, useMutation, useResource } from "./shared";
import { getActiveBranchId } from "../auth";

export default function SchedulingWorkspace({ pathname }: { pathname: string }) {
  if (pathname.startsWith("/admin/scheduling/leave-requests")) return <LeaveReview />;
  return <ShiftPlanner />;
}
function ShiftPlanner() {
  const branch = getActiveBranchId(); const resource = useResource(`/v1/shifts${branch ? `?branchId=${encodeURIComponent(branch)}` : ""}`); const [showForm, setShowForm] = useState(false);
  return <Page eyebrow="Scheduling" title="Shift planner" description="Plan branch shifts, publish only after validation, and keep overlap errors visible." actions={<button className="s19-button s19-button-primary" onClick={() => setShowForm((value) => !value)}>{showForm ? "Close form" : "Create shift"}</button>}><div className="s19-card">{showForm && <ShiftForm onCreated={() => { setShowForm(false); void resource.reload(); }} />}<StatePanel state={resource.state} error={resource.error} retry={resource.reload} empty="No shifts are scheduled for the current branch." />{resource.state === "ready" && <Table rows={resource.rows} columns={[["startAt", "Starts"], ["endAt", "Ends"], ["staffId", "Staff"], ["branchId", "Branch"], ["status", "Status"], ["version", "Version"]]} />}</div></Page>;
}
function ShiftForm({ onCreated }: { onCreated: () => void }) {
  const [values, setValues] = useState({ branchId: "", staffId: "", startAt: "", endAt: "", breakMinutes: "0" }); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const set = (key: string) => (value: string) => setValues((v) => ({ ...v, [key]: value }));
  async function submit(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { await (await import("./shared")).command("/v1/shifts", { branchId: values.branchId, staffId: values.staffId, startAt: new Date(values.startAt).toISOString(), endAt: new Date(values.endAt).toISOString(), breakMinutes: Number(values.breakMinutes), source: "MANUAL", recurrenceRuleId: null }); onCreated(); } catch (cause: any) { setError(cause?.message ?? "Unable to create shift"); } finally { setBusy(false); } }
  return <form className="s19-form-grid s19-w4-subform" onSubmit={submit}>{[["branchId", "Branch ID", "text", true], ["staffId", "Staff ID", "text", true], ["startAt", "Start", "datetime-local", true], ["endAt", "End", "datetime-local", true], ["breakMinutes", "Break minutes", "number", false]].map(([key, label, type, required]) => <Field key={key as string} name={key as string} label={label as string} type={type as string} required={required as boolean} value={values[key as keyof typeof values]} onChange={set(key as string)} />)}<button className="s19-button s19-button-primary" disabled={busy}>{busy ? "Saving…" : "Save shift"}</button>{error && <p className="s19-notice s19-notice-danger s19-field-wide">{error}</p>}</form>;
}
function LeaveReview() {
  const branch = getActiveBranchId(); const resource = useResource(`/v1/leave-requests${branch ? `?branchId=${encodeURIComponent(branch)}` : ""}`); const mutation = useMutation(resource.reload);
  return <Page eyebrow="Scheduling" title="Leave review" description="Review branch requests with state transitions, reasons and version-safe actions."><section className="s19-card"><StatePanel state={resource.state} error={resource.error} retry={resource.reload} empty="No leave requests are waiting for review." />{resource.state === "ready" && <Table rows={resource.rows} columns={[["staffId", "Staff"], ["leaveType", "Type"], ["startAt", "From"], ["endAt", "To"], ["status", "Status"], ["version", "Version"]]} />}{resource.state === "ready" && <div className="s19-inline-actions">{resource.rows.slice(0, 3).map((row) => <span key={row.id} className="s19-w4-action-set"><ActionButton label={`Approve ${row.id?.slice(0, 6)}`} onClick={() => mutation.run(`/v1/leave-requests/${row.id}/approve`, { version: row.version, reviewNote: "Reviewed in workforce workspace" })} /><ActionButton label="Reject" danger onClick={() => mutation.run(`/v1/leave-requests/${row.id}/reject`, { version: row.version, reviewNote: "Needs follow-up" })} /></span>)}</div>}{mutation.notice && <p className="s19-notice s19-notice-success">{mutation.notice}</p>}{mutation.error && <p className="s19-notice s19-notice-danger">{mutation.error}</p>}</section></Page>;
}

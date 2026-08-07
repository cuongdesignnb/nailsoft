/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import * as React from "react";
import { ActionButton, Field, Page, StatePanel, Table, useMutation, useResource } from "./shared";

export function WorkforceWorkspace({ pathname }: { pathname: string }) {
  const configs: Record<string, [string, string, string]> = {
    "/admin/workforce/policies": ["Workforce policies", "/v1/workforce-compliance/policies", "Versioned configurable rules with legal-review gates."],
    "/admin/workforce/compliance": ["Workforce compliance", "/v1/time-clock/exceptions", "Exceptions and evidence without hardcoded jurisdiction rules."],
    "/admin/workforce/reports": ["Workforce reports", "/v1/workforce/reports/attendance", "Attendance, overtime, break and exception evidence."],
  };
  const cfg = configs[pathname] ?? configs["/admin/workforce/policies"]!; const resource = useResource(cfg[1]); const mutation = useMutation(resource.reload);
  const columns = resource.rows.length ? Object.keys(resource.rows[0] ?? {}).filter((key) => !key.toLowerCase().includes("json")).slice(0, 8).map((key) => [key, key.replace(/[A-Z]/g, (letter) => ` ${letter}`).replace(/^./, (letter) => letter.toUpperCase())] as [string, string]) : [["id", "ID"], ["status", "Status"]] as [string, string][];
  return <Page eyebrow="Workforce" title={cfg[0]} description={cfg[2]}><section className="s19-card"><StatePanel state={resource.state} error={resource.error} retry={resource.reload} empty="No workforce records match the current scope." />{resource.state === "ready" && <Table rows={resource.rows} columns={columns} />}{pathname === "/admin/workforce/compliance" && resource.state === "ready" && <div className="s19-inline-actions">{resource.rows.slice(0, 5).map((row) => <ActionButton key={row.id} label="Resolve" onClick={() => mutation.run(`/v1/time-clock/exceptions/${row.id}/resolve`, { version: row.version })} />)}</div>}{mutation.notice && <p className="s19-notice s19-notice-success">{mutation.notice}</p>}{mutation.error && <p className="s19-notice s19-notice-danger">{mutation.error}</p>}</section></Page>;
}

export function PayProfileWorkspace({ staffId }: { staffId: string }) {
  const resource = useResource(`/v1/staff/${staffId}/pay-profile`); const mutation = useMutation(resource.reload); const row = resource.rows[0] ?? {};
  return <Page eyebrow="Pay setup" title="Staff pay profile" description="Effective-dated pay configuration. Amounts and eligibility remain server authoritative."><section className="s19-card"><StatePanel state={resource.state} error={resource.error} retry={resource.reload} empty="Pay profile has not been initialized." />{resource.state === "ready" && <><dl className="s19-w4-dl">{[["Profile type", row.profileType], ["Currency", row.currency], ["Effective from", row.effectiveFrom], ["Effective to", row.effectiveTo], ["Version", row.version]].map(([label, value]) => <div key={label as string}><dt>{label}</dt><dd>{String(value ?? "—")}</dd></div>)}</dl><PayProfileForm staffId={staffId} row={row} onSaved={resource.reload} /></>}{mutation.error && <p className="s19-notice s19-notice-danger">{mutation.error}</p>}</section></Page>;
}
function PayProfileForm({ staffId, row, onSaved }: { staffId: string; row: Record<string, any>; onSaved: () => Promise<void> }) {
  const [profileType, setProfileType] = React.useState(row.profileType ?? "HOURLY"); const [currency, setCurrency] = React.useState(row.currency ?? "VND"); const [effectiveFrom, setEffectiveFrom] = React.useState(row.effectiveFrom ?? ""); const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState("");
  async function save(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { await (await import("./shared")).command(`/v1/staff/${staffId}/pay-profile/update`, { profileType, currency, effectiveFrom: effectiveFrom || null, effectiveTo: null }); await onSaved(); } catch (cause: any) { setError(cause?.message ?? "Unable to save pay profile"); } finally { setBusy(false); } }
  return <form className="s19-form-grid s19-w4-subform" onSubmit={save}><label className="s19-field"><span>Profile type</span><select value={profileType} onChange={(e) => setProfileType(e.target.value)}><option>HOURLY</option><option>SALARY</option><option>COMMISSION_ONLY</option><option>HOURLY_PLUS_COMMISSION</option><option>SALARY_PLUS_COMMISSION</option></select></label><Field label="Currency" name="currency" value={currency} onChange={setCurrency} required /><Field label="Effective from" name="effectiveFrom" type="date" value={effectiveFrom} onChange={setEffectiveFrom} required /><button className="s19-button s19-button-primary" disabled={busy}>{busy ? "Saving…" : "Save pay profile"}</button>{error && <p className="s19-notice s19-notice-danger s19-field-wide">{error}</p>}</form>;
}

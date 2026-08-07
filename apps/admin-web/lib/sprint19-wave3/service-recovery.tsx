"use client";

import { FormEvent, useState } from "react";
import { EngagementShell, EngagementStates, Notice, SafeTable, VersionActions, formatDate, localized, rows, statusLabel, useBenefitMutation, useBenefitResource } from "./engagement-shared";
import { useCustomerLookup } from "./benefit-shared";

const sources = ["LOW_REVIEW", "CUSTOMER_COMPLAINT", "STAFF_REPORT", "REFUND_ESCALATION", "SERVICE_FAILURE", "MANUAL"];
const severities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const compensationTypes = ["CUSTOMER_CREDIT", "LOYALTY_POINTS", "VOUCHER", "COMPLIMENTARY_SERVICE_FOUNDATION", "NO_MONETARY_COMPENSATION"];

function RecoveryCreate() {
  const branches = useBenefitResource("/v1/branches");
  const customerLookup = useCustomerLookup();
  const mutation = useBenefitMutation();
  const [branchId, setBranchId] = useState(""); const [customerId, setCustomerId] = useState(""); const [source, setSource] = useState(sources[0]); const [severity, setSeverity] = useState(severities[0]); const [category, setCategory] = useState(""); const [summary, setSummary] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const result = await mutation.submit("/v1/service-recovery/cases", { branchId, customerId, source, severity, category: category.trim(), summary: summary.trim() }); if (result) { setSummary(""); setCategory(""); } }
  return <form className="s19-card s19-form-grid" onSubmit={submit}><h2>Open recovery case</h2><label className="s19-field"><span>Branch</span><select value={branchId} required onChange={(event) => setBranchId(event.target.value)}><option value="">Choose branch</option>{rows(branches.data).map((branch) => <option key={branch.id} value={branch.id}>{localized(branch.name, branch.id)}</option>)}</select></label><div className="s19-field"><span>Customer</span><div className="s19-inline-actions"><input aria-label="Customer search" value={customerLookup.query} onChange={(event) => customerLookup.setQuery(event.target.value)} placeholder="Search customer" /><button className="s19-button s19-button-secondary" type="button" onClick={() => customerLookup.search()}>Search</button></div>{customerLookup.results.length > 0 && <select aria-label="Customer result" value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">Choose customer</option>{customerLookup.results.map((customer) => <option key={customer.id} value={customer.id}>{customer.displayName ?? customer.id}</option>)}</select>}</div><label className="s19-field"><span>Source</span><select value={source} onChange={(event) => setSource(event.target.value)}>{sources.map((item) => <option key={item}>{item}</option>)}</select></label><label className="s19-field"><span>Severity</span><select value={severity} onChange={(event) => setSeverity(event.target.value)}>{severities.map((item) => <option key={item}>{item}</option>)}</select></label><label className="s19-field"><span>Category</span><input required value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Service quality" /></label><label className="s19-field"><span>Summary</span><textarea required rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Describe the customer-impacting issue" /></label><p className="s19-helper">Compensation is a separate dual-control request. Opening a case does not change any balance.</p><button className="s19-button s19-button-primary" type="submit">Create case</button><Notice mutation={mutation} /></form>;
}

export function RecoveryCases() {
  const resource = useBenefitResource("/v1/service-recovery/cases");
  return <EngagementShell title="Service recovery"><div className="s19-benefit-layout"><RecoveryCreate /><section className="s19-card"><div className="s19-section-heading"><div><p className="s19-eyebrow">CUSTOMER SAFETY</p><h2>Cases</h2></div></div><EngagementStates resource={resource} label="recovery cases" /><SafeTable data={rows(resource.data)} columns={[{ key: "id", label: "Case", render: (row) => <a href={`/admin/service-recovery/${row.id}`}>{String(row.caseReference ?? row.id).slice(0, 16)}</a> }, { key: "customerId", label: "Customer", render: (row) => row.customerDisplayName ?? String(row.customerId ?? "-").slice(0, 12) }, { key: "source", label: "Source", render: (row) => statusLabel(row.source) }, { key: "severity", label: "Severity", render: (row) => <span className="s19-status s19-status-warning">{statusLabel(row.severity)}</span> }, { key: "status", label: "Status", render: (row) => statusLabel(row.status) }, { key: "updatedAt", label: "Updated", render: (row) => formatDate(row.updatedAt ?? row.updated_at) }]} /></section></div></EngagementShell>;
}

function recoveryActions(status: string) {
  if (status === "OPEN") return ["triage", "cancel"];
  if (status === "TRIAGED") return ["start", "cancel"];
  if (status === "IN_PROGRESS") return ["wait-customer", "resolve", "cancel"];
  if (status === "WAITING_CUSTOMER") return ["start", "resolve"];
  if (status === "RESOLVED") return ["close"];
  return [];
}

function compensationHref(type: string) {
  if (type === "CUSTOMER_CREDIT") return "/admin/stored-value/adjustments";
  if (type === "LOYALTY_POINTS") return "/admin/loyalty/adjustments";
  if (type === "VOUCHER") return "/admin/vouchers/codes";
  return undefined;
}

export function RecoveryDetail({ caseId }: { caseId: string }) {
  const resource = useBenefitResource(`/v1/service-recovery/cases/${encodeURIComponent(caseId)}`);
  const mutation = useBenefitMutation();
  const [compensationType, setCompensationType] = useState(compensationTypes[0]); const [compensationNote, setCompensationNote] = useState("");
  const recovery = resource.data?.case ?? resource.data ?? {};
  const status = String(recovery.status ?? "UNKNOWN");
  async function transition(action: string) { const result = await mutation.submit(`/v1/service-recovery/cases/${encodeURIComponent(caseId)}/${action}`, { version: recovery.version, reason: "Reviewed in Admin Web", ...(action === "resolve" ? { resolution: "Resolution recorded after operational review." } : {}) }); if (result) await resource.load(); }
  async function requestCompensation(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const result = await mutation.submit(`/v1/service-recovery/cases/${encodeURIComponent(caseId)}/compensations`, { compensationType, proposal: { note: compensationNote.trim() }, reason: "Customer recovery proposal" }); if (result) { setCompensationNote(""); await resource.load(); } }
  const compensations = rows(recovery.compensations ?? resource.data?.compensations);
  const tasks = rows(recovery.tasks ?? resource.data?.tasks);
  return <EngagementShell title={recovery.caseReference ?? "Recovery case"}><EngagementStates resource={resource} label="recovery case" />{resource.state === "ready" && <><section className="s19-card"><div className="s19-section-heading"><div><p className="s19-eyebrow">CASE TIMELINE</p><h2>{statusLabel(status)}</h2></div><span className="s19-status s19-status-info">{statusLabel(recovery.severity)}</span></div><dl className="s19-definition-grid"><div><dt>Customer</dt><dd>{recovery.customerDisplayName ?? String(recovery.customerId ?? "-").slice(0, 14)}</dd></div><div><dt>Branch</dt><dd>{recovery.branchName ?? recovery.branchId ?? "-"}</dd></div><div><dt>Source</dt><dd>{statusLabel(recovery.source)}</dd></div><div><dt>Category</dt><dd>{recovery.category ?? "-"}</dd></div></dl><p className="s19-quote">{recovery.summary ?? "No summary provided."}</p><VersionActions mutation={mutation} version={recovery.version} actions={recoveryActions(status)} onAction={(action) => void transition(action)} /></section><section className="s19-card"><h2>Compensation proposal</h2><form className="s19-form-grid" onSubmit={requestCompensation}><label className="s19-field"><span>Type</span><select value={compensationType} onChange={(event) => setCompensationType(event.target.value)}>{compensationTypes.map((type) => <option key={type}>{type}</option>)}</select></label><label className="s19-field"><span>Proposal note</span><textarea required rows={3} value={compensationNote} onChange={(event) => setCompensationNote(event.target.value)} placeholder="Explain the requested recovery" /></label><p className="s19-helper">Approval is independent from the requester. Balance changes occur only through the owning domain.</p><button className="s19-button s19-button-primary" type="submit">Submit for approval</button></form><SafeTable data={compensations} columns={[{ key: "compensationType", label: "Type", render: (row) => compensationHref(row.compensationType) ? <a href={compensationHref(row.compensationType)}>{statusLabel(row.compensationType)}</a> : statusLabel(row.compensationType) }, { key: "status", label: "Status", render: (row) => statusLabel(row.status) }, { key: "requestedByUserId", label: "Requester", render: (row) => String(row.requestedByUserId ?? "-").slice(0, 12) }, { key: "approvedByUserId", label: "Approver", render: (row) => String(row.approvedByUserId ?? "-").slice(0, 12) }, { key: "actions", label: "Actions", render: (row) => String(row.status).toUpperCase() === "PENDING_APPROVAL" ? <VersionActions mutation={mutation} version={row.version} actions={["approve", "reject"]} onAction={(action) => void mutation.submit(`/v1/service-recovery/compensations/${row.id}/${action}`, { version: row.version, reason: "Reviewed in Admin Web" }).then(() => resource.load())} /> : "-" }]} /></section><section className="s19-card"><h2>Assigned tasks</h2><SafeTable data={tasks} columns={[{ key: "title", label: "Task", render: (row) => row.title ?? row.taskType ?? "Task" }, { key: "status", label: "Status", render: (row) => statusLabel(row.status) }, { key: "assignedToUserId", label: "Assigned", render: (row) => String(row.assignedToUserId ?? "-").slice(0, 12) }, { key: "updatedAt", label: "Updated", render: (row) => formatDate(row.updatedAt ?? row.createdAt) }]} /></section></>}<Notice mutation={mutation} /></EngagementShell>;
}

export function RecoveryRoute({ pathname }: { pathname: string }) { const detail = pathname.match(/^\/admin\/service-recovery\/([^/]+)$/); return detail ? <RecoveryDetail caseId={detail[1] ?? ""} /> : <RecoveryCases />; }

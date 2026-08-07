"use client";

import { FormEvent, useState } from "react";
import {
  EngagementShell,
  EngagementStates,
  Notice,
  SafeTable,
  VersionActions,
  formatDate,
  localized,
  rows,
  statusLabel,
  useBenefitMutation,
  useBenefitResource,
} from "./engagement-shared";

function Field({ label, name, value, onChange, type = "text", required = false, placeholder }: { label: string; name: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; placeholder?: string }) {
  return <label className="s19-field"><span>{label}</span><input name={name} type={type} value={value} required={required} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

function FormCard({ title, children, onSubmit, submitLabel = "Create" }: { title: string; children: React.ReactNode; onSubmit: (event: FormEvent<HTMLFormElement>) => void; submitLabel?: string }) {
  return <form className="s19-card s19-form-grid" onSubmit={onSubmit}><h2>{title}</h2>{children}<div className="s19-inline-actions"><button className="s19-button s19-button-primary" type="submit">{submitLabel}</button></div></form>;
}

export function CommunicationTemplates() {
  const resource = useBenefitResource("/v1/communications/templates");
  const mutation = useBenefitMutation();
  const [code, setCode] = useState("");
  const [category, setCategory] = useState("TRANSACTIONAL");
  const data = rows(resource.data);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await mutation.submit("/v1/communications/templates", { code: code.trim(), category });
    if (result) { setCode(""); await resource.load(); }
  }
  return <EngagementShell title="Communication templates">
    <div className="s19-benefit-layout"><FormCard title="New template" onSubmit={submit}><Field label="Template code" name="code" value={code} onChange={setCode} required placeholder="appointment-reminder" /><label className="s19-field"><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option>TRANSACTIONAL</option><option>ENGAGEMENT</option><option>MARKETING</option><option>INTERNAL</option></select></label></FormCard>
      <section className="s19-card"><div className="s19-section-heading"><div><p className="s19-eyebrow">VERSIONED CONTENT</p><h2>Templates</h2></div><span className="s19-status s19-status-info">{data.length} records</span></div><EngagementStates resource={resource} label="communication templates" /><SafeTable data={data} columns={[{ key: "code", label: "Code" }, { key: "category", label: "Category", render: (row) => statusLabel(row.category) }, { key: "status", label: "Status", render: (row) => <span className="s19-status s19-status-info">{statusLabel(row.status ?? row.lifecycleStatus ?? "DRAFT")}</span> }, { key: "activeVersion", label: "Version", render: (row) => row.activeVersion ?? row.active_version ?? row.version ?? "-" }, { key: "updatedAt", label: "Updated", render: (row) => formatDate(row.updatedAt ?? row.updated_at) }]} /></section></div><Notice mutation={mutation} />
  </EngagementShell>;
}

export function CommunicationRules() {
  const resource = useBenefitResource("/v1/communications/rules");
  const mutation = useBenefitMutation();
  const [domainEvent, setDomainEvent] = useState("appointment.checked_in");
  const [purpose, setPurpose] = useState("TRANSACTIONAL");
  const [templateVersionId, setTemplateVersionId] = useState("");
  const [branchId, setBranchId] = useState("");
  const branches = useBenefitResource("/v1/branches");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await mutation.submit("/v1/communications/rules", { domainEvent, purpose, templateVersionId: templateVersionId.trim(), branchId: branchId || null, delaySeconds: 0, recipientResolver: "APPOINTMENT_CUSTOMER", eligibilityPolicy: {} });
    if (result) { setTemplateVersionId(""); await resource.load(); }
  }
  const branchRows = rows(branches.data);
  return <EngagementShell title="Communication rules"><div className="s19-benefit-layout"><FormCard title="New delivery rule" onSubmit={submit}><label className="s19-field"><span>Domain event</span><select value={domainEvent} onChange={(event) => setDomainEvent(event.target.value)}><option>appointment.checked_in</option><option>appointment.completed</option><option>review.requested</option><option>service_recovery.created</option><option>marketing.campaign_scheduled</option></select></label><label className="s19-field"><span>Purpose</span><select value={purpose} onChange={(event) => setPurpose(event.target.value)}><option>TRANSACTIONAL</option><option>MARKETING</option><option>REVIEW_REQUEST</option><option>SERVICE_RECOVERY</option></select></label><Field label="Active template version ID" name="templateVersionId" value={templateVersionId} onChange={setTemplateVersionId} required placeholder="Use an active version UUID" /><label className="s19-field"><span>Branch scope</span><select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">Tenant-wide (Owner only)</option>{branchRows.map((branch) => <option key={branch.id} value={branch.id}>{localized(branch.name, branch.id)}</option>)}</select></label></FormCard><section className="s19-card"><div className="s19-section-heading"><div><p className="s19-eyebrow">SERVER-AUTHORITATIVE</p><h2>Rules</h2></div></div><EngagementStates resource={resource} label="communication rules" /><SafeTable data={rows(resource.data)} columns={[{ key: "domainEvent", label: "Event", render: (row) => row.domainEvent ?? row.domain_event ?? "-" }, { key: "purpose", label: "Purpose" }, { key: "branchId", label: "Branch", render: (row) => row.branchName ?? row.branchId ?? "Tenant-wide" }, { key: "status", label: "Status", render: (row) => statusLabel(row.status) }, { key: "actions", label: "Actions", render: (row) => <VersionActions mutation={mutation} version={row.version} actions={row.status === "ACTIVE" ? ["pause", "deactivate"] : row.status === "PAUSED" ? ["activate", "deactivate"] : ["activate"]} onAction={(action) => void mutation.submit(`/v1/communications/rules/${row.id}/${action}`, { version: row.version }) .then(() => resource.load())} /> }]} /></section></div><Notice mutation={mutation} /></EngagementShell>;
}

function MessageTable({ resource, title }: { resource: ReturnType<typeof useBenefitResource>; title: string }) {
  return <section className="s19-card"><div className="s19-section-heading"><div><p className="s19-eyebrow">DELIVERY EVIDENCE</p><h2>{title}</h2></div></div><EngagementStates resource={resource} label="messages" /><SafeTable data={rows(resource.data)} columns={[{ key: "id", label: "Message", render: (row) => String(row.id ?? row.messageId ?? "-").slice(0, 12) }, { key: "purpose", label: "Purpose" }, { key: "channel", label: "Channel", render: (row) => row.channel ?? "EMAIL" }, { key: "status", label: "Status", render: (row) => <span className="s19-status s19-status-info">{statusLabel(row.status)}</span> }, { key: "suppression", label: "Suppression", render: (row) => row.suppressionReason ?? row.safeErrorCode ?? "-" }, { key: "createdAt", label: "Created", render: (row) => formatDate(row.createdAt ?? row.created_at) }]} /></section>;
}

export function CommunicationMessages({ suppressions = false }: { suppressions?: boolean }) {
  const resource = useBenefitResource("/v1/communications/messages");
  const messageRows = suppressions ? rows(resource.data).filter((row) => String(row.status).toUpperCase() === "SUPPRESSED") : rows(resource.data);
  return <EngagementShell title={suppressions ? "Contact suppressions" : "Message delivery"} eyebrow="CUSTOMER ENGAGEMENT · CONTACT SAFETY"><MessageTable resource={{ ...resource, data: messageRows, state: messageRows.length ? "ready" : resource.state }} title={suppressions ? "Suppressed delivery evidence" : "Recent messages"} /></EngagementShell>;
}

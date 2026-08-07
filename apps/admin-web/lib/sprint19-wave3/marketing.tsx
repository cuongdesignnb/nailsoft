"use client";

import { FormEvent, useState } from "react";
import { EngagementShell, EngagementStates, Notice, SafeTable, VersionActions, formatDate, localized, rows, statusLabel, useBenefitMutation, useBenefitResource } from "./engagement-shared";

function Field({ label, value, onChange, type = "text", required = false, placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; placeholder?: string }) {
  return <label className="s19-field"><span>{label}</span><input type={type} value={value} required={required} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

function BranchSelect({ value, onChange, branches, allowTenantWide = true }: { value: string; onChange: (value: string) => void; branches: Array<{ id: string; name?: unknown }>; allowTenantWide?: boolean }) {
  return <label className="s19-field"><span>Branch scope</span><select value={value} onChange={(event) => onChange(event.target.value)}>{allowTenantWide && <option value="">Tenant-wide (server validates)</option>}{branches.map((branch) => <option key={branch.id} value={branch.id}>{localized(branch.name, branch.id)}</option>)}</select></label>;
}

export function MarketingSegments() {
  const resource = useBenefitResource("/v1/customer-segments");
  const branches = useBenefitResource("/v1/branches");
  const mutation = useBenefitMutation();
  const [name, setName] = useState("");
  const [branchId, setBranchId] = useState("");
  const [locale, setLocale] = useState("ANY");
  const [tagId, setTagId] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const filters: Record<string, unknown> = { marketingConsent: true };
    if (locale !== "ANY") filters.locale = locale;
    if (tagId.trim()) filters.tagId = tagId.trim();
    const result = await mutation.submit("/v1/customer-segments", { name: name.trim(), branchId: branchId || null, filters });
    if (result) { setName(""); await resource.load(); }
  }
  return <EngagementShell title="Customer segments"><div className="s19-benefit-layout"><form className="s19-card s19-form-grid" onSubmit={submit}><h2>New consent-safe segment</h2><Field label="Segment name" value={name} onChange={setName} required placeholder="Customers due for a return visit" /><BranchSelect value={branchId} onChange={setBranchId} branches={rows(branches.data)} /><label className="s19-field"><span>Preferred locale</span><select value={locale} onChange={(event) => setLocale(event.target.value)}><option value="ANY">Any locale</option><option value="vi-VN">vi-VN</option><option value="en-US">en-US</option></select></label><Field label="Optional tag ID" value={tagId} onChange={setTagId} placeholder="Server-defined tag UUID" /><p className="s19-helper">Marketing consent is always included. The server remains authoritative for audience membership.</p><button className="s19-button s19-button-primary" type="submit">Create segment</button></form><section className="s19-card"><div className="s19-section-heading"><div><p className="s19-eyebrow">AUDIENCE DEFINITION</p><h2>Segments</h2></div></div><EngagementStates resource={resource} label="segments" /><SafeTable data={rows(resource.data)} columns={[{ key: "name", label: "Name" }, { key: "branch", label: "Branch", render: (row) => row.branchName ?? row.branchId ?? "Tenant-wide" }, { key: "filters", label: "Consent filters", render: (row) => row.filters?.marketingConsent ? "Marketing consent" : "Server policy" }, { key: "status", label: "Status", render: (row) => statusLabel(row.status ?? row.lifecycleStatus) }, { key: "version", label: "Version" }, { key: "actions", label: "Actions", render: (row) => <VersionActions mutation={mutation} version={row.version} actions={row.status === "ACTIVE" ? ["deactivate"] : ["activate"]} onAction={(action) => void mutation.submit(`/v1/customer-segments/${row.id}/${action}`, { version: row.version }).then(() => resource.load())} /> }]} /></section></div><Notice mutation={mutation} /></EngagementShell>;
}

const campaignTypes = ["PROMOTION", "NEWSLETTER", "NEW_SERVICE", "SEASONAL_CAMPAIGN", "MEMBERSHIP_OFFER", "LOYALTY_OFFER"];
const riskLevels = ["STANDARD", "ELEVATED", "HIGH"];

export function MarketingCampaigns() {
  const resource = useBenefitResource("/v1/marketing-campaigns");
  const segments = useBenefitResource("/v1/customer-segments");
  const branches = useBenefitResource("/v1/branches");
  const mutation = useBenefitMutation();
  const [name, setName] = useState(""); const [segmentId, setSegmentId] = useState(""); const [templateVersionId, setTemplateVersionId] = useState(""); const [campaignType, setCampaignType] = useState(campaignTypes[0]); const [riskLevel, setRiskLevel] = useState(riskLevels[0]); const [branchId, setBranchId] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const result = await mutation.submit("/v1/marketing-campaigns", { name: name.trim(), segmentId, templateVersionId: templateVersionId.trim(), campaignType, riskLevel, branchId: branchId || null }); if (result) { setName(""); await resource.load(); } }
  return <EngagementShell title="Email campaigns"><div className="s19-benefit-layout"><form className="s19-card s19-form-grid" onSubmit={submit}><h2>Draft campaign</h2><Field label="Campaign name" value={name} onChange={setName} required placeholder="Spring loyalty offer" /><label className="s19-field"><span>Segment</span><select value={segmentId} required onChange={(event) => setSegmentId(event.target.value)}><option value="">Choose a segment</option>{rows(segments.data).map((segment) => <option key={segment.id} value={segment.id}>{segment.name ?? segment.id}</option>)}</select></label><Field label="Template version ID" value={templateVersionId} onChange={setTemplateVersionId} required placeholder="Active template version UUID" /><label className="s19-field"><span>Campaign type</span><select value={campaignType} onChange={(event) => setCampaignType(event.target.value)}>{campaignTypes.map((type) => <option key={type}>{type}</option>)}</select></label><label className="s19-field"><span>Risk level</span><select value={riskLevel} onChange={(event) => setRiskLevel(event.target.value)}>{riskLevels.map((level) => <option key={level}>{level}</option>)}</select></label><BranchSelect value={branchId} onChange={setBranchId} branches={rows(branches.data)} /><p className="s19-helper">Approval, consent and suppression checks happen on the server. This screen never sends email from the browser.</p><button className="s19-button s19-button-primary" type="submit">Create draft</button></form><section className="s19-card"><div className="s19-section-heading"><div><p className="s19-eyebrow">DUAL CONTROL · EMAIL ONLY</p><h2>Campaigns</h2></div></div><EngagementStates resource={resource} label="campaigns" /><SafeTable data={rows(resource.data)} columns={[{ key: "name", label: "Campaign", render: (row) => <a href={`/admin/marketing/campaigns/${row.id}`}>{row.name ?? row.id}</a> }, { key: "campaignType", label: "Type", render: (row) => statusLabel(row.campaignType ?? row.campaign_type) }, { key: "status", label: "Status", render: (row) => <span className="s19-status s19-status-info">{statusLabel(row.status)}</span> }, { key: "segmentId", label: "Segment" }, { key: "scheduledAt", label: "Scheduled", render: (row) => formatDate(row.scheduledAt ?? row.scheduled_at) }, { key: "version", label: "Version" }]} /></section></div><Notice mutation={mutation} /></EngagementShell>;
}

function campaignActions(status: string) {
  if (status === "DRAFT") return ["submit", "cancel"];
  if (status === "PENDING_APPROVAL") return ["approve", "cancel"];
  if (status === "APPROVED") return ["schedule", "cancel"];
  if (status === "SCHEDULED") return ["pause", "cancel"];
  if (status === "RUNNING") return ["pause"];
  if (status === "PAUSED") return ["resume", "cancel"];
  return [];
}

export function MarketingCampaignDetail({ campaignId }: { campaignId: string }) {
  const resource = useBenefitResource(`/v1/marketing-campaigns/${encodeURIComponent(campaignId)}`);
  const audience = useBenefitResource(`/v1/marketing-campaigns/${encodeURIComponent(campaignId)}/audience`);
  const mutation = useBenefitMutation(); const [scheduledAt, setScheduledAt] = useState("");
  const campaign = resource.data?.campaign ?? resource.data ?? {};
  const status = String(campaign.status ?? "UNKNOWN");
  async function action(actionName: string) { const body: Record<string, unknown> = { version: campaign.version, reason: "Reviewed in Admin Web" }; if (actionName === "schedule") body.scheduledAt = scheduledAt ? new Date(scheduledAt).toISOString() : new Date(Date.now() + 3600000).toISOString(); const result = await mutation.submit(`/v1/marketing-campaigns/${encodeURIComponent(campaignId)}/${actionName}`, body); if (result) await resource.load(); }
  return <EngagementShell title={campaign.name ?? "Campaign detail"}><EngagementStates resource={resource} label="campaign detail" />{resource.state === "ready" && <><section className="s19-card"><div className="s19-section-heading"><div><p className="s19-eyebrow">CAMPAIGN CONTROL</p><h2>{statusLabel(status)}</h2></div><span className="s19-status s19-status-info">Version {campaign.version ?? "-"}</span></div><dl className="s19-definition-grid"><div><dt>Type</dt><dd>{statusLabel(campaign.campaignType ?? campaign.campaign_type)}</dd></div><div><dt>Segment</dt><dd>{campaign.segmentId ?? "-"}</dd></div><div><dt>Branch</dt><dd>{campaign.branchName ?? campaign.branchId ?? "Tenant-wide"}</dd></div><div><dt>Scheduled</dt><dd>{formatDate(campaign.scheduledAt ?? campaign.scheduled_at)}</dd></div></dl><p className="s19-helper">Audience and delivery state are server-reported. Consent and suppression are rechecked at send time.</p>{campaignActions(status).includes("schedule") && <Field label="Schedule at (local time)" value={scheduledAt} onChange={setScheduledAt} type="datetime-local" />}<VersionActions mutation={mutation} version={campaign.version} actions={campaignActions(status)} onAction={(name) => void action(name)} /></section><section className="s19-card"><div className="s19-section-heading"><div><p className="s19-eyebrow">NO RAW PII</p><h2>Audience preview</h2></div></div>{audience.state === "loading" ? <p className="s19-helper">Loading audience preview…</p> : audience.state === "forbidden" ? <p className="s19-helper">Audience preview is not available for this permission.</p> : <dl className="s19-definition-grid"><div><dt>Estimated recipients</dt><dd>{audience.data?.estimatedCount ?? audience.data?.count ?? rows(audience.data).length}</dd></div><div><dt>Consent policy</dt><dd>Marketing consent required</dd></div></dl>}</section></>}<Notice mutation={mutation} /></EngagementShell>;
}

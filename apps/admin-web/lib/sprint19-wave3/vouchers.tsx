"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { FormEvent, useState } from "react";
import {
  BenefitShell,
  BenefitStatePanel,
  formatDate,
  formatMoney,
  rows,
  safeVoucherCode,
  statusLabel,
  useBenefitMutation,
  useBenefitResource,
} from "./benefit-shared";

function splitIds(value: string) {
  return value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={wide ? "s19-field s19-field-wide" : "s19-field"}><span>{label}</span>{children}</label>;
}

export function VoucherCampaigns() {
  const resource = useBenefitResource("/v1/voucher-campaigns");
  const mutation = useBenefitMutation();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", discountType: "PERCENT", discountValue: "", currency: "VND", minimumSpendMinor: "0", validFrom: "", validUntil: "", totalUseLimit: "", perCustomerUseLimit: "", codeUseLimit: "1", branchIds: "", serviceIds: "", customerIds: "", membershipTierIds: "" });
  const campaigns = rows(resource.data);
  const set = (key: string, value: string) => setForm((old) => ({ ...old, [key]: value }));
  async function create(event: FormEvent) {
    event.preventDefault();
    const value = await mutation.submit("/v1/voucher-campaigns", {
      name: form.name.trim(), discountType: form.discountType, discountValue: Number(form.discountValue), currency: form.discountType === "FIXED" ? form.currency : undefined,
      minimumSpendMinor: Number(form.minimumSpendMinor || 0), totalUseLimit: form.totalUseLimit ? Number(form.totalUseLimit) : undefined,
      perCustomerUseLimit: form.perCustomerUseLimit ? Number(form.perCustomerUseLimit) : undefined, codeUseLimit: Number(form.codeUseLimit || 1),
      branchIds: splitIds(form.branchIds), serviceIds: splitIds(form.serviceIds), customerIds: splitIds(form.customerIds), membershipTierIds: splitIds(form.membershipTierIds),
      eligibilityPolicy: {}, refundPolicy: "DO_NOT_RESTORE", validFrom: new Date(form.validFrom).toISOString(), validUntil: new Date(form.validUntil).toISOString(),
    });
    if (value !== undefined) { setShowCreate(false); setForm({ name: "", discountType: "PERCENT", discountValue: "", currency: "VND", minimumSpendMinor: "0", validFrom: "", validUntil: "", totalUseLimit: "", perCustomerUseLimit: "", codeUseLimit: "1", branchIds: "", serviceIds: "", customerIds: "", membershipTierIds: "" }); await resource.load(); }
  }
  return <BenefitShell title="Voucher campaigns" eyebrow="CUSTOMER BENEFITS · VOUCHERS" backHref="/admin/benefits">
    <div className="s19-card-heading"><div><p className="s19-helper">Create and operate voucher campaigns from the server-authoritative lifecycle.</p></div><button className="s19-button s19-button-primary" type="button" onClick={() => setShowCreate((value) => !value)}>{showCreate ? "Close form" : "Create campaign"}</button></div>
    {showCreate && <form className="s19-card s19-benefit-form" onSubmit={(event) => void create(event)}><div className="s19-form-grid">
      <Field label="Campaign name"><input required value={form.name} onChange={(event) => set("name", event.target.value)} /></Field>
      <Field label="Discount type"><select value={form.discountType} onChange={(event) => set("discountType", event.target.value)}><option value="PERCENT">Percent (basis points)</option><option value="FIXED">Fixed amount</option></select></Field>
      <Field label="Discount value"><input required type="number" min="1" value={form.discountValue} onChange={(event) => set("discountValue", event.target.value)} /></Field>
      <Field label="Currency"><input maxLength={3} value={form.currency} onChange={(event) => set("currency", event.target.value.toUpperCase())} /></Field>
      <Field label="Minimum spend (minor units)"><input type="number" min="0" value={form.minimumSpendMinor} onChange={(event) => set("minimumSpendMinor", event.target.value)} /></Field>
      <Field label="Code use limit"><input type="number" min="1" value={form.codeUseLimit} onChange={(event) => set("codeUseLimit", event.target.value)} /></Field>
      <Field label="Valid from"><input required type="datetime-local" value={form.validFrom} onChange={(event) => set("validFrom", event.target.value)} /></Field>
      <Field label="Valid until"><input required type="datetime-local" value={form.validUntil} onChange={(event) => set("validUntil", event.target.value)} /></Field>
      <Field label="Total use limit"><input type="number" min="1" value={form.totalUseLimit} onChange={(event) => set("totalUseLimit", event.target.value)} /></Field>
      <Field label="Per-customer use limit"><input type="number" min="1" value={form.perCustomerUseLimit} onChange={(event) => set("perCustomerUseLimit", event.target.value)} /></Field>
      <Field label="Branch IDs (optional, comma separated)" wide><input value={form.branchIds} onChange={(event) => set("branchIds", event.target.value)} /></Field>
      <Field label="Service IDs (optional, comma separated)" wide><input value={form.serviceIds} onChange={(event) => set("serviceIds", event.target.value)} /></Field>
      <Field label="Customer IDs (optional, comma separated)" wide><input value={form.customerIds} onChange={(event) => set("customerIds", event.target.value)} /></Field>
      <Field label="Membership tier IDs (optional, comma separated)" wide><input value={form.membershipTierIds} onChange={(event) => set("membershipTierIds", event.target.value)} /></Field>
    </div><div className="s19-inline-actions"><button className="s19-button s19-button-primary" disabled={mutation.state === "submitting"}>{mutation.state === "submitting" ? "Saving…" : "Save draft"}</button>{mutation.message && <span className={mutation.state === "error" ? "s19-notice s19-notice-danger" : "s19-notice s19-notice-success"}>{mutation.code ? `${mutation.code}: ` : ""}{mutation.message}</span>}</div></form>}
    {mutation.state === "error" && !showCreate && <div className="s19-notice s19-notice-danger" role="alert">{mutation.code ? `${mutation.code}: ` : ""}{mutation.message}</div>}
    <BenefitStatePanel resource={resource} label="voucher campaigns" />
    {resource.state === "ready" && <div className="s19-benefit-table-wrap"><table className="s19-benefit-table"><caption className="s19-sr-only">Voucher campaigns</caption><thead><tr><th>Name</th><th>Status</th><th>Discount</th><th>Validity</th><th>Usage</th><th>Version</th></tr></thead><tbody>{campaigns.map((campaign) => <tr key={campaign.id}><td data-label="Name"><strong><a href={`/admin/vouchers/campaigns/${campaign.id}`}>{campaign.name}</a></strong><small>{campaign.description || "No description"}</small></td><td data-label="Status"><span className="s19-status s19-status-info">{statusLabel(campaign.status)}</span></td><td data-label="Discount">{campaign.discountType === "PERCENT" ? `${formatInteger(campaign.discountValue)} bps` : formatMoney(campaign.discountValue, campaign.currency || "VND")}</td><td data-label="Validity"><small>{formatDate(campaign.validFrom)}<br />to {formatDate(campaign.validUntil)}</small></td><td data-label="Usage">{campaign.usedCount ?? 0} / {campaign.totalUseLimit ?? "∞"}</td><td data-label="Version">{campaign.version ?? "-"}</td></tr>)}</tbody></table></div>}
  </BenefitShell>;
}

function formatInteger(value: unknown) { return new Intl.NumberFormat("vi-VN").format(Number(value ?? 0)); }

export function VoucherCampaignDetail({ campaignId }: { campaignId: string }) {
  const resource = useBenefitResource(`/v1/voucher-campaigns/${encodeURIComponent(campaignId)}`);
  const mutation = useBenefitMutation();
  const campaign = resource.data;
  async function transition(action: "activate" | "pause" | "end") { const result = await mutation.submit(`/v1/voucher-campaigns/${campaignId}/${action}`, { version: campaign?.version }); if (result !== undefined) await resource.load(); }
  return <BenefitShell title="Voucher campaign detail" eyebrow="VOUCHERS · LIFECYCLE" backHref="/admin/vouchers/campaigns"><BenefitStatePanel resource={resource} label="voucher campaign" />{campaign && <div className="s19-benefit-grid"><section className="s19-card"><div className="s19-card-heading"><div><p className="s19-eyebrow">{campaign.id}</p><h2>{campaign.name}</h2></div><span className="s19-status s19-status-info">{statusLabel(campaign.status)}</span></div><dl className="s19-benefit-detail-list"><div><dt>Discount</dt><dd>{campaign.discountType === "PERCENT" ? `${campaign.discountValue} bps` : formatMoney(campaign.discountValue, campaign.currency || "VND")}</dd></div><div><dt>Minimum spend</dt><dd>{formatMoney(campaign.minimumSpendMinor, campaign.currency || "VND")}</dd></div><div><dt>Valid from</dt><dd>{formatDate(campaign.validFrom ?? campaign.valid_from)}</dd></div><div><dt>Valid until</dt><dd>{formatDate(campaign.validUntil ?? campaign.valid_until)}</dd></div><div><dt>Usage</dt><dd>{campaign.usedCount ?? campaign.used_count ?? 0} / {campaign.totalUseLimit ?? campaign.total_use_limit ?? "∞"}</dd></div><div><dt>Version</dt><dd>{campaign.version}</dd></div></dl><div className="s19-inline-actions">{campaign.status === "DRAFT" && <button className="s19-button s19-button-primary" onClick={() => void transition("activate")}>Activate</button>}{campaign.status === "ACTIVE" && <><button className="s19-button s19-button-secondary" onClick={() => void transition("pause")}>Pause</button><button className="s19-button s19-button-danger" onClick={() => void transition("end")}>End</button></>}{campaign.status === "PAUSED" && <><button className="s19-button s19-button-primary" onClick={() => void transition("activate")}>Resume</button><button className="s19-button s19-button-danger" onClick={() => void transition("end")}>End</button></>}{mutation.message && <span className={mutation.state === "error" ? "s19-notice s19-notice-danger" : "s19-notice s19-notice-success"}>{mutation.code ? `${mutation.code}: ` : ""}{mutation.message}</span>}</div></section><VoucherCodeIssue campaignId={campaignId} /></div>}</BenefitShell>;
}

function VoucherCodeIssue({ campaignId }: { campaignId: string }) {
  const mutation = useBenefitMutation();
  const [code, setCode] = useState("");
  const [useLimit, setUseLimit] = useState("1");
  const [issued, setIssued] = useState<any>();
  async function submit(event: FormEvent) { event.preventDefault(); const value = await mutation.submit(`/v1/voucher-campaigns/${campaignId}/codes`, { code, useLimit: Number(useLimit) }); setCode(""); if (value !== undefined) setIssued(value); }
  return <section className="s19-card"><div className="s19-card-heading"><div><p className="s19-eyebrow">CODE ISSUANCE</p><h2>Issue a masked voucher code</h2></div></div><p className="s19-helper">The plaintext code is write-only and is cleared after submission. Only the masked suffix remains visible.</p><form className="s19-benefit-form" onSubmit={(event) => void submit(event)}><div className="s19-form-grid"><Field label="Plaintext code"><input required minLength={4} value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" /></Field><Field label="Use limit"><input required type="number" min="1" value={useLimit} onChange={(event) => setUseLimit(event.target.value)} /></Field></div><button className="s19-button s19-button-primary" disabled={mutation.state === "submitting"}>{mutation.state === "submitting" ? "Issuing…" : "Issue code"}</button></form>{issued && <div className="s19-notice s19-notice-success" role="status">Issued successfully: <strong>{safeVoucherCode(issued)}</strong></div>}{mutation.state === "error" && <div className="s19-notice s19-notice-danger" role="alert">{mutation.code ? `${mutation.code}: ` : ""}{mutation.message}</div>}</section>;
}

export function VoucherCodes() {
  const resource = useBenefitResource("/v1/voucher-codes");
  const campaigns = useBenefitResource("/v1/voucher-campaigns");
  const campaignRows = rows(campaigns.data);
  return <BenefitShell title="Voucher codes" eyebrow="CUSTOMER BENEFITS · VOUCHERS" backHref="/admin/vouchers/campaigns"><BenefitStatePanel resource={campaigns} label="voucher campaigns" partial />{resource.state === "loading" && <div className="s19-state" role="status">Loading voucher codes…</div>}{resource.state === "forbidden" && <div className="s19-state s19-state-danger" role="alert"><strong>Permission denied</strong><span>Voucher code data is unavailable for this permission.</span></div>}{resource.state === "error" && <div className="s19-state s19-state-danger" role="alert"><strong>Unable to load voucher codes</strong><span>{resource.error}</span><button className="s19-button s19-button-secondary" onClick={() => void resource.load()}>Retry</button></div>}{resource.state === "empty" && <div className="s19-state" role="status"><strong>No voucher codes found</strong><span>Issue a code from a campaign detail page.</span></div>}{resource.state === "ready" && <div className="s19-benefit-table-wrap"><table className="s19-benefit-table"><caption className="s19-sr-only">Voucher codes</caption><thead><tr><th>Code</th><th>Campaign</th><th>Status</th><th>Usage</th><th>Expires</th></tr></thead><tbody>{rows(resource.data).map((item) => <tr key={item.id}><td data-label="Code"><strong>{safeVoucherCode(item)}</strong><small>Secret value is not recoverable</small></td><td data-label="Campaign">{item.campaignName || campaignRows.find((campaign) => campaign.id === item.campaignId)?.name || "-"}</td><td data-label="Status"><span className="s19-status s19-status-info">{statusLabel(item.status)}</span></td><td data-label="Usage">{item.usedCount ?? 0} / {item.useLimit ?? "∞"}</td><td data-label="Expires">{formatDate(item.expiresAt)}</td></tr>)}</tbody></table></div>}</BenefitShell>;
}

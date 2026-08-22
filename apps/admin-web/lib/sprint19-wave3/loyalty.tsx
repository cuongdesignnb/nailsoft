/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useState } from "react";
import { BenefitShell, BenefitStatePanel, formatDate, formatInteger, formatMoney, localized, rows, statusLabel, useBenefitMutation, useBenefitResource } from "./benefit-shared";
import LoyaltyCustomerPage from "./loyalty-customer/loyalty-customer-page";

function MutationNotice({ mutation }: { mutation: ReturnType<typeof useBenefitMutation> }) {
  if (mutation.state === "submitting") return <p className="s19-notice" role="status">Saving…</p>;
  if (mutation.state === "success") return <p className="s19-notice s19-notice-success" role="status">{mutation.message}</p>;
  if (mutation.state === "error") return <p className="s19-notice s19-notice-danger" role="alert">{mutation.code ? `${mutation.code}: ` : ""}{mutation.message}</p>;
  return null;
}

function ProgramForm({ onSaved }: { onSaved: () => void }) {
  const mutation = useBenefitMutation();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const from = String(form.get("effectiveFrom") ?? "");
    if (!name || !from) return;
    const result = await mutation.submit("/v1/loyalty-programs", {
      name, earnBasis: "NET_ORDER_AFTER_DISCOUNT_BEFORE_TIP",
      spendMinorPerPoint: Number(form.get("spendMinorPerPoint")),
      redemptionPoints: Number(form.get("redemptionPoints")),
      redemptionMinor: Number(form.get("redemptionMinor")),
      settlementDelayHours: 24, pointsValidDays: 365,
      effectiveFrom: new Date(from).toISOString(), policy: {},
    });
    if (result) { event.currentTarget.reset(); onSaved(); }
  }
  return <form className="s19-benefit-form" onSubmit={(event) => void submit(event)}><div className="s19-form-grid"><label className="s19-field"><span>Program name</span><input name="name" required /></label><label className="s19-field"><span>Spend minor / point</span><input name="spendMinorPerPoint" type="number" min="1" required /></label><label className="s19-field"><span>Redemption points</span><input name="redemptionPoints" type="number" min="1" required /></label><label className="s19-field"><span>Redemption minor</span><input name="redemptionMinor" type="number" min="1" required /></label><label className="s19-field"><span>Effective from</span><input name="effectiveFrom" type="datetime-local" required /></label></div><button className="s19-button s19-button-primary" disabled={mutation.state === "submitting"}>Create program</button><MutationNotice mutation={mutation} /></form>;
}

export default function LoyaltyPrograms() {
  const resource = useBenefitResource("/v1/loyalty-programs");
  const values = rows(resource.data);
  return <BenefitShell title="Loyalty programs" eyebrow="LOYALTY MANAGEMENT"><section className="s19-card"><div className="s19-card-heading"><div><p className="s19-eyebrow">PROGRAM CATALOG</p><h2>Effective point policies</h2></div><span className="s19-privacy-label">Server authoritative</span></div><BenefitStatePanel resource={resource} label="loyalty programs" />{resource.state === "ready" ? <div className="s19-benefit-table-wrap"><table className="s19-benefit-table"><thead><tr><th>Program</th><th>Earn basis</th><th>Redemption</th><th>Effective</th><th>Status</th></tr></thead><tbody>{values.map((item: any) => <tr key={item.id}><td data-label="Program"><strong>{localized(item.name, item.code)}</strong><small>{item.code ?? item.id}</small></td><td data-label="Earn basis">{statusLabel(item.earnBasis ?? item.earn_basis)}</td><td data-label="Redemption">{formatInteger(item.redemptionPoints ?? item.redemption_points)} pts / {formatMoney(item.redemptionMinor ?? item.redemption_minor)}</td><td data-label="Effective">{formatDate(item.effectiveFrom ?? item.effective_from)}<small>to {formatDate(item.effectiveTo ?? item.effective_to)}</small></td><td data-label="Status"><span className="s19-status s19-status-info">{statusLabel(item.status)}</span></td></tr>)}</tbody></table></div> : null}</section><section className="s19-card"><div className="s19-card-heading"><div><p className="s19-eyebrow">CONTROLLED CHANGE</p><h2>Create a program</h2></div></div><p className="s19-helper">The server validates policy overlap and records the audit event. Existing programs are never edited in place.</p><ProgramForm onSaved={() => void resource.load()} /></section></BenefitShell>;
}

export function CustomerLoyalty({ customerId }: { customerId: string }) {
  return <LoyaltyCustomerPage customerId={customerId} />;
}

export function LoyaltyAdjustments() {
  const resource = useBenefitResource("/v1/loyalty-adjustments");
  const mutation = useBenefitMutation();
  const [customerId, setCustomerId] = useState("");
  const values = rows(resource.data);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const result = await mutation.submit("/v1/loyalty-adjustments", { customerId, pointsDelta: Number(form.get("pointsDelta")), reasonCode: String(form.get("reasonCode")), note: String(form.get("note")) });
    if (result) { setCustomerId(""); event.currentTarget.reset(); void resource.load(); }
  }
  async function decide(item: any, action: "approve" | "reject") {
    const result = await mutation.submit(`/v1/loyalty-adjustments/${item.id}/${action}`, { version: Number(item.version ?? 1), reason: action === "approve" ? "Independent reviewer approval" : "Reviewer rejected adjustment" });
    if (result) void resource.load();
  }
  return <BenefitShell title="Loyalty adjustments" eyebrow="CONTROLLED BENEFIT OPERATIONS"><section className="s19-card"><div className="s19-card-heading"><div><p className="s19-eyebrow">REQUEST</p><h2>Submit an adjustment</h2></div></div><p className="s19-helper">Approval is performed by an independent authenticated reviewer. The requester cannot approve their own adjustment.</p><form className="s19-benefit-form" onSubmit={(event) => void create(event)}><div className="s19-form-grid"><label className="s19-field"><span>Customer ID</span><input value={customerId} onChange={(event) => setCustomerId(event.target.value)} required placeholder="UUID" /></label><label className="s19-field"><span>Points delta</span><input name="pointsDelta" type="number" min="-1000000" max="1000000" required /></label><label className="s19-field"><span>Reason code</span><input name="reasonCode" required /></label><label className="s19-field s19-field-wide"><span>Evidence note</span><textarea name="note" minLength={3} required /></label></div><button className="s19-button s19-button-primary" disabled={mutation.state === "submitting"}>Submit request</button><MutationNotice mutation={mutation} /></form></section><section className="s19-card"><div className="s19-card-heading"><div><p className="s19-eyebrow">REVIEW QUEUE</p><h2>Pending and historical requests</h2></div></div><BenefitStatePanel resource={resource} label="loyalty adjustments" />{resource.state === "ready" ? <div className="s19-benefit-stack">{values.map((item: any) => <article className="s19-benefit-item" key={item.id}><div><strong>{item.pointsDelta ?? item.points_delta} points</strong><span>{item.reasonCode ?? item.reason_code} · {item.customerId ?? item.customer_id}</span><small>Requested {formatDate(item.createdAt ?? item.created_at)} by authenticated requester</small></div><div className="s19-inline-actions"><span className="s19-status s19-status-info">{statusLabel(item.status)}</span>{String(item.status).toUpperCase() === "PENDING" ? <><button className="s19-button s19-button-small" type="button" onClick={() => void decide(item, "approve")}>Approve</button><button className="s19-button s19-button-small s19-button-danger" type="button" onClick={() => void decide(item, "reject")}>Reject</button></> : null}</div></article>)}</div> : null}</section></BenefitShell>;
}

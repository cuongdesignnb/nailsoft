"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useBenefitMutation, useBenefitResource, benefitApi, formatDate, localized, rows, statusLabel } from "./benefit-shared";

export { benefitApi, formatDate, localized, rows, statusLabel, useBenefitMutation, useBenefitResource };

export function EngagementShell({ title, eyebrow = "CUSTOMER ENGAGEMENT · EMAIL ONLY", children }: { title: string; eyebrow?: string; children: React.ReactNode }) {
  const links = [
    ["/admin/communications/templates", "Templates"], ["/admin/communications/rules", "Rules"], ["/admin/communications/messages", "Delivery"],
    ["/admin/marketing/segments", "Segments"], ["/admin/marketing/campaigns", "Campaigns"], ["/admin/reviews", "Reviews"], ["/admin/review-requests", "Review requests"], ["/admin/service-recovery", "Service recovery"],
  ];
  return <main className="s19-benefit-page"><nav className="s19-benefit-nav" aria-label="Engagement navigation">{links.map(([href, label]) => <a href={href} key={href}>{label}</a>)}</nav><header className="s19-page-heading"><div><p className="s19-eyebrow">{eyebrow}</p><h1>{title}</h1><p className="s19-helper">Consent and suppression are checked by the server at delivery time. This workspace supports email only.</p></div><span className="s19-status s19-status-info">Email only</span></header>{children}</main>;
}

export function EngagementStates({ resource, label }: { resource: ReturnType<typeof useBenefitResource>; label: string }) {
  if (resource.state === "loading") return <div className="s19-state" role="status"><span className="s19-spinner" />Loading {label}…</div>;
  if (resource.state === "forbidden") return <div className="s19-state s19-state-danger" role="alert"><strong>Permission denied</strong><span>This engagement section is unavailable for your current scope.</span></div>;
  if (resource.state === "offline") return <div className="s19-state" role="alert"><strong>Internet connection required</strong><span>Engagement mutations are not queued offline.</span><button className="s19-button s19-button-secondary" onClick={() => void resource.load()}>Retry</button></div>;
  if (resource.state === "error") return <div className="s19-state s19-state-danger" role="alert"><strong>Unable to load {label}</strong><span>{resource.errorCode ? `${resource.errorCode}: ` : ""}{resource.error}</span><button className="s19-button s19-button-secondary" onClick={() => void resource.load()}>Retry</button></div>;
  if (resource.state === "empty") return <div className="s19-state" role="status"><strong>No {label} found</strong><span>There is no data for this branch and tenant scope yet.</span><button className="s19-button s19-button-secondary" onClick={() => void resource.load()}>Refresh</button></div>;
  return null;
}

export function Notice({ mutation }: { mutation: ReturnType<typeof useBenefitMutation> }) {
  if (!mutation.message) return null;
  return <div className={mutation.state === "error" ? "s19-notice s19-notice-danger" : "s19-notice s19-notice-success"} role={mutation.state === "error" ? "alert" : "status"}>{mutation.code ? `${mutation.code}: ` : ""}{mutation.message}</div>;
}

export function SafeTable({ data, columns }: { data: any[]; columns: Array<{ key: string; label: string; render?: (row: any) => React.ReactNode }> }) {
  if (!data.length) return <p className="s19-helper">No records are available.</p>;
  return <div className="s19-benefit-table-wrap"><table className="s19-benefit-table"><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{data.map((row, index) => <tr key={row.id ?? `${row.reference ?? "row"}-${index}`}>{columns.map((column) => <td data-label={column.label} key={column.key}>{column.render ? column.render(row) : String(row[column.key] ?? "-")}</td>)}</tr>)}</tbody></table></div>;
}

export function VersionActions({ mutation, version, actions, onAction }: { mutation: ReturnType<typeof useBenefitMutation>; version?: number; actions: string[]; onAction: (action: string) => void }) {
  return <div className="s19-inline-actions">{actions.map((action) => <button className={action === "cancel" || action === "hide" || action === "flag" ? "s19-button s19-button-danger s19-button-small" : "s19-button s19-button-secondary s19-button-small"} type="button" disabled={mutation.state === "submitting" || version == null} key={action} onClick={() => onAction(action)}>{action.replaceAll("-", " ")}</button>)}</div>;
}

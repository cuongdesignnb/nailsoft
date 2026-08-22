/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authorizedFetch } from "../auth";

export type BenefitState = "loading" | "ready" | "empty" | "error" | "forbidden" | "offline";

export function rows(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

export function localized(value: any, fallback = "-") {
  if (value == null || value === "") return fallback;
  if (typeof value === "string") return value;
  return value["vi-VN"] ?? value["en-US"] ?? value.name ?? value.code ?? fallback;
}

export function statusLabel(value: any) {
  return String(value ?? "UNKNOWN").replaceAll("_", " ");
}

export function formatDate(value: any) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(value)));
}

export function formatMoney(value: any, currency = "VND") {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: currency === "VND" ? 0 : 2 }).format(currency === "VND" ? number : number / 100);
}

export function formatInteger(value: any) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Number(value ?? 0));
}

export function safeVoucherCode(value: any) {
  if (value?.maskedCode) return String(value.maskedCode);
  if (value?.codeLast4) return `•••• ${String(value.codeLast4)}`;
  return "Masked code";
}

function errorFrom(body: any, fallback: string) {
  return body?.error?.message ?? body?.message ?? fallback;
}

export async function benefitApi(path: string, init?: RequestInit) {
  if (typeof navigator !== "undefined" && !navigator.onLine && init?.method && init.method !== "GET") {
    throw Object.assign(new Error("Internet connection required. Benefit changes are not queued offline."), { offline: true });
  }
  const response = await authorizedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error(errorFrom(body, "Permission denied.")), { forbidden: true, code: body?.error?.code });
  }
  if (!response.ok) throw Object.assign(new Error(errorFrom(body, "The benefit request could not be completed.")), { code: body?.error?.code, status: response.status });
  return body?.data;
}

export function useBenefitResource(path: string | null) {
  const [state, setState] = useState<BenefitState>(path ? "loading" : "empty");
  const [data, setData] = useState<any>();
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState<string | undefined>();
  const load = useCallback(async () => {
    if (!path) { setState("empty"); return; }
    if (typeof navigator !== "undefined" && !navigator.onLine) { setState("offline"); return; }
    setState("loading"); setError(""); setErrorCode(undefined);
    try {
      const value = await benefitApi(path);
      setData(value);
      setState(rows(value).length || (value && !Array.isArray(value)) ? "ready" : "empty");
    } catch (cause: any) {
      if (cause?.offline) setState("offline");
      else if (cause?.forbidden) setState("forbidden");
      else setState("error");
      setError(cause?.message ?? "The benefit request could not be completed.");
      setErrorCode(cause?.code);
    }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { state, data, error, errorCode, load };
}

export function useBenefitMutation() {
  const [state, setState] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [code, setCode] = useState<string | undefined>();
  async function submit(path: string, body: unknown) {
    setState("submitting"); setMessage(""); setCode(undefined);
    try {
      const value = await benefitApi(path, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(body) });
      setState("success"); setMessage("Action completed successfully.");
      return value;
    } catch (cause: any) {
      setState("error"); setCode(cause?.code); setMessage(cause?.message ?? "Action failed. Review the error and retry manually.");
      return undefined;
    }
  }
  return { state, message, code, submit };
}

export function BenefitStatePanel({ resource, label, partial = false }: { resource: ReturnType<typeof useBenefitResource>; label: string; partial?: boolean }) {
  if (resource.state === "loading") return <div className="s19-state" role="status" aria-live="polite"><span className="s19-spinner" />Loading {label}...</div>;
  if (resource.state === "forbidden") return <div className="s19-state s19-state-danger" role="alert"><strong>Permission denied</strong><span>This benefit section is unavailable for your current permission.</span></div>;
  if (resource.state === "offline") return <div className="s19-state" role="alert"><strong>Internet connection required</strong><span>Benefit data is not available offline.</span><button className="s19-button s19-button-secondary" type="button" onClick={() => void resource.load()}>Retry</button></div>;
  if (resource.state === "error") return <div className="s19-state s19-state-danger" role="alert"><strong>Unable to load {label}</strong><span>{resource.error}</span><button className="s19-button s19-button-secondary" type="button" onClick={() => void resource.load()}>Retry</button></div>;
  if (resource.state === "empty") return <div className="s19-state" role="status"><strong>No {label} found</strong><span>There is no benefit data for this scope yet.</span><button className="s19-button s19-button-secondary" type="button" onClick={() => void resource.load()}>Refresh</button></div>;
  if (partial) return <div className="s19-notice s19-notice-warning" role="status">Some optional benefit sections are unavailable for your current permission.</div>;
  return null;
}

export function BenefitShell({ title, eyebrow = "CUSTOMER BENEFITS", backHref = "/admin/benefits", children }: { title: string; eyebrow?: string; backHref?: string; children: React.ReactNode }) {
  return <main className="s19-benefit-page"><header className="s19-page-heading"><div><p className="s19-eyebrow">{eyebrow}</p><h1>{title}</h1></div><a className="s19-button s19-button-secondary" href={backHref}>Quay lại</a></header>{children}</main>;
}

export function CustomerBenefitHeader({ customerId, backHref = "/admin/benefits" }: { customerId: string; backHref?: string }) {
  const profile = useBenefitResource(`/v1/customers/${encodeURIComponent(customerId)}`);
  const displayName = profile.data?.profile?.displayName ?? "Customer profile";
  return <><div className="s19-benefit-customer-header"><div><p className="s19-eyebrow">CUSTOMER 360</p><h2>{displayName}</h2><p>Permission-aware benefits and server-authoritative balances.</p></div><a className="s19-button s19-button-secondary" href={backHref}>Back to profile</a></div>{profile.state === "loading" ? <div className="s19-state" role="status">Loading customer context...</div> : profile.state === "forbidden" ? <div className="s19-state s19-state-danger" role="alert"><strong>Permission denied</strong><span>Customer context is unavailable for this role.</span></div> : profile.state === "error" ? <div className="s19-state s19-state-danger" role="alert"><strong>Unable to load customer context</strong><span>{profile.error}</span><button className="s19-button s19-button-secondary" type="button" onClick={() => void profile.load()}>Retry</button></div> : null}</>;
}

export function LedgerTable({ entries, emptyLabel = "ledger entries" }: { entries: any[]; emptyLabel?: string }) {
  if (!entries.length) return <p className="s19-helper">No {emptyLabel} are available.</p>;
  return <div className="s19-benefit-table-wrap"><table className="s19-benefit-table"><caption className="s19-sr-only">{emptyLabel}</caption><thead><tr><th>Entry</th><th>Delta</th><th>Reference</th><th>Occurred</th></tr></thead><tbody>{entries.map((entry, index) => <tr key={entry.id ?? `${entry.entryType}-${index}`}><td data-label="Entry"><strong>{statusLabel(entry.entryType ?? entry.type ?? entry.status)}</strong></td><td data-label="Delta"><span>{entry.pointsDelta != null ? `${entry.pointsDelta} points` : entry.availableDelta != null ? `${entry.availableDelta} units` : entry.unitsDelta != null ? `${entry.unitsDelta} units` : entry.points_delta != null ? `${entry.points_delta} points` : "Recorded"}</span></td><td data-label="Reference">{entry.sourceReference ?? entry.appointmentId ?? entry.orderId ?? entry.generationKey ?? "-"}</td><td data-label="Occurred">{formatDate(entry.occurredAt ?? entry.createdAt ?? entry.created_at)}</td></tr>)}</tbody></table></div>;
}

export function partialState(resources: Array<ReturnType<typeof useBenefitResource>>) {
  return resources.some((resource) => resource.state === "forbidden" || resource.state === "error") && resources.some((resource) => resource.state === "ready" || resource.state === "empty");
}

export function useCustomerLookup() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const resource = useBenefitResource(submitted ? `/v1/customers?search=${encodeURIComponent(submitted)}&limit=10` : null);
  const results = useMemo(() => rows(resource.data), [resource.data]);
  function search() { setSubmitted(query.trim()); }
  return { query, setQuery, search, resource, results, selectedId: results.length === 1 ? results[0]?.id : undefined };
}

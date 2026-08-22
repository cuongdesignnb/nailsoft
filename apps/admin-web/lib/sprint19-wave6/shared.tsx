"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button, Card, PageHeader, StatePanel, StatusBadge } from "@nailsoft/ui-web";
import { authorizedFetch } from "../auth";
import type { Wave6Route } from "./routes";

export type AsyncState = "loading" | "ready" | "empty" | "error" | "forbidden" | "offline";
export type Column = { key: string; label: string; money?: boolean; status?: boolean };
export type WorkspaceAction = { label: string; path: (row: any) => string; body?: (row: any) => Record<string, unknown>; idempotencyKey?: (row: any) => string; visible?: (row: any) => boolean };

export function rowsFrom(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  return value == null ? [] : [value];
}

export function valueFrom(row: any, key: string): any {
  return key.split(".").reduce((current, part) => current == null ? undefined : current[part], row);
}

export function formatMinor(value: unknown, currency = "VND") {
  if (value == null || value === "") return "—";
  try {
    const amount = typeof value === "bigint" ? value : BigInt(String(value));
    const divisor = ["VND", "JPY", "KRW"].includes(currency.toUpperCase()) ? 1n : 100n;
    const whole = amount / divisor;
    const remainder = (amount < 0n ? -amount : amount) % divisor;
    if (divisor === 1n) return `${whole.toLocaleString("vi-VN")} ${currency}`;
    return `${whole.toLocaleString("vi-VN")},${remainder.toString().padStart(2, "0")} ${currency}`;
  } catch {
    return String(value);
  }
}

export function formatValue(value: unknown, column?: Column) {
  if (value == null || value === "") return "—";
  if (column?.money) return formatMinor(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") {
    if ("name" in (value as Record<string, unknown>)) return String((value as any).name);
    if ("displayName" in (value as Record<string, unknown>)) return String((value as any).displayName);
    return "Available";
  }
  return String(value);
}

export async function readApi(path: string) {
  const response = await authorizedFetch(path);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error(body.error?.message ?? "Permission denied for this workspace."), { forbidden: true });
  }
  if (!response.ok) throw new Error(body.error?.message ?? "Unable to load authoritative data.");
  return body.data;
}

export async function commandApi(path: string, payload: Record<string, unknown> = {}, idempotencyKey = crypto.randomUUID()) {
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("Internet connection required. This command is not queued offline.");
  const response = await authorizedFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) throw new Error(body.error?.message ?? "Permission denied for this command.");
  if (response.status === 409) throw new Error(body.error?.code === "VERSION_CONFLICT" ? "VERSION_CONFLICT: This record changed. Reload before retrying." : body.error?.message ?? "This command conflicts with another change.");
  if (!response.ok) throw new Error(body.error?.message ?? "The command could not be completed.");
  return body.data;
}

export function Status({ value }: { value: unknown }) {
  const text = String(value ?? "UNKNOWN");
  const tone = /FAILED|DENIED|VOID|CANCELLED|UNKNOWN|STALE|DEGRADED/.test(text) ? "danger" : /PENDING|DRAFT|DELAYED|REBUILDING/.test(text) ? "warning" : /SUCCESS|ACTIVE|COMPLETED|POSTED|FRESH|HEALTHY|APPROVED/.test(text) ? "success" : "neutral";
  return <StatusBadge tone={tone}>{text.replaceAll("_", " ")}</StatusBadge>;
}

export function FreshnessBadge({ value }: { value?: unknown }) {
  return <Status value={value ?? "FRESH"} />;
}

export function ImmutableRecordBadge() { return <StatusBadge tone="info">Immutable record</StatusBadge>; }
export function DualControlNotice({ children = "Approval actions require a separate authenticated actor." }: { children?: ReactNode }) { return <p className="ns-gallery-banner"><strong>Dual control:</strong> {children}</p>; }
export function VersionConflictPanel() { return <StatePanel state="error" title="Version conflict" detail="The record changed on the server. Reload it before retrying." />; }
export function SensitiveReference({ value }: { value?: unknown }) { return <span className="ns-sensitive-reference">{value ? "••••" : "Not exposed"}</span>; }

export function WorkspaceNav({ route }: { route: Wave6Route }) {
  void route;
  return null;
}

export function ReadWorkspace({ route, endpoint, columns, description, actions = [], children, transform, summary }: { route: Wave6Route; endpoint: string; columns: Column[]; description?: string; actions?: WorkspaceAction[]; children?: ReactNode; transform?: (value: any) => any; summary?: (value: any) => ReactNode }) {
  const [state, setState] = useState<AsyncState>("loading");
  const [rows, setRows] = useState<any[]>([]);
  const [raw, setRaw] = useState<any>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setState("loading"); setError("");
    try {
      const value = transform ? transform(await readApi(endpoint)) : await readApi(endpoint);
      setRaw(value); const next = rowsFrom(value); setRows(next); setState(next.length || (value && typeof value === "object" && !Array.isArray(value) ? "ready" : false) ? "ready" : "empty");
    } catch (cause: any) {
      setError(cause?.message ?? "Unable to load authoritative data."); setState(cause?.forbidden ? "forbidden" : (typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error"));
    }
  }, [endpoint, transform]);
  useEffect(() => { void load(); }, [load]);
  async function act(action: WorkspaceAction, row: any) {
    setBusy(true); setError(""); setNotice("");
    try { await commandApi(action.path(row), action.body?.(row) ?? { version: row.version }, action.idempotencyKey?.(row)); setNotice("Saved. Server-authoritative data refreshed."); await load(); }
    catch (cause: any) { setError(cause?.message ?? "Command failed."); }
    finally { setBusy(false); }
  }
  return <main className="shell ops-shell">
    <WorkspaceNav route={route} />
    <PageHeader eyebrow={`SPRINT 19 · WAVE 6 · ${route.screenId}`} title={route.title} description={description ?? route.description} actions={<Button variant="secondary" onClick={() => void load()} disabled={state === "loading"}>Refresh</Button>} />
    {notice && <p role="status" className="success">{notice}</p>}
    {state === "loading" && <StatePanel state="loading" title="Loading authoritative data" detail="PostgreSQL remains the source of truth." />}
    {state === "forbidden" && <StatePanel state="forbidden" title="Permission denied" detail="Your effective permission or scope does not include this workspace." onRetry={() => void load()} />}
    {state === "offline" && <StatePanel state="offline" title="Internet connection required" detail="Read data is not available offline. Commands are never queued offline." onRetry={() => void load()} />}
    {state === "error" && <StatePanel state="error" title="Unable to load" detail={error} onRetry={() => void load()} />}
    {state === "empty" && <StatePanel state="empty" title="No records yet" detail="There is no data for the current authorized scope." onRetry={() => void load()} />}
    {state === "ready" && <>
      {summary ? summary(raw) : null}
      {error && <p role="alert" className="error">{error}</p>}
      <Card className="ns-table-card"><div className="ns-table-scroll"><table><caption className="sr-only">{route.title}</caption><thead><tr>{columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}{actions.length ? <th scope="col">Actions</th> : null}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id ?? row.reference ?? index}>{columns.map((column) => <td key={column.key} data-label={column.label}>{column.status ? <Status value={valueFrom(row, column.key)} /> : formatValue(valueFrom(row, column.key), column)}</td>)}{actions.length ? <td className="actions">{actions.filter((action) => action.visible?.(row) ?? true).map((action) => <Button key={action.label} variant="secondary" disabled={busy} onClick={() => void act(action, row)}>{action.label}</Button>)}</td> : null}</tr>)}</tbody></table></div></Card>
    </>}
    {children}
  </main>;
}

export function MetricCards({ values }: { values: Array<{ label: string; value: unknown; money?: boolean }> }) { return <div className="metric-grid">{values.map((item) => <article className="metric-card" key={item.label}><span>{item.label}</span><strong>{item.money ? formatMinor(item.value) : String(item.value ?? "—")}</strong></article>)}</div>; }

export function FieldForm({ title, fields, onSubmit, submitLabel = "Save", note }: { title: string; fields: Array<{ name: string; label: string; type?: string; required?: boolean; options?: string[] }>; onSubmit: (values: Record<string, string>) => Promise<void>; submitLabel?: string; note?: string }) {
  const [values, setValues] = useState<Record<string, string>>({}); const [saving, setSaving] = useState(false); const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); setMessage(""); try { await onSubmit(values); setValues({}); setMessage("Saved after server confirmation."); } catch (cause: any) { setMessage(cause?.message ?? "Unable to save."); } finally { setSaving(false); } }
  return <Card className="ns-form-card"><h2>{title}</h2>{note && <p className="hint">{note}</p>}<form className="form-grid" onSubmit={(event) => void submit(event)} noValidate>{fields.map((field) => <label key={field.name}>{field.label}{field.options ? <select required={field.required} value={values[field.name] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}><option value="">Select…</option>{field.options.map((option) => <option key={option} value={option}>{option.replaceAll("_", " ")}</option>)}</select> : <input required={field.required} type={field.type ?? "text"} value={values[field.name] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))} />}</label>)}<Button type="submit" disabled={saving}>{saving ? "Saving…" : submitLabel}</Button>{message && <p role="status">{message}</p>}</form></Card>;
}

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
  if (typeof value === "boolean") return value ? "Có" : "Không";
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

const statusLabels: Record<string, string> = {
  UNKNOWN: "Chưa xác định", FRESH: "Mới nhất", STALE: "Đã cũ", DEGRADED: "Suy giảm", HEALTHY: "Ổn định", ACTIVE: "Đang hoạt động", INACTIVE: "Không hoạt động", PENDING: "Đang chờ", PENDING_APPROVAL: "Chờ phê duyệt", DRAFT: "Bản nháp", APPROVED: "Đã phê duyệt", SCHEDULED: "Đã lên lịch", PROCESSING: "Đang xử lý", COMPLETED: "Đã hoàn tất", FAILED: "Thất bại", CANCELLED: "Đã hủy", POSTED: "Đã ghi sổ", SUCCESS: "Thành công", MATCHED: "Đã khớp", UNMATCHED: "Chưa khớp", SUGGESTED: "Đề xuất", EXCLUDED: "Đã loại trừ", DENIED: "Đã từ chối", REBUILDING: "Đang xây dựng lại", DELAYED: "Bị trì hoãn", VOID: "Đã vô hiệu hóa",
};

export function routeLabel(route: Wave6Route) {
  const labels: Record<string, string> = { "19.6.1": "Trung tâm kiểm soát kế toán", "19.6.2": "Sổ kế toán", "19.6.3": "Kỳ kế toán", "19.6.4": "Sổ nhật ký", "19.6.5": "Hàng đợi ghi sổ", "19.6.6": "Khoản mục đang mở", "19.6.7": "Báo cáo tài chính", "19.6.8": "Tài khoản ngân hàng", "19.6.9": "Dòng sao kê & đối chiếu", "19.6.10": "Đối soát & ngoại lệ", "19.6.11": "Ảnh chụp sao kê", "19.6.12": "Tổng quan thanh toán", "19.6.13": "Gói dịch vụ", "19.6.14": "Gói, quyền lợi & mức sử dụng", "19.6.15": "Hóa đơn & lịch sử", "19.6.16": "Chi tiết hóa đơn", "19.6.17": "Phương thức thanh toán", "19.6.18": "Quyền hỗ trợ tenant", "19.6.19": "Danh mục gói & giá", "19.6.20": "Danh sách tenant", "19.6.21": "Chi tiết & vòng đời tenant", "19.6.22": "Gói tenant", "19.6.23": "Quyền lợi & mức sử dụng tenant", "19.6.24": "Hóa đơn & thanh toán tenant", "19.6.25": "Vận hành hóa đơn & thanh toán", "19.6.26": "Hoàn tiền & đối soát", "19.6.27": "Nhắc thanh toán & báo cáo", "19.6.28": "Quyền hỗ trợ nền tảng", "19.6.29": "Quyền khẩn cấp", "19.6.30": "Trung tâm phân tích", "19.6.31": "Phân tích doanh thu", "19.6.32": "Phân tích lịch hẹn", "19.6.33": "Phân tích nhân sự", "19.6.34": "Chất lượng dữ liệu" };
  return labels[route.screenId] ?? route.title;
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
  const raw = String(value ?? "UNKNOWN");
  const text = statusLabels[raw] ?? raw.replaceAll("_", " ");
  const tone = /FAILED|DENIED|VOID|CANCELLED|UNKNOWN|STALE|DEGRADED/.test(raw) ? "danger" : /PENDING|DRAFT|DELAYED|REBUILDING/.test(raw) ? "warning" : /SUCCESS|ACTIVE|COMPLETED|POSTED|FRESH|HEALTHY|APPROVED|MATCHED/.test(raw) ? "success" : "neutral";
  return <StatusBadge tone={tone}>{text}</StatusBadge>;
}

export function FreshnessBadge({ value }: { value?: unknown }) {
  return <Status value={value ?? "FRESH"} />;
}

export function ImmutableRecordBadge() { return <StatusBadge tone="info">Bản ghi bất biến</StatusBadge>; }
export function DualControlNotice({ children = "Thao tác phê duyệt cần một người dùng khác đã xác thực." }: { children?: ReactNode }) { return <p className="ns-gallery-banner"><strong>Dual control: Kiểm soát kép:</strong> {children}</p>; }
export function VersionConflictPanel() { return <StatePanel state="error" title="Dữ liệu vừa thay đổi" detail="Bản ghi trên máy chủ đã thay đổi. Hãy tải lại trước khi thử lại." />; }
export function SensitiveReference({ value }: { value?: unknown }) { return <span className="ns-sensitive-reference">{value ? "••••" : "Không hiển thị"}</span>; }

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
  const title = routeLabel(route);
  return <main className="ns-data-workspace">
    <WorkspaceNav route={route} />
    <PageHeader eyebrow="TÀI CHÍNH &amp; VẬN HÀNH" title={title} accessibleTitle={route.title} description={description ?? route.description} actions={<Button variant="secondary" onClick={() => void load()} disabled={state === "loading"}>Làm mới</Button>} />
    {notice && <p role="status" className="success">{notice}</p>}
    {state === "loading" && <StatePanel state="loading" title="Đang tải dữ liệu" detail="Dữ liệu được đọc từ máy chủ và giữ nguyên bằng chứng nguồn." />}
    {state === "forbidden" && <StatePanel state="forbidden" title="Không có quyền truy cập" detail="Quyền hoặc phạm vi hiện tại không bao gồm màn hình này." onRetry={() => void load()} />}
    {state === "offline" && <StatePanel state="offline" title="Đang ngoại tuyến" detail="Dữ liệu mới không thể tải khi mất kết nối; lệnh không được xếp hàng ngoại tuyến." onRetry={() => void load()} />}
    {state === "error" && <StatePanel state="error" title="Không thể tải dữ liệu" detail={error} onRetry={() => void load()} />}
    {state === "empty" && <StatePanel state="empty" title="Chưa có dữ liệu" detail="Chưa có bản ghi trong phạm vi được cấp quyền." onRetry={() => void load()} />}
    {state === "ready" && <>
      {summary ? summary(raw) : null}
      {error && <p role="alert" className="error">{error}</p>}
      <Card className="ns-table-card"><div className="ns-table-scroll"><table><caption className="sr-only">{title}</caption><thead><tr>{columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}{actions.length ? <th scope="col">Thao tác</th> : null}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id ?? row.reference ?? index}>{columns.map((column) => <td key={column.key} data-label={column.label}>{column.status ? <Status value={valueFrom(row, column.key)} /> : formatValue(valueFrom(row, column.key), column)}</td>)}{actions.length ? <td className="actions">{actions.filter((action) => action.visible?.(row) ?? true).map((action) => <Button key={action.label} variant="secondary" disabled={busy} onClick={() => void act(action, row)}>{action.label}</Button>)}</td> : null}</tr>)}</tbody></table></div></Card>
    </>}
    {children}
  </main>;
}

export function MetricCards({ values, currency = "VND" }: { values: Array<{ label: string; value: unknown; money?: boolean }>; currency?: string }) { return <div className="metric-grid">{values.map((item, index) => <article className="metric-card" key={`${item.label}-${index}`}><span>{item.label}</span><strong>{item.money ? formatMinor(item.value, currency) : String(item.value ?? "—")}</strong></article>)}</div>; }

export function FieldForm({ title, fields, onSubmit, submitLabel = "Lưu", note }: { title: string; fields: Array<{ name: string; label: string; type?: string; required?: boolean; options?: string[] }>; onSubmit: (values: Record<string, string>) => Promise<void>; submitLabel?: string; note?: string }) {
  const [values, setValues] = useState<Record<string, string>>({}); const [saving, setSaving] = useState(false); const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); setMessage(""); try { await onSubmit(values); setValues({}); setMessage("Đã lưu sau khi máy chủ xác nhận."); } catch (cause: any) { setMessage(cause?.message ?? "Không thể lưu dữ liệu."); } finally { setSaving(false); } }
  return <Card className="ns-form-card"><h2>{title}</h2>{note && <p className="hint">{note}</p>}<form className="form-grid" onSubmit={(event) => void submit(event)} noValidate>{fields.map((field) => <label key={field.name}>{field.label}{field.options ? <select required={field.required} value={values[field.name] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}><option value="">Chọn…</option>{field.options.map((option) => <option key={option} value={option}>{option.replaceAll("_", " ")}</option>)}</select> : <input required={field.required} type={field.type ?? "text"} value={values[field.name] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))} />}</label>)}<Button type="submit" disabled={saving}>{saving ? "Đang lưu…" : submitLabel}</Button>{message && <p role="status">{message}</p>}</form></Card>;
}

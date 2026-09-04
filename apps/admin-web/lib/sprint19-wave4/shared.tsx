/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "../auth";

export type Row = Record<string, any>;
export type LoadState = "loading" | "ready" | "empty" | "error" | "forbidden";

export async function api(path: string, init?: RequestInit) {
  const response = await authorizedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error(body?.error?.message ?? "Permission denied"), { forbidden: true });
  }
  if (!response.ok) throw new Error(body?.error?.message ?? body?.message ?? "Request failed. Retry safely.");
  return body?.data;
}

export async function command(path: string, body?: Row, method = "POST") {
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("Internet connection required for workforce and payroll changes.");
  const init: RequestInit = { method, headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return api(path, init);
}

export function useResource(path: string) {
  const [state, setState] = useState<LoadState>("loading");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setState("loading"); setError("");
    try { const value = await api(path); const list = Array.isArray(value) ? value : value?.items ?? (value ? [value] : []); setRows(list); setState(list.length ? "ready" : "empty"); }
    catch (cause: any) { setError(cause?.message ?? "Request failed"); setState(cause?.forbidden ? "forbidden" : "error"); }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { state, rows, error, reload: load };
}

export function StatePanel({ state, error, retry, empty = "Chưa có bản ghi phù hợp." }: { state: LoadState; error?: string; retry: () => void; empty?: string }) {
  if (state === "loading") return <div className="s19-state" role="status"><div><h2>Đang tải dữ liệu</h2><p>Đang lấy dữ liệu mới nhất từ máy chủ…</p></div></div>;
  if (state === "forbidden") return <div className="s19-state" role="alert"><div><h2>Không có quyền truy cập</h2><p>Vai trò hoặc phạm vi chi nhánh hiện tại không cho phép xem màn hình này.</p></div></div>;
  if (state === "error") return <div className="s19-state" role="alert"><div><h2>Không thể tải dữ liệu</h2><p>{error || "Máy chủ chưa trả về dữ liệu."}</p><button className="s19-button s19-button-secondary" onClick={retry}>Thử lại</button></div></div>;
  if (state === "empty") return <div className="s19-state"><div><h2>Chưa có dữ liệu</h2><p>{empty}</p></div></div>;
  return null;
}

export function Page({ eyebrow = "VẬN HÀNH NHÂN SỰ", title, description, children, actions }: { eyebrow?: string; title: string; description: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return <main className="s19-w4-page"><header className="s19-page-heading"><div><p className="s19-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{actions && <div className="s19-page-heading-actions">{actions}</div>}</header>{children}</main>;
}

export function Table({ rows, columns, onSelect }: { rows: Row[]; columns: Array<[string, string]>; onSelect?: (row: Row) => void }) {
  return <div className="s19-w4-table-wrap"><table className="s19-w4-table"><thead><tr>{columns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id ?? index} onClick={() => onSelect?.(row)}>{columns.map(([key, label]) => <td key={key} data-label={label}>{format(row[key])}</td>)}</tr>)}</tbody></table></div>;
}

export function format(value: any) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (typeof value === "object") return value.name?.["vi-VN"] ?? value.name?.["en-US"] ?? value.displayName ?? value.code ?? (value.id ? `#${String(value.id).slice(0, 8)}` : "Đã có dữ liệu");
  const labels: Record<string, string> = { ACTIVE: "Đang hoạt động", INACTIVE: "Không hoạt động", PENDING: "Đang chờ", PENDING_APPROVAL: "Chờ phê duyệt", APPROVED: "Đã phê duyệt", SUBMITTED: "Đã gửi", COMPLETED: "Đã hoàn tất", CANCELLED: "Đã hủy", FAILED: "Thất bại", OPEN: "Đang mở", CLOSED: "Đã đóng", FULL_TIME: "Toàn thời gian", PART_TIME: "Bán thời gian", CONTRACTOR: "Cộng tác viên", TEMPORARY: "Tạm thời", HOURLY: "Theo giờ", SALARY: "Theo lương", COMMISSION_ONLY: "Chỉ hoa hồng", HOURLY_PLUS_COMMISSION: "Theo giờ + hoa hồng", SALARY_PLUS_COMMISSION: "Theo lương + hoa hồng" };
  if (typeof value === "string" && labels[value]) return labels[value];
  return String(value);
}

export function Field({ label, name, type = "text", value, onChange, required }: { label: string; name: string; type?: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <label className="s19-field"><span>{label}{required ? " *" : ""}</span><input name={name} type={type} required={required} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

export function ActionButton({ label, onClick, danger = false }: { label: string; onClick: () => void; danger?: boolean }) { return <button className={`s19-button ${danger ? "s19-button-danger" : "s19-button-secondary"}`} onClick={onClick}>{label}</button>; }

export function useMutation(reload: () => Promise<void>) {
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(""); const [error, setError] = useState("");
  const run = async (path: string, body?: Row, method = "POST") => { setBusy(true); setNotice(""); setError(""); try { await command(path, body, method); setNotice("Saved successfully"); await reload(); } catch (cause: any) { setError(cause?.message ?? "The action failed. No success is shown until the server confirms it."); } finally { setBusy(false); } };
  return { busy, notice, error, run };
}

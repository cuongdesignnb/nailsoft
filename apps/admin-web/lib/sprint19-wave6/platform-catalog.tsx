"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, PageHeader, StatePanel } from "@nailsoft/ui-web";
import { commandApi, FieldForm, formatMinor, readApi, rowsFrom, Status, wave6Area, type Column } from "./shared";
import type { Wave6Route } from "./routes";
import { getAuthContext } from "../auth";

type CatalogKind = "plans" | "prices" | "discounts";
type CatalogState = "loading" | "ready" | "empty" | "error" | "forbidden" | "offline";
type CatalogColumn = Column & { compact?: boolean };

const PLAN_COLUMNS: CatalogColumn[] = [
  { key: "code", label: "Mã gói" },
  { key: "name", label: "Tên gói" },
  { key: "status", label: "Trạng thái", status: true },
  { key: "version", label: "Phiên bản", compact: true },
];
const PRICE_COLUMNS: CatalogColumn[] = [
  { key: "planCode", label: "Mã gói" },
  { key: "amountMinor", label: "Số tiền", money: true },
  { key: "currency", label: "Tiền tệ", compact: true },
  { key: "interval", label: "Chu kỳ" },
  { key: "status", label: "Trạng thái", status: true },
];
const DISCOUNT_COLUMNS: CatalogColumn[] = [
  { key: "code", label: "Mã" },
  { key: "discountType", label: "Loại" },
  { key: "amountMinor", label: "Số tiền", money: true },
  { key: "currency", label: "Tiền tệ", compact: true },
  { key: "startsAt", label: "Bắt đầu" },
  { key: "endsAt", label: "Kết thúc" },
  { key: "active", label: "Đang hoạt động" },
];

function catalogValue(row: any, ...keys: string[]) {
  for (const key of keys) {
    const value = key.split(".").reduce((current, part) => current == null ? undefined : current[part], row);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function catalogKind(href: string): CatalogKind {
  if (href === "/platform/prices") return "prices";
  if (href === "/platform/discounts") return "discounts";
  return "plans";
}

function catalogEndpoint(kind: CatalogKind) {
  return kind === "prices" ? "/v1/platform/prices" : kind === "discounts" ? "/v1/platform/discounts" : "/v1/platform/plans";
}

function catalogColumns(kind: CatalogKind) {
  return kind === "prices" ? PRICE_COLUMNS : kind === "discounts" ? DISCOUNT_COLUMNS : PLAN_COLUMNS;
}

function catalogTitle(kind: CatalogKind) {
  return kind === "prices" ? "Danh mục giá nền tảng" : kind === "discounts" ? "Danh mục giảm giá nền tảng" : "Danh mục gói nền tảng";
}

function catalogDescription(kind: CatalogKind) {
  return kind === "prices" ? "Theo dõi giá hiệu lực theo phiên bản gói; mọi thay đổi giá đều qua lệnh được máy chủ kiểm soát." : kind === "discounts" ? "Đọc các định nghĩa giảm giá nền tảng; màn hình không cung cấp thao tác tạo, sửa hoặc xóa ngoài domain hiện tại." : "Theo dõi vòng đời gói và phiên bản bất biến; không trộn danh mục thanh toán nền tảng với dịch vụ salon.";
}

function displayText(value: unknown, fallback = "Chưa có") {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return String(record["vi-VN"] ?? record.vi ?? record["en-US"] ?? record.en ?? record.name ?? record.code ?? fallback);
  }
  return value == null || value === "" ? fallback : String(value);
}

function formatDate(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatCell(row: any, column: CatalogColumn) {
  const value = catalogValue(row, column.key);
  if (value === undefined || value === null || value === "") return "—";
  if (column.status) return <Status value={value} />;
  if (column.money) return formatMinor(value, String(catalogValue(row, "currency") ?? "VND"));
  if (column.key === "active" || typeof value === "boolean") return String(value) === "true" ? "Đang hoạt động" : "Không hoạt động";
  if (column.key.endsWith("At") || column.key.endsWith("Date")) return formatDate(value);
  if (column.compact || column.key.endsWith("Id")) return <span title={String(value)}>Mã hệ thống</span>;
  return displayText(value);
}

function CatalogBoundary({ title, description, onRetry, error }: { title: string; description: string; onRetry: () => void; error: string }) {
  return <Card className="ns-platform-catalog-boundary"><span className="ns-platform-catalog-mark" aria-hidden="true">◫</span><div><p className="eyebrow">DANH MỤC NỀN TẢNG</p><h2>{title}</h2><p>{description}</p><p className="error" role="alert">{error}</p><div className="ns-platform-catalog-actions"><Button variant="secondary" onClick={onRetry}>Kiểm tra lại quyền</Button><a className="ns-button ns-button--secondary" href="/admin/support-access">Mở quyền hỗ trợ</a><a className="ns-button ns-button--secondary" href="/admin/organization/general">Về quản trị salon</a></div></div></Card>;
}

function PlanVersionPriceForm({ onSaved }: { onSaved: () => Promise<void> }) {
  const [state, setState] = useState<"loading" | "ready" | "empty" | "hidden">("loading");
  const [options, setOptions] = useState<Array<{ value: string; label: string }>>([]);

  useEffect(() => {
    let active = true;
    void Promise.all([getAuthContext(), readApi("/v1/platform/plans")]).then(([context, plans]) => {
      const permissions = context.supportAccess?.permissions ?? context.authorization?.permissions ?? [];
      if (!permissions.includes("platform.price.manage")) {
        if (active) setState("hidden");
        return;
      }
      const next = rowsFrom(plans).flatMap((plan: any) => {
        const versions = Array.isArray(plan.versions) ? plan.versions : [];
        return versions.filter((version: any) => String(version.status ?? version.state ?? "") !== "SUPERSEDED").map((version: any) => {
          const id = version.id;
          const number = version.versionNo ?? version.version_no ?? "—";
          const planName = displayText(plan.name ?? plan.code, "Gói nền tảng");
          return id ? { value: String(id), label: `${planName} · v${number} · ${displayText(version.status ?? version.state, "Chưa rõ")}` } : null;
        }).filter(Boolean) as Array<{ value: string; label: string }>;
      });
      if (active) {
        setOptions(next);
        setState(next.length ? "ready" : "empty");
      }
    }).catch(() => { if (active) setState("hidden"); });
    return () => { active = false; };
  }, []);

  if (state === "hidden") return null;
  if (state === "loading") return <Card className="ns-platform-catalog-policy"><strong>Đang tải phiên bản gói</strong><p>Đang lấy các phiên bản gói từ API để tránh nhập mã hệ thống thủ công.</p></Card>;
  if (state === "empty") return <Card className="ns-platform-catalog-policy"><strong>Chưa có phiên bản gói khả dụng</strong><p>Cần có phiên bản gói thật trước khi tạo bảng giá. Không hiển thị ô nhập UUID tự do.</p></Card>;
  return <FieldForm title="Tạo bảng giá" fields={[{ name: "planVersionId", label: "Phiên bản gói", options, required: true }, { name: "code", label: "Mã giá", required: true }, { name: "priceType", label: "Loại giá", options: ["FLAT"], required: true }, { name: "billingInterval", label: "Chu kỳ thanh toán", options: ["MONTHLY", "YEARLY"], required: true }, { name: "intervalCount", label: "Số kỳ", type: "number", required: true }, { name: "unitAmountMinor", label: "Số tiền theo minor", type: "number", required: true }, { name: "currency", label: "Tiền tệ", required: true }]} onSubmit={async (values) => { await commandApi("/v1/platform/prices", values); await onSaved(); }} note="Phiên bản gói được chọn từ danh mục thật; máy chủ vẫn xác nhận lại quyền và quan hệ trước khi ghi." />;
}

function CatalogHub({ route }: { route: Wave6Route }) {
  const kind = catalogKind(route.href);
  const endpoint = catalogEndpoint(kind);
  const columns = catalogColumns(kind);
  const title = catalogTitle(kind);
  const [state, setState] = useState<CatalogState>("loading");
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const intentKeys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    setState("loading"); setError("");
    try { const value = await readApi(endpoint); const next = rowsFrom(value); setRows(next); setState(next.length ? "ready" : "empty"); }
    catch (cause: any) { setError(cause?.message ?? "Không thể tải danh mục nền tảng."); setState(cause?.forbidden ? "forbidden" : typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error"); }
  }, [endpoint]);

  useEffect(() => { void load(); }, [load]);
  const activeCount = useMemo(() => rows.filter((row) => catalogValue(row, "active") === true || /ACTIVE|PUBLISHED|CURRENT/i.test(String(catalogValue(row, "status", "state") ?? ""))).length, [rows]);
  const attentionCount = useMemo(() => rows.filter((row) => /DRAFT|PENDING|INACTIVE|EXPIRED|DEPRECATED/i.test(String(catalogValue(row, "status", "state") ?? ""))).length, [rows]);
  const intentCount = useMemo(() => rows.filter((row) => catalogValue(row, "id")).length, [rows]);

  async function runAction(action: "publish" | "activate", row: any) {
    const id = catalogValue(row, "id");
    if (!id) return;
    const version = catalogValue(row, "version");
    const path = action === "activate" ? `/v1/platform/prices/${id}/activate` : `/v1/platform/plans/${id}/versions/${catalogValue(row, "latestVersionId", "versionId")}/publish`;
    const actionKey = `${action}:${id}`;
    let intentKey = intentKeys.current.get(actionKey);
    if (!intentKey) { intentKey = crypto.randomUUID(); intentKeys.current.set(actionKey, intentKey); }
    setBusy(actionKey); setError(""); setNotice("");
    try { await commandApi(path, { version }, intentKey); setNotice("Máy chủ đã xác nhận thao tác. Dữ liệu đang được tải lại."); await load(); }
    catch (cause: any) { setError(cause?.message ?? "Không thể hoàn tất thao tác."); }
    finally { setBusy(null); }
  }

  return <main className="shell ops-shell ns-platform-catalog-hub"><PageHeader eyebrow={`NailSoft · ${wave6Area(route.area)}`} title={title} description={catalogDescription(kind)} actions={<Button variant="secondary" onClick={() => void load()} disabled={state === "loading"}>Làm mới</Button>} />
    {notice && <p role="status" className="success">{notice}</p>}
    {state === "loading" && <StatePanel state="loading" title="Đang tải danh mục nền tảng" detail="Đang kiểm tra quyền và đọc dữ liệu danh mục từ máy chủ…" />}
    {state === "forbidden" && <CatalogBoundary title={title} description={catalogDescription(kind)} error="Bạn không có quyền xem danh mục nền tảng trong phạm vi hiện tại." onRetry={() => void load()} />}
    {state === "offline" && <StatePanel state="offline" title="Đang ngoại tuyến" detail="Danh mục nền tảng có thể chưa phải mới nhất." onRetry={() => void load()} />}
    {state === "error" && <StatePanel state="error" title="Không thể tải danh mục nền tảng" detail={error} onRetry={() => void load()} />}
    {state === "empty" && <Card className="ns-platform-catalog-empty"><span className="ns-platform-catalog-mark" aria-hidden="true">○</span><div><h2>Chưa có dữ liệu danh mục</h2><p>API không trả bản ghi trong phạm vi được cấp quyền. Màn hình không tạo dữ liệu mẫu để lấp đầy bảng.</p></div></Card>}
    {state === "ready" && <><section className="ns-platform-catalog-kpis" aria-label="Tóm tắt danh mục"><article><span>Bản ghi danh mục</span><strong>{rows.length}</strong><small>Đọc từ API nền tảng</small></article><article><span>Đang hiệu lực</span><strong>{activeCount}</strong><small>Trạng thái do máy chủ trả về</small></article><article><span>Cần rà soát</span><strong>{attentionCount}</strong><small>Bản nháp, chờ xử lý hoặc hết hiệu lực</small></article><article><span>Có mã hệ thống</span><strong>{intentCount}</strong><small>Không hiển thị mã nội bộ đầy đủ</small></article></section><Card className="ns-platform-catalog-table"><header><div><p className="eyebrow">DANH MỤC ĐÃ LƯU</p><h2>{title}</h2><p>{rows.length} bản ghi do máy chủ cung cấp trong phạm vi hiện tại.</p></div><span className="ns-platform-catalog-scope">Platform scope</span></header><div className="ns-platform-catalog-table-wrap"><table><caption className="sr-only">{title}</caption><thead><tr>{columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}{kind !== "discounts" && <th scope="col">Thao tác</th>}</tr></thead><tbody>{rows.map((row, index) => { const id = String(catalogValue(row, "id") ?? index); const canPublish = kind === "plans" && catalogValue(row, "latestVersionId", "versionId"); const canActivate = kind === "prices" && !/ACTIVE|PUBLISHED/i.test(String(catalogValue(row, "status", "state") ?? "")); return <tr key={id}>{columns.map((column) => <td key={column.key} data-label={column.label}>{formatCell(row, column)}</td>)}{kind !== "discounts" && <td className="ns-platform-catalog-actions-cell">{canPublish && <Button variant="secondary" disabled={busy !== null} onClick={() => void runAction("publish", row)}>{busy === `publish:${id}` ? "Đang xử lý…" : "Phát hành phiên bản"}</Button>}{canActivate && <Button variant="secondary" disabled={busy !== null} onClick={() => void runAction("activate", row)}>{busy === `activate:${id}` ? "Đang xử lý…" : "Kích hoạt"}</Button>}</td>}</tr>; })}</tbody></table></div></Card>{kind === "plans" && <Card className="ns-platform-catalog-policy"><strong>Vòng đời bất biến</strong><p>Phiên bản gói đã phát hành không được sửa trực tiếp. Thao tác phát hành và quyền cấu hình danh mục vẫn do máy chủ kiểm soát.</p></Card>}{kind === "prices" && <PlanVersionPriceForm onSaved={load} />}</>}
  </main>;
}

export default function PlatformCatalogWorkspace({ route }: { route: Wave6Route }) {
  return <CatalogHub route={route} />;
}

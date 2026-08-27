"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, PageHeader, StatePanel } from "@nailsoft/ui-web";
import {
  commandApi,
  formatMinor,
  readApi,
  rowsFrom,
  Status,
  wave6Area,
  wave6ColumnLabel,
  wave6Error,
  wave6Title,
  type Column,
} from "./shared";
import type { Wave6Route } from "./routes";

type WorkspaceState = "loading" | "ready" | "empty" | "error" | "forbidden" | "offline";
type PaymentKind = "invoices" | "payments" | "reconciliation" | "refunds" | "dunning" | "reports";
type PaymentColumn = Column & { compact?: boolean };

const INVOICE_COLUMNS: PaymentColumn[] = [
  { key: "invoiceNumber", label: "Số hóa đơn" },
  { key: "tenantId", label: "Tenant", compact: true },
  { key: "status", label: "Trạng thái", status: true },
  { key: "totalMinor", label: "Tổng tiền", money: true },
  { key: "currency", label: "Tiền tệ", compact: true },
  { key: "dueAt", label: "Hạn thanh toán" },
];
const PAYMENT_COLUMNS: PaymentColumn[] = [
  { key: "invoiceId", label: "Hóa đơn", compact: true },
  { key: "tenantId", label: "Tenant", compact: true },
  { key: "status", label: "Trạng thái", status: true },
  { key: "amountMinor", label: "Số tiền", money: true },
  { key: "provider", label: "Nhà cung cấp" },
  { key: "createdAt", label: "Ngày tạo" },
];
const RECONCILIATION_COLUMNS: PaymentColumn[] = [
  { key: "paymentIntentId", label: "Ý định thanh toán", compact: true },
  { key: "expectedStatus", label: "Kỳ vọng", status: true },
  { key: "observedStatus", label: "Đã quan sát", status: true },
  { key: "outcome", label: "Kết quả", status: true },
  { key: "amountMinor", label: "Số tiền", money: true },
  { key: "createdAt", label: "Ngày tạo" },
];
const REFUND_COLUMNS: PaymentColumn[] = [
  { key: "paymentIntentId", label: "Thanh toán", compact: true },
  { key: "tenantId", label: "Tenant", compact: true },
  { key: "status", label: "Trạng thái", status: true },
  { key: "amountMinor", label: "Yêu cầu", money: true },
  { key: "currency", label: "Tiền tệ", compact: true },
  { key: "createdAt", label: "Ngày tạo" },
];
const DUNNING_COLUMNS: PaymentColumn[] = [
  { key: "tenantId", label: "Tenant", compact: true },
  { key: "invoiceNumber", label: "Số hóa đơn" },
  { key: "status", label: "Trạng thái", status: true },
  { key: "currentStage", label: "Giai đoạn" },
  { key: "nextActionAt", label: "Lần xử lý tiếp theo" },
  { key: "dueAt", label: "Hạn thanh toán" },
];

const REPORT_SECTIONS = [
  { key: "tenantCounts", title: "Phạm vi Tenant" },
  { key: "subscriptionCounts", title: "Trạng thái gói" },
  { key: "billingStateCounts", title: "Trạng thái tài khoản thanh toán" },
  { key: "invoiceTotals", title: "Tổng hợp hóa đơn" },
  { key: "usageSummary", title: "Sản lượng ghi nhận" },
] as const;

function kindForRoute(href: string): PaymentKind {
  if (href === "/platform/invoices") return "invoices";
  if (href === "/platform/payments" || href === "/platform/payment-intents") return "payments";
  if (href === "/platform/reconciliation") return "reconciliation";
  if (href === "/platform/dunning") return "dunning";
  if (href === "/platform/reports") return "reports";
  return "refunds";
}

function endpointFor(kind: PaymentKind) {
  return kind === "invoices" ? "/v1/platform/invoices" : kind === "payments" ? "/v1/platform/payment-intents" : kind === "reconciliation" ? "/v1/platform/reconciliation" : kind === "dunning" ? "/v1/platform/dunning" : kind === "reports" ? "/v1/platform/reports" : "/v1/platform/refunds";
}

function columnsFor(kind: PaymentKind) {
  if (kind === "invoices") return INVOICE_COLUMNS;
  if (kind === "payments") return PAYMENT_COLUMNS;
  if (kind === "reconciliation") return RECONCILIATION_COLUMNS;
  if (kind === "dunning") return DUNNING_COLUMNS;
  return REFUND_COLUMNS;
}

function firstValue(row: any, ...keys: string[]) {
  for (const key of keys) {
    const value = key.split(".").reduce((current, part) => current == null ? undefined : current[part], row);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function shortReference(value: unknown) {
  const text = String(value ?? "");
  if (!text) return "—";
  if (text.length <= 14) return text;
  return `${text.slice(0, 8)}…${text.slice(-4)}`;
}

function formatDate(value: unknown) {
  if (!value) return "Chưa có";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatCell(row: any, column: PaymentColumn) {
  const value = firstValue(row, column.key);
  if (value === undefined || value === null || value === "") return "—";
  if (column.status) return <Status value={value} />;
  if (column.money) return formatMinor(value, String(firstValue(row, "currency") ?? "VND"));
  if (column.key.endsWith("At") || column.key.endsWith("Date") || column.key === "dueAt") return formatDate(value);
  if (column.compact || column.key.endsWith("Id")) return <span title={String(value)}>{shortReference(value)}</span>;
  return String(value);
}

function statusValue(row: any) {
  return String(firstValue(row, "status", "state", "outcome") ?? "UNKNOWN").toUpperCase();
}

function titleFor(kind: PaymentKind, route: Wave6Route) {
  if (kind === "invoices") return "Vận hành hóa đơn nền tảng";
  if (kind === "payments") return wave6Title(route.title);
  if (kind === "reconciliation") return wave6Title(route.title);
  if (kind === "refunds") return "Hoàn tiền & đối soát nền tảng";
  if (kind === "reports") return "Báo cáo nền tảng";
  return "Theo dõi công nợ nền tảng";
}

function descriptionFor(kind: PaymentKind) {
  if (kind === "invoices") return "Theo dõi hóa đơn gói nền tảng, hạn thanh toán và trạng thái thu tiền do máy chủ xác nhận.";
  if (kind === "payments") return "Theo dõi ý định thanh toán và bằng chứng nhà cung cấp; kết quả chưa xác định phải được đối soát trước khi thử lại.";
  if (kind === "reconciliation") return "Đọc bằng chứng đối soát đã lưu; timeout hoặc kết quả chưa xác định không bị suy diễn thành thất bại.";
  if (kind === "refunds") return "Quản lý hoàn tiền nền tảng với kiểm soát kép và đối soát kết quả nhà cung cấp.";
  if (kind === "reports") return "Chỉ số SaaS được tổng hợp từ nguồn nền tảng; không bao gồm dữ liệu POS salon hay hồ sơ khách hàng.";
  return "Theo dõi công nợ quá hạn ở chế độ chỉ đọc; mọi nhắc thanh toán phải đi qua luồng được máy chủ cấp phép.";
}

function actionFor(kind: PaymentKind, action: string, row: any) {
  const id = firstValue(row, "id");
  if (!id) return null;
  const tenantId = firstValue(row, "tenantId", "tenant_id");
  const version = firstValue(row, "version");
  if (kind === "invoices") return { path: `/v1/platform/invoices/${id}/${action}`, payload: { tenantId, version } };
  if (kind === "payments") return { path: `/v1/platform/payment-intents/${id}/reconcile`, payload: { tenantId, version, observedStatus: "MANUAL_REVIEW" } };
  if (kind === "refunds") return { path: `/v1/platform/refunds/${id}/${action}`, payload: { tenantId, version, reason: "Thao tác từ màn hình vận hành nền tảng" } };
  return null;
}

function actionVisible(kind: PaymentKind, action: string, row: any) {
  const status = statusValue(row);
  if (kind === "invoices") return status === "DRAFT";
  if (kind === "payments") return status === "UNKNOWN";
  if (kind === "refunds") {
    if (action === "submit") return status === "DRAFT";
    if (action === "approve") return status === "PENDING_APPROVAL";
    if (action === "reconcile") return status === "UNKNOWN" || status === "MANUAL_REVIEW";
  }
  return false;
}

function actionLabel(action: string) {
  return action === "calculate" ? "Tính hóa đơn" : action === "finalize" ? "Chốt hóa đơn" : action === "reconcile" ? "Đối soát" : action === "submit" ? "Gửi duyệt" : "Phê duyệt";
}

function isAttention(kind: PaymentKind, row: any) {
  const status = statusValue(row);
  if (["FAILED", "UNKNOWN", "DEGRADED", "MANUAL_REVIEW"].includes(status)) return true;
  return kind === "dunning";
}

function reportRows(raw: any, key: string) { return rowsFrom(raw?.[key]); }
function reportCount(raw: any, key: string) { return reportRows(raw, key).reduce((total, row) => total + Number(firstValue(row, "count", "tenantCount", "invoiceCount") ?? 0), 0); }

function PlatformAccessBoundary({ title, onRetry, error }: { title: string; onRetry: () => void; error?: string }) {
  return <Card className="ns-platform-payment-boundary"><div className="ns-platform-payment-boundary-mark" aria-hidden="true">◈</div><div><p className="eyebrow">PHẠM VI NỀN TẢNG</p><h2>{title}</h2><p>Quyền salon hiện tại không bao gồm vận hành thanh toán nền tảng. Dữ liệu vận hành salon không bị mở rộng từ màn hình này.</p>{error && <p role="alert" className="error">{error}</p>}<div className="ns-platform-payment-boundary-actions"><Button variant="secondary" onClick={onRetry}>Kiểm tra lại quyền</Button><a className="ns-button ns-button--secondary" href="/admin/support-access">Mở quyền hỗ trợ</a><a className="ns-button ns-button--secondary" href="/admin/organization/general">Về quản trị salon</a></div></div></Card>;
}

function ReportSections({ raw }: { raw: any }) {
  return <div className="ns-platform-report-grid">{REPORT_SECTIONS.map((section) => { const rows = reportRows(raw, section.key); return <Card key={section.key} className="ns-platform-report-card"><header><div><p className="eyebrow">BÁO CÁO API</p><h2>{section.title}</h2></div><strong>{rows.length}</strong></header>{rows.length ? <ul>{rows.slice(0, 6).map((row, index) => <li key={String(firstValue(row, "id", "code", "meterCode", "status", "currency") ?? index)}><span>{String(firstValue(row, "code", "meterCode", "status", "currency", "state") ?? "Bản ghi")}</span><b>{String(firstValue(row, "count", "tenantCount", "invoiceCount", "quantity") ?? "—")}</b>{firstValue(row, "totalMinor", "paidMinor", "refundedMinor") !== undefined && <small>{formatMinor(firstValue(row, "totalMinor", "paidMinor", "refundedMinor"), String(firstValue(row, "currency") ?? "VND"))}</small>}</li>)}</ul> : <p className="ns-platform-payment-empty">Chưa có dữ liệu trong phạm vi được cấp quyền.</p>}</Card>; })}</div>;
}

function PlatformPaymentPanel({ route }: { route: Wave6Route }) {
  const kind = kindForRoute(route.href);
  const endpoint = endpointFor(kind);
  const columns = columnsFor(kind);
  const [state, setState] = useState<WorkspaceState>("loading");
  const [rows, setRows] = useState<any[]>([]);
  const [raw, setRaw] = useState<any>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const intentKeys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    setState("loading"); setError("");
    try { const value = await readApi(endpoint); setRaw(value); const next = kind === "reports" ? [] : rowsFrom(value); setRows(next); setState(kind === "reports" || next.length ? "ready" : "empty"); }
    catch (cause: any) { setError(cause?.message ?? "Không thể tải dữ liệu vận hành nền tảng."); setState(cause?.forbidden ? "forbidden" : typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error"); }
  }, [endpoint, kind]);

  useEffect(() => { void load(); }, [load]);
  const attentionCount = useMemo(() => rows.filter((row) => isAttention(kind, row)).length, [kind, rows]);
  const activeCount = useMemo(() => rows.filter((row) => !["COMPLETED", "PAID", "CANCELLED", "SUCCEEDED", "FAILED", "VOID"].includes(statusValue(row))).length, [rows]);
  const totalAmount = useMemo(() => rows.reduce((total, row) => { const amount = firstValue(row, "totalMinor", "amountMinor"); if (amount === undefined || amount === null) return total; try { return total + BigInt(String(amount)); } catch { return total; } }, 0n), [rows]);

  async function runAction(action: string, row: any) {
    const descriptor = actionFor(kind, action, row); const id = String(firstValue(row, "id") ?? ""); if (!descriptor || !id) return;
    const intentKeyId = `${kind}:${action}:${id}`; let intentKey = intentKeys.current.get(intentKeyId); if (!intentKey) { intentKey = crypto.randomUUID(); intentKeys.current.set(intentKeyId, intentKey); }
    setBusy(intentKeyId); setError(""); setNotice("");
    try { await commandApi(descriptor.path, descriptor.payload, intentKey); setNotice("Máy chủ đã xác nhận thao tác. Dữ liệu đang được tải lại."); await load(); }
    catch (cause: any) { setError(cause?.message ?? "Không thể hoàn tất thao tác."); }
    finally { setBusy(null); }
  }

  const title = titleFor(kind, route);
  return <main className="shell ops-shell ns-platform-payment-hub">
    <PageHeader eyebrow={`NailSoft · ${wave6Area(route.area)}`} title={title} description={descriptionFor(kind)} actions={<Button variant="secondary" onClick={() => void load()} disabled={state === "loading"}>Làm mới</Button>} />
    {notice && <p role="status" className="success">{notice}</p>}
    {state === "loading" && <StatePanel state="loading" title="Đang tải vận hành nền tảng" detail="Đang đọc bằng chứng hóa đơn, thanh toán và đối soát từ máy chủ…" />}
    {state === "forbidden" && <PlatformAccessBoundary title={title} error="Bạn không có quyền xem dữ liệu trong phạm vi hiện tại." onRetry={() => void load()} />}
    {state === "offline" && <StatePanel state="offline" title="Đang ngoại tuyến" detail="Dữ liệu thanh toán nền tảng có thể chưa phải mới nhất. Thao tác không được xếp hàng ngoại tuyến." onRetry={() => void load()} />}
    {state === "error" && <StatePanel state="error" title="Không thể tải dữ liệu nền tảng" detail={wave6Error(error)} onRetry={() => void load()} />}
    {state === "empty" && <><section className="ns-platform-payment-kpis" aria-label="Tóm tắt vận hành nền tảng"><article><span>Bản ghi đã tải</span><strong>0</strong><small>Trong phạm vi được cấp quyền</small></article><article><span>Đang cần xử lý</span><strong>0</strong><small>Không có bằng chứng cần xử lý</small></article><article><span>Tổng giá trị</span><strong>—</strong><small>Chưa có dữ liệu số tiền</small></article><article><span>Trạng thái dữ liệu</span><strong>Trống</strong><small>API không trả bản ghi</small></article></section><Card className="ns-platform-payment-empty-card"><div className="ns-platform-payment-boundary-mark" aria-hidden="true">○</div><div><h2>Chưa có bản ghi trong phạm vi hiện tại</h2><p>Không có dữ liệu thanh toán nền tảng để hiển thị. Màn hình không tạo bản ghi hoặc suy diễn số liệu trên trình duyệt.</p></div></Card></>}
    {state === "ready" && kind === "reports" && <><section className="ns-platform-payment-kpis" aria-label="Tóm tắt báo cáo nền tảng"><article><span>Tenant trong báo cáo</span><strong>{reportCount(raw, "tenantCounts")}</strong><small>Đọc từ báo cáo máy chủ</small></article><article><span>Trạng thái gói</span><strong>{reportRows(raw, "subscriptionCounts").length}</strong><small>Nhóm trạng thái được trả về</small></article><article><span>Nhóm hóa đơn</span><strong>{reportRows(raw, "invoiceTotals").length}</strong><small>Phân nhóm theo tiền tệ</small></article><article><span>Chỉ số sử dụng</span><strong>{reportRows(raw, "usageSummary").length}</strong><small>Không tự tính lại trên trình duyệt</small></article></section><ReportSections raw={raw} /><section className="ns-platform-payment-safety"><strong>Phạm vi báo cáo rõ ràng</strong><p>Báo cáo chỉ phản ánh dữ liệu nền tảng mà API cho phép. Không trộn doanh thu salon, hóa đơn POS hoặc dữ liệu khách hàng vào báo cáo SaaS.</p></section></>}
    {state === "ready" && kind !== "reports" && <><section className="ns-platform-payment-kpis" aria-label="Tóm tắt vận hành nền tảng"><article><span>Bản ghi đã tải</span><strong>{rows.length}</strong><small>Danh sách do API cung cấp</small></article><article><span>Đang cần xử lý</span><strong>{attentionCount}</strong><small>Trạng thái cần xem xét</small></article><article><span>Đang mở</span><strong>{activeCount}</strong><small>Không bao gồm trạng thái kết thúc</small></article><article><span>Tổng giá trị</span><strong>{totalAmount === 0n ? "—" : formatMinor(totalAmount.toString(), String(firstValue(rows[0], "currency") ?? "VND"))}</strong><small>Chỉ có ý nghĩa khi cùng tiền tệ</small></article></section><section className="ns-platform-payment-layout"><Card className="ns-platform-payment-table-card"><header className="ns-platform-payment-heading"><div><p className="eyebrow">DỮ LIỆU ĐÃ LƯU</p><h2>{kind === "invoices" ? "Hóa đơn nền tảng" : kind === "payments" ? "Ý định thanh toán" : kind === "reconciliation" ? "Bằng chứng đối soát" : kind === "refunds" ? "Yêu cầu hoàn tiền" : "Hồ sơ nhắc thanh toán"}</h2><p>{rows.length} bản ghi trong phạm vi hiện tại.</p></div><span className="ns-platform-payment-scope">Tenant scope do máy chủ quyết định</span></header><div className="ns-platform-payment-table-wrap"><table><caption className="sr-only">{title}</caption><thead><tr>{columns.map((column) => <th key={column.key} scope="col">{wave6ColumnLabel(column.label)}</th>)}{(kind === "invoices" || kind === "payments" || kind === "refunds") && <th scope="col">Thao tác</th>}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(firstValue(row, "id", "reference") ?? index)}>{columns.map((column) => <td key={column.key} data-label={wave6ColumnLabel(column.label)}>{formatCell(row, column)}</td>)}{(kind === "invoices" || kind === "payments" || kind === "refunds") && <td className="ns-platform-payment-actions">{(kind === "invoices" ? ["calculate", "finalize"] : kind === "payments" ? ["reconcile"] : ["submit", "approve", "reconcile"]).filter((action) => actionVisible(kind, action, row)).map((action) => { const actionKey = `${kind}:${action}:${String(firstValue(row, "id"))}`; return <Button key={action} variant="secondary" disabled={busy !== null} onClick={() => void runAction(action, row)}>{busy === actionKey ? "Đang xử lý…" : actionLabel(action)}</Button>; })}</td>}</tr>)}</tbody></table></div></Card><aside className="ns-platform-payment-side"><Card><p className="eyebrow">NGUYÊN TẮC VẬN HÀNH</p><h2>{kind === "refunds" ? "Kiểm soát kép" : kind === "reconciliation" || kind === "payments" ? "Đối soát trước khi thử lại" : "Bằng chứng bất biến"}</h2><p>{kind === "refunds" ? "Người yêu cầu không thể tự phê duyệt hoàn tiền. Hạn mức và snapshot thanh toán do máy chủ kiểm soát." : kind === "reconciliation" || kind === "payments" ? "Kết quả UNKNOWN phải có bằng chứng quan sát trước khi chuyển trạng thái. Không coi timeout là FAILED." : "Hóa đơn, trạng thái thanh toán và mốc xử lý được đọc từ bản ghi máy chủ; trình duyệt không tự sửa số liệu."}</p><a className="ns-button ns-button--secondary" href={kind === "refunds" ? "/platform/reconciliation" : "/platform/reports"}>{kind === "refunds" ? "Mở đối soát hoàn tiền" : "Mở báo cáo nền tảng"}</a></Card><Card><p className="eyebrow">PHẠM VI DỮ LIỆU</p><h2>Không trộn dữ liệu salon</h2><p>Nhóm màn hình này chỉ hiển thị vận hành đăng ký, hóa đơn và thanh toán nền tảng. Hóa đơn POS và dữ liệu khách hàng thuộc workspace riêng.</p><div className="ns-platform-payment-safety-list"><span>✓ Tenant scope</span><span>✓ Phiên bản bản ghi</span><span>✓ Idempotency khi ghi lệnh</span></div></Card></aside></section></>}
  </main>;
}

export default function PlatformPaymentsWorkspace({ route }: { route: Wave6Route }) {
  return <PlatformPaymentPanel route={route} />;
}

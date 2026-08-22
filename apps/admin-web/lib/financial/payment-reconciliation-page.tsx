/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Icon as UiIcon } from "@nailsoft/ui-web";
import {
  ACTIVE_BRANCH_CHANGED_EVENT,
  authorizedFetch,
  getActiveBranchId,
  getAuthorizedBranchContext,
  getAuthContext,
} from "../auth";
import styles from "./payment-reconciliation-page.module.css";

type Filters = {
  branchId: string;
  dateFrom: string;
  dateTo: string;
  search: string;
  tenderType: string;
  caseType: string;
  reviewState: string;
  attentionOnly: boolean;
  sort: string;
  page: number;
  pageSize: number;
};
type Item = {
  id: string;
  paymentReference: string;
  paymentStatus: string;
  tenderType: string;
  currency: string;
  branchId: string;
  branchName: string;
  timezone?: string;
  orderId?: string;
  orderNumber?: string;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  invoiceStatus?: string | null;
  appointmentId?: string | null;
  bookingReference?: string | null;
  registerCode?: string | null;
  cashierDisplayName?: string | null;
  customerDisplayName: string;
  requestedMinor: number;
  capturedMinor: number;
  expectedMinor: number | null;
  confirmedMinor: number | null;
  varianceMinor: number | null;
  provider?: string | null;
  providerTransactionIdSafe?: string | null;
  cardLast4?: string | null;
  capturedAt?: string | null;
  createdAt: string;
  caseType: string;
  reviewState: string;
  reviewDecision?: string | null;
  reviewVersion: number;
  reviewNote?: string | null;
  bulkConfirmEligible: boolean;
  reconciliationState: string;
  attention?: { required: boolean; severity: string; code: string; message: string } | null;
  evidence: { providerAvailable: boolean; cashMovementId?: string | null; reflectedInCashSession?: boolean | null };
};
type Directory = {
  items: Item[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  counts: { total: number; matched: number; reviewRequired: number; unresolved: number; missingDocument: number };
  summary: { matchedMinor: number; unreconciledMinor: number; varianceMinor: number; matchedPercentage: number; paymentMix: Array<{ tenderType: string; transactionCount: number; capturedMinor: number; percentage: number }> };
  generatedAt: string;
};
type Detail = {
  payment: Item & { cashReceivedMinor?: number | null; changeDueMinor?: number | null };
  review: { id: string; state: string; decision?: string | null; reasonCode?: string | null; note?: string | null; version: number; reviewedBy?: { displayName?: string } | null; reviewedAt?: string | null; resolvedAt?: string | null };
  systemEvidence: { expectedMinor: number | null; source: string; capturedMinor: number | null; confirmedMinor: number | null; status: string; capturedAt?: string | null; currency: string };
  providerEvidence: { available: boolean; source: string; provider?: string | null; transactionIdSafe?: string | null; cardBrand?: string | null; cardLast4?: string | null; confirmedMinor: number | null };
  cashEvidence: { available: boolean; cashSession: { id: string; status?: string; businessDate?: string; registerId?: string } | null; movement: { id: string; type: string; amountMinor: number; currency: string; occurredAt: string } | null; matched: boolean | null };
  relations: { pos: { id: string; number: string; href: string } | null; invoice: { id: string; number: string; status: string; href: string } | null; appointment: { id: string; reference?: string; status?: string; href: string } | null; cashSession: { id: string; href: string } | null };
  attention: { required: boolean; severity: string; code: string; message: string } | null;
  history: Array<{ eventType: string; occurredAt: string; label: string; actor?: string; note?: string; decision?: string; state?: string }>;
  capabilities: { canReview: boolean; canConfirmMatch: boolean; canAcceptVariance: boolean; canEscalate: boolean; bulkConfirmEligible: boolean };
  sourceStatus: Record<string, string>;
};
type Branch = { id: string; name: string; timezone?: string; status?: string };

const EMPTY_FILTERS: Filters = {
  branchId: "",
  dateFrom: "",
  dateTo: "",
  search: "",
  tenderType: "",
  caseType: "",
  reviewState: "",
  attentionOnly: false,
  sort: "NEWEST",
  page: 1,
  pageSize: 10,
};
const TENDER_LABEL: Record<string, string> = { CASH: "Tiền mặt", CARD_EXTERNAL: "Thẻ", BANK_TRANSFER: "Chuyển khoản", OTHER_EXTERNAL: "Khác" };
const CASE_LABEL: Record<string, string> = {
  MATCH: "Khớp",
  AMOUNT_MISMATCH: "Có chênh lệch",
  MISSING_INVOICE: "Thiếu chứng từ",
  MISSING_CASH_MOVEMENT: "Thiếu giao dịch tiền mặt",
  MISSING_CASH_SESSION: "Thiếu phiên thu ngân",
  PROVIDER_UNRESOLVED: "Chưa xác định",
  PROVIDER_EVIDENCE_MISMATCH: "Provider lệch",
  PARTIAL_OUTSTANDING: "Còn phải thu",
};
const STATE_LABEL: Record<string, string> = { OPEN: "Mở", UNDER_REVIEW: "Đang kiểm tra", RESOLVED: "Đã đối soát", ESCALATED: "Đã chuyển quản lý" };

function today() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}
function money(value: number | null | undefined, currency = "VND") {
  if (value == null) return "—";
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}
function dateTime(value?: string | null, timezone?: string) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("vi-VN", { timeZone: timezone || undefined, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  }
}
function unwrap(body: any) { return body?.data; }
function labelCase(value: string) { return CASE_LABEL[value] ?? value; }
function sourceLabel(value: string | undefined) {
  return ({
    AVAILABLE: "Có dữ liệu",
    MISSING: "Thiếu dữ liệu",
    NOT_REQUIRED: "Không áp dụng",
    NOT_APPLICABLE: "Không áp dụng",
    PAYMENT_CAPTURE_EVIDENCE: "Bằng chứng capture",
    NOT_INTEGRATED: "Chưa có tích hợp provider",
  } as Record<string, string>)[value ?? ""] ?? value ?? "—";
}
function statusTone(value: string) { return value === "MATCH" || value === "RESOLVED" ? "success" : value === "AMOUNT_MISMATCH" || value === "PROVIDER_EVIDENCE_MISMATCH" ? "danger" : "warning"; }
function readFilters(): Filters {
  if (typeof window === "undefined") return EMPTY_FILTERS;
  const params = new URLSearchParams(window.location.search);
  const page = Number(params.get("page"));
  const pageSize = Number(params.get("pageSize"));
  return {
    ...EMPTY_FILTERS,
    branchId: params.get("branchId") ?? getActiveBranchId() ?? "",
    dateFrom: params.get("dateFrom") ?? "",
    dateTo: params.get("dateTo") ?? "",
    search: params.get("search") ?? "",
    tenderType: params.get("tenderType") ?? "",
    caseType: params.get("caseType") ?? "",
    reviewState: params.get("reviewState") ?? "",
    attentionOnly: params.get("attentionOnly") === "true",
    sort: params.get("sort") ?? "NEWEST",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: [10, 20, 50, 100].includes(pageSize) ? pageSize : 10,
  };
}
function queryString(filters: Filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== "" && value !== false && value != null) params.set(key, String(value));
  });
  return params.toString();
}
async function api(path: string, init?: RequestInit) {
  const response = await authorizedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message ?? "Không thể tải dữ liệu đối soát.");
  return unwrap(body);
}
function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) { return <span className={`${styles.badge} ${styles[`badge_${tone}`]}`}>{children}</span>; }
function IconCircle({ children, tone = "rose" }: { children: ReactNode; tone?: string }) { return <span className={`${styles.iconCircle} ${styles[`tone_${tone}`]}`}>{children}</span>; }
function Icon({ name }: { name: string }) { return <UiIcon name={(name === "help" ? "alert" : name) as any} />; }

export default function PaymentReconciliationPage() {
  const [filters, setFilters] = useState<Filters>(() => readFilters());
  const [branches, setBranches] = useState<Branch[]>([]);
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [decisionChoice, setDecisionChoice] = useState("");
  const [saving, setSaving] = useState(false);
  const [authContext, setAuthContext] = useState<any>();

  const canReview = Boolean((authContext?.supportAccess?.permissions ?? authContext?.authorization?.permissions ?? []).includes("financial.reconciliation.review"));
  const selectedItems = useMemo(() => (directory?.items ?? []).filter((item) => selected.includes(item.id)), [directory, selected]);
  const allSelectedEligible = selectedItems.length > 0 && selectedItems.every((item) => item.bulkConfirmEligible);

  const load = async (keepDetail = true) => {
    if (!filters.branchId) return;
    setLoading(true);
    setError("");
    try {
      const qs = queryString(filters);
      const [nextDirectory, nextDaily] = await Promise.all([
        api(`/v1/financial/reconciliation/payments?${qs}`),
        api(`/v1/financial/reconciliation/daily?branchId=${encodeURIComponent(filters.branchId)}&businessDate=${filters.dateFrom || today()}`),
      ]);
      setDirectory({ ...nextDirectory, daily: nextDaily });
      if (!keepDetail) setDetail(null);
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể tải dữ liệu đối soát.");
    } finally { setLoading(false); }
  };
  const selectDetail = async (id: string) => {
    setDetailLoading(true);
    try { setDetail(await api(`/v1/financial/reconciliation/payments/${id}`)); }
    catch (cause: any) { setError(cause?.message ?? "Không thể tải chi tiết đối soát."); }
    finally { setDetailLoading(false); }
  };
  useEffect(() => {
    let active = true;
    void Promise.all([getAuthorizedBranchContext(), getAuthContext()]).then(([scope, context]) => {
      if (!active) return;
      setBranches(scope.branches as Branch[]);
      setAuthContext(context);
      setFilters((current) => ({ ...current, branchId: current.branchId || scope.branchId || scope.branches[0]?.id || "" }));
    }).catch((cause: any) => setError(cause?.message ?? "Không thể tải workspace."));
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const handleBranchChange = (event: Event) => {
      const nextBranchId = (event as CustomEvent<string | undefined>).detail ?? "";
      setSelected([]);
      setDetail(null);
      setFilters((current) => current.branchId === nextBranchId ? current : { ...current, branchId: nextBranchId, page: 1 });
    };
    window.addEventListener(ACTIVE_BRANCH_CHANGED_EVENT, handleBranchChange);
    return () => window.removeEventListener(ACTIVE_BRANCH_CHANGED_EVENT, handleBranchChange);
  }, []);
  useEffect(() => {
    if (!filters.branchId) return;
    const timer = window.setTimeout(() => {
      window.history.replaceState(null, "", `/admin/financial/reconciliation?${queryString(filters)}`);
      void load(true);
    }, filters.search ? 280 : 0);
    return () => window.clearTimeout(timer);
  }, [filters]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(true); }, 15_000);
    return () => window.clearInterval(timer);
  }, [filters.branchId, filters.dateFrom, filters.dateTo, filters.search, filters.tenderType, filters.caseType, filters.reviewState, filters.attentionOnly, filters.sort, filters.page, filters.pageSize]);
  useEffect(() => {
    const first = directory?.items[0];
    if (!first) { setDetail(null); return; }
    if (!detail || !directory.items.some((item) => item.id === detail.payment.id)) void selectDetail(first.id);
  }, [directory]);

  const update = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch, page: patch.page ?? 1 }));
  const clearFilters = () => setFilters({ ...EMPTY_FILTERS, branchId: filters.branchId });
  const toggleSelected = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const toggleAll = () => {
    const currentIds = directory?.items.map((item) => item.id) ?? [];
    setSelected((current) => currentIds.every((id) => current.includes(id)) ? current.filter((id) => !currentIds.includes(id)) : Array.from(new Set([...current, ...currentIds])));
  };
  const write = async (path: string, body: unknown) => {
    setSaving(true); setError("");
    try {
      const result = await api(path, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(body) });
      setNotice("Đã lưu kết quả đối soát.");
      await load(true);
      if (detail?.payment.id) await selectDetail(detail.payment.id);
      return result;
    } catch (cause: any) { setError(cause?.message ?? "Không thể lưu kết quả đối soát."); return null; }
    finally { setSaving(false); }
  };
  const saveNote = async () => {
    if (!detail || !note.trim()) return;
    const result = await write(`/v1/financial/reconciliation/payments/${detail.payment.id}/notes`, { version: detail.review.version, note: note.trim() });
    if (result) { setNote(""); setNotice("Đã lưu ghi chú đối soát."); }
  };
  const saveDecision = async (decision: string) => {
    if (!detail) return;
    const result = await write(`/v1/financial/reconciliation/payments/${detail.payment.id}/decision`, { version: detail.review.version, decision, reasonCode: reason || undefined, note: decisionNote.trim() || undefined });
    if (result) { setReason(""); setDecisionNote(""); setDecisionChoice(""); }
  };
  const bulkConfirm = async () => {
    if (!allSelectedEligible || !canReview) return;
    const versionByPaymentId = Object.fromEntries(selectedItems.map((item) => [item.id, item.reviewVersion]));
    const result = await write("/v1/financial/reconciliation/payments/bulk-confirm", { versionByPaymentId });
    if (result) { setSelected([]); setNotice(`Đã đối soát ${result.resolvedCount ?? 0} giao dịch khớp chính xác.`); }
  };
  const exportReport = async () => {
    setSaving(true); setError("");
    try {
      const result = await api("/v1/financial/exports", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ branchId: filters.branchId, exportType: "PAYMENT_RECONCILIATION", filters }) });
      setNotice(`Đã tạo yêu cầu xuất báo cáo (${result.status ?? "PENDING"}).`);
    } catch (cause: any) { setError(cause?.message ?? "Không thể tạo export."); }
    finally { setSaving(false); }
  };

  const daily = (directory as any)?.daily;
  return <main className={styles.page}>
    <header className={styles.pageHeader}>
      <div><p className={styles.breadcrumb}><Link href="/admin/financial">Tài chính</Link><b>/</b> Đối soát thanh toán</p><h1>Đối soát thanh toán</h1><p className={styles.subtitle}>Kiểm tra sự khớp đúng giữa giao dịch, hóa đơn, đơn POS và chứng từ thanh toán trước khi xác nhận đối soát.</p></div>
      <div className={styles.headerActions}><button className={styles.secondaryButton} onClick={() => void exportReport()} disabled={saving}><Icon name="download" /> Xuất báo cáo</button><button className={styles.secondaryButton} onClick={() => void load(true)} disabled={loading}><Icon name="refresh" /> Làm mới dữ liệu</button><button className={styles.primaryButton} onClick={() => void bulkConfirm()} disabled={!canReview || !allSelectedEligible || saving}><Icon name="check" /> Đối soát các mục đã chọn</button></div>
    </header>
    {error && <div className={styles.error} role="alert">{error}<button onClick={() => setError("")}>Đóng</button></div>}
    {notice && <div className={styles.notice} role="status">✓ {notice}<button onClick={() => setNotice("")}>Đóng</button></div>}
    <section className={styles.hero}><div className={styles.heroTitle}><IconCircle><Icon name="refresh" /></IconCircle><div><h2>Tình trạng đối soát hôm nay</h2><p>{daily?.generatedAt ? `Cập nhật ${dateTime(daily.generatedAt, branches.find((branch) => branch.id === filters.branchId)?.timezone)}` : "Dữ liệu được tính từ server"}</p></div></div><div className={styles.matchRate}><strong>{directory?.summary.matchedPercentage?.toLocaleString("vi-VN") ?? "—"}%</strong><span>đã đối soát</span><div><i style={{ width: `${Math.min(100, directory?.summary.matchedPercentage ?? 0)}%` }} /></div></div></section>
    <section className={styles.kpiGrid} aria-label="Tổng quan đối soát"><Kpi icon={<Icon name="payment" />} tone="rose" label="Giao dịch" value={directory?.counts.total ?? "—"} detail="Trong phạm vi lọc" /><Kpi icon={<Icon name="check" />} tone="green" label="Đã khớp" value={directory?.counts.matched ?? "—"} detail={money(directory?.summary.matchedMinor)} /><Kpi icon={<Icon name="alert" />} tone="amber" label="Cần kiểm tra" value={directory?.counts.reviewRequired ?? "—"} detail={money(directory?.summary.unreconciledMinor)} /><Kpi icon={<Icon name="help" />} tone="purple" label="Chưa xác định" value={directory?.counts.unresolved ?? "—"} detail="Provider chưa rõ" /><Kpi icon={<Icon name="file" />} tone="coral" label="Thiếu chứng từ" value={directory?.counts.missingDocument ?? "—"} detail="Invoice chưa phát hành" /></section>
    <section className={styles.metricStrip}><Metric label="Giá trị đã khớp" value={money(directory?.summary.matchedMinor)} tone="green" /><Metric label="Giá trị cần đối soát" value={money(directory?.summary.unreconciledMinor)} tone="rose" /><Metric label="Chênh lệch ròng" value={money(directory?.summary.varianceMinor)} tone={(directory?.summary.varianceMinor ?? 0) === 0 ? "green" : "amber"} /><Metric label="Daily report" value={daily ? money(daily.totalCollectedMinor, daily.currency) : "—"} tone="blue" /></section>
    <section className={styles.filterCard}><div className={styles.filterRow}><label className={styles.search}><span>⌕</span><span className="sr-only">Tìm kiếm giao dịch</span><input value={filters.search} onChange={(event) => update({ search: event.target.value })} placeholder="Tìm mã giao dịch / hóa đơn / đơn POS / mã tham chiếu..." /></label><Field label="Chi nhánh"><select value={filters.branchId} onChange={(event) => update({ branchId: event.target.value })}>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></Field><Field label="Phương thức"><select value={filters.tenderType} onChange={(event) => update({ tenderType: event.target.value })}><option value="">Tất cả</option>{Object.entries(TENDER_LABEL).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></Field><Field label="Loại đối soát"><select value={filters.caseType} onChange={(event) => update({ caseType: event.target.value })}><option value="">Tất cả</option>{Object.entries(CASE_LABEL).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></Field><Field label="Trạng thái xử lý"><select value={filters.reviewState} onChange={(event) => update({ reviewState: event.target.value })}><option value="">Tất cả</option>{Object.entries(STATE_LABEL).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></Field><Field label="Ngày từ"><input type="date" value={filters.dateFrom} onChange={(event) => update({ dateFrom: event.target.value })} /></Field><Field label="Đến ngày"><input type="date" value={filters.dateTo} onChange={(event) => update({ dateTo: event.target.value })} /></Field></div><div className={styles.filterBottom}><div className={styles.chips}><button className={!filters.attentionOnly && !filters.caseType ? styles.chipActive : styles.chip} onClick={() => update({ attentionOnly: false, caseType: "" })}>Tất cả</button><button className={filters.attentionOnly ? styles.chipActive : styles.chip} onClick={() => update({ attentionOnly: true })}>Cần xử lý</button><button className={filters.caseType === "PROVIDER_UNRESOLVED" ? styles.chipActive : styles.chip} onClick={() => update({ caseType: "PROVIDER_UNRESOLVED", attentionOnly: false })}>Chưa xác định</button><button className={filters.caseType === "AMOUNT_MISMATCH" ? styles.chipActive : styles.chip} onClick={() => update({ caseType: "AMOUNT_MISMATCH", attentionOnly: false })}>Có chênh lệch</button><button className={filters.caseType === "MISSING_INVOICE" ? styles.chipActive : styles.chip} onClick={() => update({ caseType: "MISSING_INVOICE", attentionOnly: false })}>Thiếu chứng từ</button><button className={filters.caseType === "MATCH" ? styles.chipActive : styles.chip} onClick={() => update({ caseType: "MATCH", attentionOnly: false })}>Đã khớp</button></div><div className={styles.sort}><span>Sắp xếp</span><select value={filters.sort} onChange={(event) => update({ sort: event.target.value })}><option value="NEWEST">Mới nhất</option><option value="OLDEST">Cũ nhất</option><option value="AMOUNT_DESC">Giá trị cao</option><option value="AMOUNT_ASC">Giá trị thấp</option></select><button className={styles.clearButton} onClick={clearFilters}>Xóa bộ lọc</button></div></div></section>
    <div className={styles.workspace}><section className={styles.mainColumn}><div className={styles.tableCard}><div className={styles.cardHeader}><div><h2>Giao dịch cần đối soát</h2><p>{directory ? `Hiển thị ${directory.items.length} / ${directory.pagination.total} giao dịch` : "Đang tải dữ liệu..."}</p></div><span className={styles.live}>● Live</span></div>{loading && !directory ? <div className={styles.skeleton}><span /><span /><span /></div> : directory?.items.length ? <div className={styles.tableWrap}><table><thead><tr><th><input type="checkbox" aria-label="Chọn tất cả giao dịch" checked={directory.items.length > 0 && directory.items.every((item) => selected.includes(item.id))} onChange={toggleAll} /></th><th>Giao dịch</th><th>Thời gian</th><th>Phương thức</th><th>Hóa đơn / POS</th><th>Số tiền hệ thống</th><th>Số tiền xác nhận</th><th>Chênh lệch</th><th>Đối soát</th><th>Trạng thái</th><th /></tr></thead><tbody>{directory.items.map((item) => <tr key={item.id} className={detail?.payment.id === item.id ? styles.rowSelected : ""} onClick={() => void selectDetail(item.id)}><td onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Chọn ${item.paymentReference}`} checked={selected.includes(item.id)} onChange={() => toggleSelected(item.id)} /></td><td><strong>{item.paymentReference}</strong><small>{item.customerDisplayName}</small></td><td>{dateTime(item.capturedAt ?? item.createdAt, item.timezone)}</td><td><span className={styles.tenderDot} />{TENDER_LABEL[item.tenderType] ?? item.tenderType}</td><td><strong>{item.invoiceNumber ?? "Chưa có hóa đơn"}</strong><small>{item.orderNumber ?? "—"}</small></td><td>{money(item.expectedMinor, item.currency)}</td><td>{money(item.confirmedMinor, item.currency)}</td><td className={item.varianceMinor ? (item.varianceMinor < 0 ? styles.negative : styles.positive) : ""}>{item.varianceMinor == null ? "—" : `${item.varianceMinor > 0 ? "+" : ""}${money(item.varianceMinor, item.currency)}`}</td><td><Badge tone={statusTone(item.caseType)}>{labelCase(item.caseType)}</Badge></td><td><Badge tone={item.reviewState === "RESOLVED" ? "success" : item.reviewState === "ESCALATED" ? "purple" : "neutral"}>{STATE_LABEL[item.reviewState] ?? item.reviewState}</Badge></td><td>›</td></tr>)}</tbody></table></div> : <div className={styles.empty}>Không có giao dịch cần đối soát với bộ lọc hiện tại.<button onClick={clearFilters}>Xóa bộ lọc</button></div>}{directory && <div className={styles.tableFooter}><span>Trang {directory.pagination.page} / {directory.pagination.totalPages}</span><div><button disabled={directory.pagination.page <= 1} onClick={() => update({ page: directory.pagination.page - 1 })}>‹</button><button disabled={directory.pagination.page >= directory.pagination.totalPages} onClick={() => update({ page: directory.pagination.page + 1 })}>›</button><select value={filters.pageSize} onChange={(event) => update({ pageSize: Number(event.target.value) })}><option value={10}>10 / trang</option><option value={20}>20 / trang</option><option value={50}>50 / trang</option></select></div></div>}</div><div className={styles.bottomGrid}><InfoCard title="Tình trạng đối soát"><div className={styles.health}><span><b>{directory?.summary.matchedPercentage?.toLocaleString("vi-VN") ?? "—"}%</b> Tỷ lệ khớp</span><span><b>{directory?.counts.reviewRequired ?? "—"}</b> Cần kiểm tra</span><span><b>{directory?.counts.unresolved ?? "—"}</b> Chưa xác định</span><span><b>{directory?.counts.missingDocument ?? "—"}</b> Thiếu chứng từ</span></div></InfoCard><InfoCard title="Nguồn đối chiếu"><div className={styles.sourceList}><span>POS <b>Đã đồng bộ</b></span><span>Hóa đơn <b>{daily?.unissuedInvoices ? "Cần kiểm tra" : "Đã đồng bộ"}</b></span><span>Phiên thu ngân <b>{daily?.openCashSessions ? "Đang mở" : "Đã đồng bộ"}</b></span><span>Provider <b>Chưa có feed độc lập</b></span></div></InfoCard></div></section><aside className={styles.rail}><div className={styles.railCard}>{detailLoading ? <div className={styles.detailLoading}>Đang tải chi tiết...</div> : detail ? <><div className={styles.railHeader}><div><p>Chi tiết đối soát</p><h2>{detail.payment.paymentReference}</h2></div><Badge tone={statusTone(detail.payment.caseType)}>{labelCase(detail.payment.caseType)}</Badge></div><div className={styles.customer}><IconCircle tone="rose">{detail.payment.customerDisplayName.slice(0, 1)}</IconCircle><div><strong>{detail.payment.customerDisplayName}</strong><small>{TENDER_LABEL[detail.payment.tenderType] ?? detail.payment.tenderType} · {detail.payment.paymentStatus}</small></div></div><div className={styles.amountCompare}><Amount label="Hệ thống" value={detail.systemEvidence.expectedMinor} currency={detail.payment.currency} /><span>vs</span><Amount label="Xác nhận" value={detail.systemEvidence.confirmedMinor} currency={detail.payment.currency} /></div><div className={styles.detailRows}><Row label="Chênh lệch" value={detail.payment.varianceMinor == null ? "—" : `${detail.payment.varianceMinor > 0 ? "+" : ""}${money(detail.payment.varianceMinor, detail.payment.currency)}`} /><Row label="Đối soát" value={STATE_LABEL[detail.review.state] ?? detail.review.state} /><Row label="Thu ngân" value={detail.payment.cashierDisplayName ?? "—"} /><Row label="Thời gian" value={dateTime(detail.payment.capturedAt ?? detail.payment.createdAt, detail.payment.timezone)} /></div>{detail.attention && <div className={styles.attention}><strong>⚠ {detail.attention.message}</strong><small>{detail.attention.code}</small></div>}<div className={styles.linkGrid}>{detail.relations.pos && <Link href={detail.relations.pos.href}>Mở đơn POS →</Link>}{detail.relations.invoice && <Link href={detail.relations.invoice.href}>Mở hóa đơn →</Link>}{detail.relations.appointment && <Link href={detail.relations.appointment.href}>Mở lịch hẹn →</Link>}{detail.relations.cashSession && <Link href={detail.relations.cashSession.href}>Mở phiên thu ngân →</Link>}</div></> : <div className={styles.emptyRail}>Chọn một giao dịch để xem chi tiết.</div>}</div>{detail && <><div className={styles.railCard}><div className={styles.railHeader}><div><p>Bằng chứng thanh toán</p><h2>{detail.payment.paymentReference}</h2></div><Badge tone="success">An toàn</Badge></div><Row label="Provider" value={detail.providerEvidence.provider ?? "—"} /><Row label="Mã tham chiếu" value={detail.providerEvidence.transactionIdSafe ?? "Không có feed provider"} /><Row label="Thẻ" value={detail.providerEvidence.cardLast4 ? `•••• ${detail.providerEvidence.cardLast4}` : "—"} /><Row label="Tiền mặt nhận" value={detail.payment.cashReceivedMinor == null ? "—" : money(detail.payment.cashReceivedMinor, detail.payment.currency)} /><Row label="Tiền thừa" value={detail.payment.changeDueMinor == null ? "—" : money(detail.payment.changeDueMinor, detail.payment.currency)} /></div><div className={styles.railCard}><div className={styles.railHeader}><div><p>Chứng từ liên quan</p><h2>Quan hệ nguồn</h2></div></div><div className={styles.relationRows}><Row label="POS" value={sourceLabel(detail.sourceStatus.pos)} /><Row label="Hóa đơn" value={sourceLabel(detail.sourceStatus.invoice)} /><Row label="Lịch hẹn" value={sourceLabel(detail.sourceStatus.appointment)} /><Row label="Cash session" value={sourceLabel(detail.sourceStatus.cashSession)} /></div></div><div className={styles.railCard}><div className={styles.railHeader}><div><p>Quyết định đối soát</p><h2>{STATE_LABEL[detail.review.state] ?? detail.review.state}</h2></div><Badge tone={detail.capabilities.canReview ? "success" : "neutral"}>{detail.capabilities.canReview ? "Có quyền xử lý" : "Chỉ đọc"}</Badge></div>{detail.capabilities.canReview ? <><label className={styles.radio}><input type="radio" name="decision" checked={decisionChoice === "KEEP_REVIEW"} onChange={() => { setDecisionChoice("KEEP_REVIEW"); void saveDecision("KEEP_REVIEW"); }} /> Giữ trạng thái cần kiểm tra</label>{detail.capabilities.canConfirmMatch && <label className={styles.radio}><input type="radio" name="decision" checked={decisionChoice === "CONFIRM_MATCH"} onChange={() => { setDecisionChoice("CONFIRM_MATCH"); void saveDecision("CONFIRM_MATCH"); }} /> Xác nhận khớp chính xác</label>}{detail.capabilities.canAcceptVariance && <><label className={styles.radio}><input type="radio" name="decision" checked={decisionChoice === "ACCEPT_VARIANCE"} onChange={() => { setDecisionChoice("ACCEPT_VARIANCE"); void saveDecision("ACCEPT_VARIANCE"); }} /> Chấp nhận chênh lệch</label><select className={styles.fullInput} value={reason} onChange={(event) => setReason(event.target.value)}><option value="">Chọn nguyên nhân</option><option value="COUNTING_ERROR">Sai lệch kiểm đếm</option><option value="PROVIDER_INVESTIGATION">Chờ xác minh provider</option><option value="DOCUMENT_RECOVERY">Đang bổ sung chứng từ</option></select></>}{detail.capabilities.canEscalate && <button className={styles.outlineButton} onClick={() => void saveDecision("ESCALATE")} disabled={saving}>Chuyển cho quản lý</button>}<label className={styles.textLabel}>Ghi chú quyết định<textarea value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder="Ghi chú giải thích nếu cần..." /></label></> : <p className={styles.readonlyHint}>Bạn không có quyền ghi quyết định đối soát.</p>}</div><div className={styles.railCard}><div className={styles.railHeader}><div><p>Ghi chú</p><h2>Ghi chú nội bộ</h2></div></div><textarea className={styles.noteArea} value={note} onChange={(event) => setNote(event.target.value)} placeholder={detail.review.note ?? "Nhập ghi chú đối soát..."} /><button className={styles.primaryWide} onClick={() => void saveNote()} disabled={!canReview || !note.trim() || saving}>Lưu ghi chú</button></div><div className={styles.railCard}><div className={styles.railHeader}><div><p>Lịch sử đối soát</p><h2>Audit timeline</h2></div></div><div className={styles.timeline}>{detail.history.map((event, index) => <div key={`${event.eventType}-${index}`}><i /><span><b>{event.label}</b><small>{dateTime(event.occurredAt, detail.payment.timezone)} · {event.actor ?? "Hệ thống"}</small>{event.note && <em>{event.note}</em>}</span></div>)}</div></div></>}</aside></div>
  </main>;
}

function Kpi({ icon, tone, label, value, detail }: { icon: ReactNode; tone: string; label: string; value: ReactNode; detail: ReactNode }) { return <article className={styles.kpi}><IconCircle tone={tone}>{icon}</IconCircle><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>; }
function Metric({ label, value, tone }: { label: string; value: ReactNode; tone: string }) { return <div className={styles.metric}><span>{label}</span><strong className={styles[`text_${tone}`]}>{value}</strong></div>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className={styles.field}><span>{label}</span>{children}</label>; }
function InfoCard({ title, children }: { title: string; children: ReactNode }) { return <article className={styles.infoCard}><h3>{title}</h3>{children}</article>; }
function Amount({ label, value, currency }: { label: string; value: number | null; currency: string }) { return <div><span>{label}</span><strong>{money(value, currency)}</strong></div>; }
function Row({ label, value }: { label: string; value: ReactNode }) { return <div className={styles.row}><span>{label}</span><strong>{value}</strong></div>; }

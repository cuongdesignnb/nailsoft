/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { authorizedFetch, getActiveBranchId, getAuthContext, getAuthorizedBranchContext } from "../auth";
import styles from "./invoice-directory-page.module.css";

type InvoiceItem = {
  id: string; orderId: string; orderNumber: string; appointmentId?: string | null; bookingReference?: string | null;
  branchId: string; branchName: string; branchCode?: string | null; customerId?: string | null;
  customerDisplayName: string; customerPhone?: string | null; invoiceNumber?: string | null; draftReference?: string | null;
  invoiceStatus: string; currency: string; subtotalMinor: number; discountMinor: number; taxableMinor: number;
  taxMinor: number; totalMinor: number; tipMinor: number; grandTotalMinor: number; paidMinor: number; outstandingMinor: number;
  paymentState: "PAID" | "PARTIAL" | "OUTSTANDING"; businessState: string; refundAmountMinor: number; refundCount: number;
  latestRefundId?: string | null; latestRefundReference?: string | null; latestRefundStatus?: string | null;
  creditNoteAmountMinor: number; creditNoteCount: number; latestCreditNoteId?: string | null;
  latestCreditNoteNumber?: string | null; latestCreditNoteStatus?: string | null; hasRefund: boolean; hasCreditNote: boolean;
  issuedAt?: string | null; createdAt: string; paymentMethods: string[]; latestDeliveryStatus?: string | null;
  latestDeliveryAt?: string | null; orderStatus: string; timezone?: string | null; version: number;
};
type Directory = {
  items: InvoiceItem[]; pagination: { page: number; pageSize: number; total: number; totalPages: number };
  counts: { total: number; issued: number; paid: number; outstanding: number; withRefund: number; withCreditNote: number };
  periodSummary: { invoiceValueMinor: number; paidMinor: number; outstandingMinor: number; adjustedInvoiceCount: number; paidPercentage: number };
};
type Branch = { id: string; name: string; status?: string };
type Detail = InvoiceItem & { customerSnapshot?: any; branchSnapshot?: any; lines?: any[]; tenders?: any[]; deliveries?: any[]; taxSnapshot?: any };
type AuthContext = Awaited<ReturnType<typeof getAuthContext>>;
type Filters = { branchId: string; search: string; invoiceStatus: string; paymentState: string; correction: string; customerId: string; source: string; issuedFrom: string; issuedTo: string; sort: string; page: number; pageSize: number };

const EMPTY_FILTERS: Filters = { branchId: "", search: "", invoiceStatus: "", paymentState: "", correction: "", customerId: "", source: "", issuedFrom: "", issuedTo: "", sort: "NEWEST", page: 1, pageSize: 10 };
const PAYMENT_FILTERS = [["", "Tất cả"], ["PAID", "Đã thanh toán"], ["PARTIAL", "Thanh toán một phần"], ["OUTSTANDING", "Còn phải thu"]] as const;
const CORRECTION_FILTERS = [["", "Không lọc điều chỉnh"], ["REFUND", "Có hoàn tiền"], ["CREDIT_NOTE", "Có credit note"], ["NONE", "Không điều chỉnh"]] as const;

function readFilters(): Filters {
  if (typeof window === "undefined") return EMPTY_FILTERS;
  const params = new URLSearchParams(window.location.search);
  const page = Number(params.get("page"));
  const pageSize = Number(params.get("pageSize"));
  return { ...EMPTY_FILTERS, branchId: params.get("branchId") ?? getActiveBranchId() ?? "", search: params.get("search") ?? "", invoiceStatus: params.get("invoiceStatus") ?? "", paymentState: params.get("paymentState") ?? "", correction: params.get("correction") ?? "", customerId: params.get("customerId") ?? "", source: params.get("source") ?? "", issuedFrom: params.get("issuedFrom") ?? "", issuedTo: params.get("issuedTo") ?? "", sort: params.get("sort") ?? "NEWEST", page: Number.isInteger(page) && page > 0 ? page : 1, pageSize: [10, 20, 50, 100].includes(pageSize) ? pageSize : 10 };
}
function readRequestedInvoiceId() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("invoiceId") ?? "";
}
function toQuery(filters: Filters, includePaging = true) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (!includePaging && (key === "page" || key === "pageSize")) return;
    if (value !== "" && value !== undefined) params.set(key, String(value));
  });
  return params.toString();
}
function money(value: number | null | undefined, currency = "VND") { return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value ?? 0); }
function dateTime(value?: string | null, timezone?: string | null) { if (!value) return "—"; return new Intl.DateTimeFormat("vi-VN", { timeZone: timezone || undefined, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function unwrap(body: any) { return body?.data; }
async function json(path: string, init?: RequestInit) { const response = await authorizedFetch(path, init); const body = await response.json().catch(() => ({})); if (!response.ok) throw Object.assign(new Error(body?.error?.message ?? "Không thể tải dữ liệu."), { status: response.status }); return unwrap(body); }
function statusLabel(item: InvoiceItem): [string, string] { if (item.businessState === "PAID") return ["Đã thanh toán", "green"]; if (item.businessState === "PARTIAL") return ["Thanh toán một phần", "purple"]; if (item.businessState === "OUTSTANDING") return ["Còn phải thu", "amber"]; if (item.businessState === "REFUNDED") return ["Hoàn tiền", "rose"]; if (item.businessState === "REFUND_PARTIAL") return ["Hoàn tiền một phần", "rose"]; if (item.businessState === "CREDIT_NOTE") return ["Đã điều chỉnh", "purple"]; return ["Đã hủy", "gray"]; }
function invoiceLabel(item: InvoiceItem) { return item.invoiceNumber ?? "Chưa phát hành"; }
function hasPermission(context: AuthContext | undefined, permission: string) { const permissions = context?.supportAccess?.permissions ?? context?.authorization.permissions ?? []; return permissions.includes(permission); }

function Badge({ kind, children }: { kind: string; children: ReactNode }) { const normalized = kind ? `${kind[0]!.toUpperCase()}${kind.slice(1)}` : "Gray"; return <span className={`${styles.badge} ${styles[`badge${normalized}`] ?? styles.badgeGray}`}>{children}</span>; }
function Kpi({ icon, label, value, meta }: { icon: string; label: string; value: string; meta: string }) { return <div className={styles.kpi}><div className={styles.kpiIcon}>{icon}</div><div><div className={styles.kpiLabel}>{label}</div><div className={styles.kpiValue}>{value}</div><div className={styles.kpiMeta}>{meta}</div></div></div>; }

function Inspector({ item, detail, loading, context, onDeliver, deliveryBusy }: { item: InvoiceItem | undefined; detail: Detail | undefined; loading: boolean; context: AuthContext | undefined; onDeliver: () => void; deliveryBusy: boolean }) {
  if (!item) return <aside className={styles.inspector}><div className={`${styles.card} ${styles.inspectorCard}`}><div className={styles.empty}><strong>Chọn một hóa đơn</strong><p>Chọn một dòng trong danh sách để xem snapshot và chứng từ liên quan.</p></div></div></aside>;
  const branch = detail?.branchSnapshot ?? {};
  const paymentStatus = item.paymentState === "PAID" ? "Đã thanh toán" : item.paymentState === "PARTIAL" ? "Thanh toán một phần" : "Còn phải thu";
  const deliveryStatus = item.latestDeliveryStatus;
  return <aside className={styles.inspector}>
    <div className={`${styles.card} ${styles.inspectorCard}`}>
      <div className={styles.inspectorHeader}><div><h2 className={styles.inspectorTitle}>Chi tiết hóa đơn</h2><div className={styles.inspectorSub}>{invoiceLabel(item)} · {item.invoiceNumber ? "InvoiceView" : "DRAFT do POS tạo"}</div></div><Badge kind={item.invoiceStatus === "ISSUED" ? "green" : "amber"}>{item.invoiceStatus === "ISSUED" ? "Đã phát hành" : "Chưa phát hành"}</Badge></div>
      <div className={styles.customer}><div className={styles.avatar}>{item.customerDisplayName.slice(0, 1).toUpperCase()}</div><div><div className={styles.customerName}>{item.customerDisplayName}</div><div className={styles.customerMeta}>{item.customerPhone ?? "Thông tin liên hệ được giới hạn"}</div></div></div>
      <div className={styles.keyValue}><span>Ngày phát hành</span><strong>{item.issuedAt ? dateTime(item.issuedAt, item.timezone) : "Chưa phát hành"}</strong></div>
      <div className={styles.keyValue}><span>Chi nhánh</span><strong>{branch.name ?? item.branchName}</strong></div>
      <div className={styles.keyValue}><span>Nguồn</span><strong>{item.appointmentId ? "Lịch hẹn" : "POS / Bán hàng"}</strong></div>
      <div className={styles.keyValue}><span>Trạng thái thanh toán</span><strong>{paymentStatus}</strong></div>
      {loading ? <div className={styles.skeleton} /> : null}
    </div>
    <div className={`${styles.card} ${styles.inspectorCard}`}>
      <h2 className={styles.sectionTitle}>Giá trị hóa đơn</h2>
      <div className={styles.keyValue}><span>Tạm tính</span><strong>{money(item.subtotalMinor, item.currency)}</strong></div>
      <div className={styles.keyValue}><span>Giảm giá</span><strong className={styles.muted}>-{money(item.discountMinor, item.currency)}</strong></div>
      <div className={styles.keyValue}><span>Thuế</span><strong>{money(item.taxMinor, item.currency)}</strong></div>
      <div className={styles.keyValue}><span>Tip</span><strong>{money(item.tipMinor, item.currency)}</strong></div>
      <div className={styles.totalLine}><span>Tổng cộng</span><strong>{money(item.grandTotalMinor, item.currency)}</strong></div>
      <div className={styles.keyValue}><span>Đã thanh toán</span><strong className={styles.muted}>{money(item.paidMinor, item.currency)}</strong></div>
      <div className={styles.keyValue}><span>Còn phải thu</span><strong>{money(item.outstandingMinor, item.currency)}</strong></div>
      {item.hasRefund ? <div className={styles.keyValue}><span>Đã hoàn tiền</span><strong>{money(item.refundAmountMinor, item.currency)}</strong></div> : null}
      {item.hasCreditNote ? <div className={styles.keyValue}><span>Credit note</span><strong>{money(item.creditNoteAmountMinor, item.currency)}</strong></div> : null}
    </div>
    <div className={`${styles.card} ${styles.inspectorCard}`}>
      <h2 className={styles.sectionTitle}>Chứng từ liên quan</h2>
      <div className={styles.linkList}>
        <Link className={styles.link} href={`/admin/pos/orders/${item.orderId}`}>Đơn POS <span>→</span></Link>
        {item.appointmentId ? <Link className={styles.link} href={`/admin/appointments/${item.appointmentId}/overview`}>Lịch hẹn <span>→</span></Link> : null}
        {item.latestRefundId ? <Link className={styles.link} href={`/admin/refunds/${item.latestRefundId}`}>Refund · {item.latestRefundReference ?? "xem chi tiết"} <span>→</span></Link> : null}
        {item.latestCreditNoteId ? <Link className={styles.link} href={`/admin/credit-notes/${item.latestCreditNoteId}`}>Credit note · {item.latestCreditNoteNumber ?? "xem chi tiết"} <span>→</span></Link> : null}
      </div>
    </div>
    <div className={`${styles.card} ${styles.inspectorCard}`}>
      <div className={styles.inspectorHeader}><h2 className={styles.sectionTitle}>Thanh toán & giao chứng từ</h2><Badge kind={item.paymentState === "PAID" ? "green" : "amber"}>{paymentStatus}</Badge></div>
      {detail?.tenders?.length ? detail.tenders.map((tender: any) => <div className={styles.deliveryRow} key={tender.id}><span>{tender.tenderType === "CASH" ? "Tiền mặt" : tender.tenderType === "BANK_TRANSFER" ? "Chuyển khoản" : tender.tenderType === "CARD_EXTERNAL" ? "Thẻ" : "Khác"}</span><strong>{money(Number(tender.capturedMinor ?? 0), item.currency)}</strong></div>) : <div className={styles.noData}>Chưa có tender đã capture.</div>}
      {detail?.deliveries?.map((delivery: any) => <div className={styles.deliveryRow} key={delivery.id}><span>{delivery.channel} · {dateTime(delivery.created_at)}</span><Badge kind={delivery.status === "PENDING" ? "amber" : delivery.status === "DISABLED" ? "gray" : delivery.status === "SENT" ? "green" : "rose"}>{delivery.status}</Badge></div>)}
      <div className={styles.buttonRow} style={{ marginTop: 10 }}>
        {item.invoiceStatus === "ISSUED" ? <Link className={styles.button} href={`/admin/pos/orders/${item.orderId}/receipt`} target="_blank">In / Lưu PDF</Link> : <button className={styles.button} disabled title="Chỉ invoice ISSUED mới được in">In / Lưu PDF</button>}
        {item.invoiceStatus === "ISSUED" && hasPermission(context, "invoice.deliver") ? <button className={`${styles.button} ${styles.buttonPrimary}`} onClick={onDeliver} disabled={deliveryBusy}>{deliveryBusy ? "Đang gửi…" : deliveryStatus === "PENDING" ? "Gửi lại email" : "Gửi email"}</button> : null}
      </div>
      <div className={styles.footerNote}>Delivery status là trạng thái thật từ backend; PENDING/DISABLED không được hiển thị thành “Đã gửi”.</div>
    </div>
    <div className={`${styles.card} ${styles.inspectorCard}`}>
      <h2 className={styles.sectionTitle}>Thao tác nghiệp vụ</h2>
      <div className={styles.actionGrid}>
        {item.invoiceStatus === "ISSUED" && hasPermission(context, "refund.request") ? <Link className={`${styles.button} ${styles.buttonDanger}`} href={`/admin/refunds/new?invoiceId=${item.id}`}>Yêu cầu hoàn tiền</Link> : null}
        {item.latestCreditNoteId ? <Link className={styles.button} href={`/admin/credit-notes/${item.latestCreditNoteId}`}>Mở credit note</Link> : null}
        <Link className={styles.button} href={`/admin/pos/orders/${item.orderId}`}>Mở đơn POS</Link>
      </div>
    </div>
  </aside>;
}

export default function InvoiceDirectoryPage() {
  const [filters, setFilters] = useState<Filters>(readFilters);
  const [requestedInvoiceId, setRequestedInvoiceId] = useState(readRequestedInvoiceId);
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [context, setContext] = useState<AuthContext>();
  const [directory, setDirectory] = useState<Directory>();
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<Detail>();
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerOptions, setCustomerOptions] = useState<Array<{ id: string; displayName: string; phone?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    const refreshContext = async () => { try { const result = await getAuthorizedBranchContext(); setContext(result.context); setBranches(result.branches); if (!filters.branchId && result.branchId) setFilters((value) => ({ ...value, branchId: result.branchId ?? "", page: 1 })); } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể tải thông tin chi nhánh."); } };
    void refreshContext();
    const onBranch = (event: Event) => setFilters((value) => ({ ...value, branchId: (event as CustomEvent<string | undefined>).detail ?? "", page: 1 }));
    window.addEventListener("nailsoft:active-branch-change", onBranch);
    const onPop = () => { const next = readFilters(); setFilters(next); setSearchDraft(next.search); setRequestedInvoiceId(readRequestedInvoiceId()); };
    window.addEventListener("popstate", onPop);
    return () => { window.removeEventListener("nailsoft:active-branch-change", onBranch); window.removeEventListener("popstate", onPop); };
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => setFilters((value) => ({ ...value, search: searchDraft.trim(), page: 1 })), 300); return () => window.clearTimeout(timer); }, [searchDraft]);
  useEffect(() => { const params = new URLSearchParams(toQuery(filters)); if (requestedInvoiceId) params.set("invoiceId", requestedInvoiceId); const query = params.toString(); const next = `${window.location.pathname}${query ? `?${query}` : ""}`; if (`${window.location.pathname}${window.location.search}` !== next) window.history.replaceState(null, "", next); }, [filters, requestedInvoiceId]);
  const directoryPath = useMemo(() => { const query = toQuery(filters); return `/v1/invoices/directory${query ? `?${query}` : ""}`; }, [filters]);
  useEffect(() => {
    let active = true; const controller = new AbortController(); setLoading(true); setError("");
    void json(directoryPath, { signal: controller.signal }).then((value) => {
      if (!active) return;
      const next = value as Directory;
      setDirectory(next);
      if (requestedInvoiceId) {
        const requested = next.items.find((item) => item.id === requestedInvoiceId);
        setSelectedId(requested?.id);
        if (!requested) setError("Không tìm thấy đúng hóa đơn được yêu cầu trong chi nhánh và bộ lọc hiện tại.");
        return;
      }
      setSelectedId((current) => current && next.items.some((item) => item.id === current) ? current : next.items[0]?.id);
    }).catch((reason: any) => { if (active && reason?.name !== "AbortError") setError(reason instanceof Error ? reason.message : "Không thể tải danh sách hóa đơn."); }).finally(() => active && setLoading(false));
    return () => { active = false; controller.abort(); };
  }, [directoryPath, requestedInvoiceId]);
  useEffect(() => {
    if (!selectedId) { setDetail(undefined); return; }
    let active = true; const controller = new AbortController(); setDetailLoading(true); setDetailError("");
    void json(`/v1/invoices/${selectedId}`, { signal: controller.signal }).then((value) => active && setDetail(value as Detail)).catch((reason: any) => { if (active && reason?.name !== "AbortError") setDetailError(reason instanceof Error ? reason.message : "Không thể tải chi tiết hóa đơn."); }).finally(() => active && setDetailLoading(false));
    return () => { active = false; controller.abort(); };
  }, [selectedId]);
  useEffect(() => {
    if (customerSearch.trim().length < 2) { setCustomerOptions([]); return; }
    const timer = window.setTimeout(() => { let active = true; setCustomerLoading(true); void json(`/v1/customers?search=${encodeURIComponent(customerSearch.trim())}&limit=20`).then((value: any) => { if (active) setCustomerOptions(Array.isArray(value) ? value : value?.items ?? []); }).catch(() => active && setCustomerOptions([])).finally(() => active && setCustomerLoading(false)); return () => { active = false; }; }, 300);
    return () => window.clearTimeout(timer);
  }, [customerSearch]);
  const update = (key: keyof Filters, value: string | number) => setFilters((current) => ({ ...current, [key]: value, ...(key === "pageSize" || key === "sort" ? { page: 1 } : {}) }));
  const selectInvoice = (id: string) => { setRequestedInvoiceId(id); setSelectedId(id); };
  const selectCustomer = (customer: any) => { update("customerId", customer.id); setCustomerSearch(customer.displayName ?? customer.name ?? ""); setCustomerOptions([]); };
  const refresh = () => setFilters((value) => ({ ...value }));
  const exportCsv = async () => { try { const response = await authorizedFetch(`/v1/invoices/export?${toQuery(filters, false)}`); if (!response.ok) throw new Error("Không thể xuất dữ liệu hóa đơn."); const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "invoices.csv"; anchor.click(); URL.revokeObjectURL(url); } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể xuất dữ liệu hóa đơn."); } };
  const deliver = async () => { if (!selectedId || !detail) return; const email = detail.customerSnapshot?.email ?? detail.customerSnapshot?.emailAddress; if (!email) { setError("Snapshot hóa đơn không có email khách hàng để gửi chứng từ."); return; } setDeliveryBusy(true); setError(""); try { await json(`/v1/invoices/${selectedId}/deliver`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `invoice-delivery-${Date.now()}` }, body: JSON.stringify({ channel: "EMAIL", destination: email }) }); setDetail(undefined); refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể yêu cầu gửi hóa đơn."); } finally { setDeliveryBusy(false); } };
  const selected = directory?.items.find((item) => item.id === selectedId);
  const totalPages = directory?.pagination.totalPages ?? 1;
  const from = directory && directory.pagination.total ? (directory.pagination.page - 1) * directory.pagination.pageSize + 1 : 0;
  const to = directory ? Math.min(directory.pagination.page * directory.pagination.pageSize, directory.pagination.total) : 0;
  return <main className={styles.page}><div className={styles.content}>
    <div className={styles.header}><div><div className={styles.eyebrow}>Tài chính / Hóa đơn</div><h1 className={styles.title}>Hóa đơn</h1><p className={styles.subtitle}>Theo dõi hóa đơn đã phát hành, trạng thái thanh toán và chứng từ tài chính của giao dịch salon.</p></div><div className={styles.headerActions}><button className={styles.button} onClick={exportCsv} disabled={loading}>⇩ Xuất dữ liệu</button><button className={styles.button} onClick={refresh}>↻ Làm mới</button><Link className={`${styles.button} ${styles.buttonPrimary}`} href="/admin/pos/orders">Mở POS / Bán hàng</Link></div></div>
    {error ? <div className={styles.notice}><strong>Không thể hoàn tất thao tác.</strong><span>{error}</span><button className={styles.button} onClick={() => setError("")}>Đóng</button></div> : null}
    <section className={styles.kpis} aria-label="Chỉ số hóa đơn"><Kpi icon="▣" label="Tổng giá trị kỳ này" value={money(directory?.periodSummary.invoiceValueMinor)} meta={`${directory?.counts.total ?? 0} hóa đơn`} /><Kpi icon="✓" label="Đã thanh toán" value={money(directory?.periodSummary.paidMinor)} meta={`${directory?.counts.paid ?? 0} hóa đơn`} /><Kpi icon="◷" label="Còn phải thu" value={money(directory?.periodSummary.outstandingMinor)} meta={`${directory?.counts.outstanding ?? 0} hóa đơn`} /><Kpi icon="▤" label="Hóa đơn đã phát hành" value={String(directory?.counts.issued ?? 0)} meta="Lifecycle ISSUED" /><Kpi icon="◈" label="Chứng từ điều chỉnh" value={String(directory?.periodSummary.adjustedInvoiceCount ?? 0)} meta={`${directory?.counts.withRefund ?? 0} refund · ${directory?.counts.withCreditNote ?? 0} credit note`} /></section>
    <div className={styles.workspace}><div className={styles.mainColumn}>
      <section className={`${styles.card} ${styles.filters}`} aria-label="Bộ lọc hóa đơn"><div className={styles.filterGrid}><div className={`${styles.field} ${styles.customerLookup}`}><label htmlFor="invoice-search">Tìm hóa đơn / khách hàng / mã đơn POS / lịch hẹn</label><input id="invoice-search" className={styles.input} value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Nhập từ khóa tìm kiếm…" /></div><div className={styles.field}><label htmlFor="invoice-branch">Chi nhánh</label><select id="invoice-branch" className={styles.select} value={filters.branchId} onChange={(event) => update("branchId", event.target.value)}><option value="">Tất cả chi nhánh</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></div><div className={styles.field}><label htmlFor="invoice-status">Lifecycle hóa đơn</label><select id="invoice-status" className={styles.select} value={filters.invoiceStatus} onChange={(event) => update("invoiceStatus", event.target.value)}><option value="">Tất cả</option><option value="ISSUED">Đã phát hành</option><option value="DRAFT">Chưa phát hành</option><option value="VOIDED_BEFORE_PAYMENT">Đã void trước thanh toán</option></select></div><div className={styles.field}><label htmlFor="invoice-payment">Thanh toán</label><select id="invoice-payment" className={styles.select} value={filters.paymentState} onChange={(event) => update("paymentState", event.target.value)}>{PAYMENT_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className={styles.field}><label htmlFor="invoice-source">Nguồn</label><select id="invoice-source" className={styles.select} value={filters.source} onChange={(event) => update("source", event.target.value)}><option value="">Tất cả</option><option value="APPOINTMENT_POS">POS từ lịch hẹn</option><option value="OTHER_POS">POS khác</option></select></div><div className={styles.field}><label htmlFor="invoice-sort">Sắp xếp</label><select id="invoice-sort" className={styles.select} value={filters.sort} onChange={(event) => update("sort", event.target.value)}><option value="NEWEST">Mới nhất</option><option value="OLDEST">Cũ nhất</option><option value="TOTAL_DESC">Tổng tiền cao nhất</option><option value="OUTSTANDING_DESC">Còn phải thu cao nhất</option></select></div></div><div className={styles.filterLine}><div className={styles.chips}>{CORRECTION_FILTERS.map(([value, label]) => <button key={value} className={`${styles.chip} ${filters.correction === value ? styles.chipActive : ""}`} onClick={() => update("correction", value)}>{label}</button>)}</div><div className={styles.field}><label htmlFor="invoice-from">Từ ngày</label><input id="invoice-from" className={styles.dateInput} type="date" value={filters.issuedFrom} onChange={(event) => update("issuedFrom", event.target.value)} /></div><div className={styles.field}><label htmlFor="invoice-to">Đến ngày</label><input id="invoice-to" className={styles.dateInput} type="date" value={filters.issuedTo} onChange={(event) => update("issuedTo", event.target.value)} /></div><button className={styles.button} onClick={() => setFilters((value) => ({ ...value, customerId: "" }))}>Xóa khách hàng</button></div><div className={styles.filterLine}><div className={styles.field} style={{ minWidth: 260 }}><label htmlFor="invoice-customer">Lọc theo khách hàng (tra cứu server)</label><input id="invoice-customer" className={styles.input} value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Tên hoặc số điện thoại…" />{customerSearch.length >= 2 && (customerLoading || customerOptions.length > 0) ? <div className={styles.customerMenu}>{customerLoading ? <div className={styles.customerOption}>Đang tra cứu…</div> : customerOptions.map((customer) => <button className={styles.customerOption} key={customer.id} onClick={() => selectCustomer(customer)}><strong>{customer.displayName}</strong><small>{customer.phone ?? ""}</small></button>)}</div> : null}</div>{filters.customerId ? <Badge kind="green">Đang lọc customerId</Badge> : null}<span className={styles.tableMeta}>Số liệu lấy từ invoice directory read model; không tạo hóa đơn thủ công.</span></div></section>
      {loading ? <section className={`${styles.card} ${styles.tableCard}`}><div className={styles.tableHeader}><div className={styles.skeleton} style={{ width: 180 }} /><div className={styles.skeleton} style={{ width: 100 }} /></div><div className={styles.tableWrap}><table className={styles.table}><tbody>{Array.from({ length: 6 }, (_, index) => <tr key={index}>{Array.from({ length: 11 }, (_, cell) => <td key={cell}><div className={styles.skeleton} /></td>)}</tr>)}</tbody></table></div></section> : error && !directory ? <section className={`${styles.card} ${styles.error}`}><strong>Không thể tải danh sách hóa đơn</strong><p>{error}</p><button className={styles.button} onClick={refresh}>Thử lại</button></section> : <section className={`${styles.card} ${styles.tableCard}`}><div className={styles.tableHeader}><div><h2 className={styles.sectionTitle}>Danh sách hóa đơn</h2><div className={styles.tableMeta}>{directory?.pagination.total ?? 0} hóa đơn trong bộ lọc hiện tại</div></div><span className={styles.tableMeta}>Trạng thái bảng được derive từ POS payment, refund và credit note</span></div>{directory?.items.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr>{["Số hóa đơn", "Ngày phát hành", "Khách hàng", "Nguồn", "Chi nhánh", "Tạm tính", "Thuế", "Tổng tiền", "Đã thanh toán", "Trạng thái", "Thao tác"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{directory.items.map((item) => { const [label, kind] = statusLabel(item); return <tr key={item.id} className={item.id === selectedId ? styles.selected : ""} onClick={() => selectInvoice(item.id)} aria-selected={item.id === selectedId}><td><span className={styles.strong}>{invoiceLabel(item)}</span><span className={styles.small}>{item.invoiceNumber ? item.orderNumber : `POS ${item.orderNumber}`}</span></td><td>{item.issuedAt ? dateTime(item.issuedAt, item.timezone) : <span className={styles.muted}>Chưa phát hành</span>}</td><td><span className={styles.strong}>{item.customerDisplayName}</span>{item.customerPhone ? <span className={styles.small}>{item.customerPhone}</span> : null}</td><td>{item.appointmentId ? <Badge kind="rose">Lịch hẹn</Badge> : <Badge kind="gray">POS khác</Badge>}</td><td>{item.branchName}<span className={styles.small}>{item.branchCode ?? ""}</span></td><td className={styles.money}>{money(item.subtotalMinor, item.currency)}</td><td className={styles.money}>{money(item.taxMinor, item.currency)}</td><td className={`${styles.money} ${styles.strong}`}>{money(item.grandTotalMinor, item.currency)}</td><td className={styles.money}>{money(item.paidMinor, item.currency)}{item.outstandingMinor > 0 ? <span className={styles.small}>Còn {money(item.outstandingMinor, item.currency)}</span> : null}</td><td><Badge kind={kind}>{label}</Badge>{item.invoiceStatus !== "ISSUED" ? <span className={styles.small}>DRAFT của POS</span> : null}</td><td><div className={styles.rowActions} onClick={(event) => event.stopPropagation()}><button className={styles.iconButton} title="Xem chi tiết" onClick={() => selectInvoice(item.id)}>◉</button><Link className={styles.iconButton} href={`/admin/pos/orders/${item.orderId}/receipt`} target="_blank" aria-disabled={item.invoiceStatus !== "ISSUED"} onClick={(event) => { if (item.invoiceStatus !== "ISSUED") event.preventDefault(); }}>▣</Link></div></td></tr>; })}</tbody></table></div> : <div className={styles.empty}><strong>Không có hóa đơn phù hợp</strong><p>Không có bản ghi nào phù hợp với bộ lọc hiện tại. Hóa đơn được tạo tự động từ POS.</p><button className={styles.button} onClick={() => setFilters({ ...EMPTY_FILTERS, branchId: filters.branchId })}>Xóa bộ lọc</button></div>}<div className={styles.pagination}><span>Hiển thị {from}–{to} trong {directory?.pagination.total ?? 0} hóa đơn</span><div className={styles.paginationControls}><button className={styles.pageButton} disabled={filters.page <= 1} onClick={() => update("page", filters.page - 1)}>‹</button>{Array.from({ length: Math.min(5, totalPages) }, (_, index) => { const page = Math.min(Math.max(1, filters.page - 2) + index, totalPages); return <button key={page} className={`${styles.pageButton} ${filters.page === page ? styles.pageButtonActive : ""}`} onClick={() => update("page", page)}>{page}</button>; })}<button className={styles.pageButton} disabled={filters.page >= totalPages} onClick={() => update("page", filters.page + 1)}>›</button><select className={styles.select} style={{ width: 90, minHeight: 30 }} value={filters.pageSize} onChange={(event) => update("pageSize", Number(event.target.value))}><option value={10}>10 / trang</option><option value={20}>20 / trang</option><option value={50}>50 / trang</option><option value={100}>100 / trang</option></select></div></div></section>}
      <section className={styles.summaryGrid}><div className={`${styles.card} ${styles.summary}`}><div className={styles.summaryLabel}>Tổng kỳ hiện tại</div><div className={styles.summaryValue}>{money(directory?.periodSummary.invoiceValueMinor)}</div></div><div className={`${styles.card} ${styles.summary}`}><div className={styles.summaryLabel}>Đã thu</div><div className={styles.summaryValue}>{money(directory?.periodSummary.paidMinor)}</div><div className={styles.summaryBar}><span style={{ width: `${Math.min(100, directory?.periodSummary.paidPercentage ?? 0)}%` }} /></div></div><div className={`${styles.card} ${styles.summary}`}><div className={styles.summaryLabel}>Còn phải thu</div><div className={styles.summaryValue}>{money(directory?.periodSummary.outstandingMinor)}</div></div><div className={`${styles.card} ${styles.summary}`}><div className={styles.summaryLabel}>Chứng từ điều chỉnh</div><div className={styles.summaryValue}>{directory?.periodSummary.adjustedInvoiceCount ?? 0}</div></div></section>
    </div><Inspector item={selected} detail={detail} loading={detailLoading} context={context} onDeliver={deliver} deliveryBusy={deliveryBusy} /></div>
    {detailError ? <div className={styles.notice} style={{ marginTop: 12 }}><strong>Inspector chưa tải được.</strong><span>{detailError}</span><button className={styles.button} onClick={() => setSelectedId(selectedId)}>Thử lại</button></div> : null}
    <section className={`${styles.card} ${styles.inspectorCard}`} style={{ marginTop: 14 }}><div className={styles.inspectorHeader}><div><h2 className={styles.sectionTitle}>Luồng chứng từ</h2><div className={styles.inspectorSub}>Các bước dưới đây là liên kết thật của domain; không ghi đè invoice.status để giả lập refund/credit note.</div></div></div><div className={styles.flow}>{["Lịch hẹn", "Đơn POS", "Thanh toán", "Hóa đơn", "Biên nhận"].map((step, index) => <div className={`${styles.flowStep} ${index < (selected?.invoiceStatus === "ISSUED" ? 5 : 3) ? styles.flowStepDone : ""}`} key={step}>{step}</div>)}</div></section>
  </div></main>;
}

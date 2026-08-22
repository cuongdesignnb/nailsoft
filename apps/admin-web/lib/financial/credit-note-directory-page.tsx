/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Icon as UiIcon } from "@nailsoft/ui-web";
import {
  authorizedFetch,
  getActiveBranchId,
  getAuthorizedBranchContext,
  getAuthContext,
} from "../auth";
import styles from "./invoice-directory-page.module.css";

type CreditNoteItem = {
  id: string;
  branchId: string;
  branchName: string;
  branchCode?: string | null;
  branchTimezone?: string | null;
  refundId: string;
  refundReference: string;
  refundStatus: string;
  refundKind: "FULL" | "PARTIAL" | "TIP_ONLY" | "MIXED";
  originalInvoiceId: string;
  invoiceNumber?: string | null;
  invoiceStatus: string;
  creditNoteNumber: string;
  status: "DRAFT" | "ISSUED";
  currency: string;
  customerDisplayName: string;
  customerPhone?: string | null;
  issuerDisplayName?: string | null;
  grossMinor: number;
  discountReversalMinor: number;
  taxableMinor: number;
  taxMinor: number;
  tipMinor: number;
  totalMinor: number;
  originalInvoiceGrandTotalMinor: number;
  cumulativeAdjustmentMinor: number;
  adjustedInvoiceValueMinor: number;
  adjustmentCountForInvoice: number;
  customerSnapshot?: any;
  branchSnapshot?: any;
  originalInvoiceSnapshot?: any;
  issuedAt?: string | null;
  createdAt: string;
  version: number;
  deliveryStatusSupported: boolean;
  latestDeliveryState?: "PENDING" | null;
  latestDeliveryChannel?: string | null;
  latestDeliveryAt?: string | null;
};

type Directory = {
  items: CreditNoteItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  counts: {
    total: number;
    issued: number;
    drafts: number;
    adjustedInvoiceCount: number;
    totalAdjustmentMinor: number;
    deliverySupported: boolean;
    deliveryRequestedCount: number;
  };
};
type Detail = CreditNoteItem & {
  lines?: any[];
  context?: {
    issuer?: { id?: string; displayName?: string } | null;
    branch?: { id?: string; name?: string; code?: string; timezone?: string };
    customer?: any;
    invoice?: {
      id: string;
      number?: string | null;
      status: string;
      snapshot?: any;
      originalGrandTotalMinor: number;
      cumulativeAdjustmentMinor: number;
      adjustedInvoiceValueMinor: number;
    };
    refund?: {
      id: string;
      reference: string;
      status: string;
      requestedMinor: number;
      approvedMinor: number;
      completedMinor: number;
      reasonCode?: string;
      reasonText?: string;
      completedAt?: string | null;
      allocations?: Array<{ tenderType: string; completedMinor: number; status: string }>;
    };
    delivery?: {
      supported: boolean;
      latestState?: string | null;
      latestChannel?: string | null;
      requestedAt?: string | null;
      note: string;
    };
    history?: Array<{
      event: string;
      occurredAt: string;
      actorDisplayName?: string | null;
      payload?: any;
    }>;
  };
};
type Branch = { id: string; name: string; status?: string };
type AuthContext = Awaited<ReturnType<typeof getAuthContext>>;
type Filters = {
  branchId: string;
  search: string;
  status: string;
  refundKind: string;
  issuedFrom: string;
  issuedTo: string;
  sort: string;
  page: number;
  pageSize: number;
};

const EMPTY_FILTERS: Filters = {
  branchId: "",
  search: "",
  status: "",
  refundKind: "",
  issuedFrom: "",
  issuedTo: "",
  sort: "NEWEST",
  page: 1,
  pageSize: 10,
};

function readFilters(): Filters {
  if (typeof window === "undefined") return EMPTY_FILTERS;
  const params = new URLSearchParams(window.location.search);
  const page = Number(params.get("page"));
  const pageSize = Number(params.get("pageSize"));
  return {
    ...EMPTY_FILTERS,
    branchId: params.get("branchId") ?? getActiveBranchId() ?? "",
    search: params.get("search") ?? "",
    status: params.get("status") ?? "",
    refundKind: params.get("refundKind") ?? "",
    issuedFrom: params.get("issuedFrom") ?? "",
    issuedTo: params.get("issuedTo") ?? "",
    sort: params.get("sort") ?? "NEWEST",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: [10, 20, 50, 100].includes(pageSize) ? pageSize : 10,
  };
}
function readRequestedCreditNoteId() {
  if (typeof window === "undefined") return "";
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[0] === "admin" && parts[1] === "credit-notes" && parts[2] ? parts[2] : "";
}

function toQuery(filters: Filters, includePaging = true) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (!includePaging && (key === "page" || key === "pageSize")) return;
    if (value !== "" && value !== undefined) params.set(key, String(value));
  });
  return params.toString();
}
function unwrap(body: any) { return body?.data; }
function money(value: number | null | undefined, currency = "VND") {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value ?? 0);
}
function dateTime(value?: string | null, timezone?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", { timeZone: timezone || undefined, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
async function json(path: string, init?: RequestInit) {
  const response = await authorizedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body?.error?.message ?? "Không thể tải dữ liệu."), { status: response.status });
  return unwrap(body);
}
function hasPermission(context: AuthContext | undefined, permission: string) {
  const permissions = context?.supportAccess?.permissions ?? context?.authorization.permissions ?? [];
  return permissions.includes(permission);
}
function Badge({ kind, children }: { kind: string; children: ReactNode }) {
  const normalized = kind ? `${kind[0]!.toUpperCase()}${kind.slice(1)}` : "Gray";
  return <span className={`${styles.badge} ${styles[`badge${normalized}`] ?? styles.badgeGray}`}>{children}</span>;
}
function kindLabel(kind: CreditNoteItem["refundKind"]) {
  return { FULL: "Hoàn toàn", PARTIAL: "Hoàn một phần", TIP_ONLY: "Hoàn tip", MIXED: "Hoàn hỗn hợp" }[kind];
}

function Inspector({
  item,
  detail,
  loading,
  context,
  onDeliver,
  deliveryBusy,
  onPrint,
}: {
  item: CreditNoteItem | undefined;
  detail: Detail | undefined;
  loading: boolean;
  context: AuthContext | undefined;
  onDeliver: (channel: "EMAIL" | "PRINT") => void;
  deliveryBusy: boolean;
  onPrint: () => void;
}) {
  if (!item) return <aside className={styles.inspector}><div className={`${styles.card} ${styles.inspectorCard}`}><div className={styles.empty}><strong>Chọn một chứng từ điều chỉnh</strong><p>Chọn một dòng để xem snapshot lịch sử, refund nguồn và giá trị điều chỉnh lũy kế.</p></div></div></aside>;
  const contextData = detail?.context;
  const delivery = contextData?.delivery;
  const customer = contextData?.customer ?? item.customerSnapshot ?? {};
  return <aside className={styles.inspector}>
    <div className={`${styles.card} ${styles.inspectorCard}`}>
      <div className={styles.inspectorHeader}><div><h2 className={styles.inspectorTitle}>Chi tiết chứng từ</h2><div className={styles.inspectorSub}>{item.creditNoteNumber} · Từ refund {item.refundReference}</div></div><Badge kind={item.status === "ISSUED" ? "green" : "amber"}>{item.status === "ISSUED" ? "Đã phát hành" : "Bản nháp"}</Badge></div>
      <div className={styles.customer}><div className={styles.avatar}>{item.customerDisplayName.slice(0, 1).toUpperCase()}</div><div><div className={styles.customerName}>{item.customerDisplayName}</div><div className={styles.customerMeta}>{customer.email ?? item.customerPhone ?? "Thông tin liên hệ được giới hạn"}</div></div></div>
      <div className={styles.keyValue}><span>Ngày phát hành</span><strong>{item.issuedAt ? dateTime(item.issuedAt, item.branchTimezone) : "Chưa phát hành"}</strong></div>
      <div className={styles.keyValue}><span>Chi nhánh</span><strong>{item.branchName}</strong></div>
      <div className={styles.keyValue}><span>Người phát hành</span><strong>{item.issuerDisplayName ?? "—"}</strong></div>
      {loading ? <div className={styles.skeleton} /> : null}
    </div>
    <div className={`${styles.card} ${styles.inspectorCard}`}>
      <h2 className={styles.sectionTitle}>Giá trị Credit Note</h2>
      <div className={styles.keyValue}><span>Hóa đơn gốc</span><strong>{money(item.originalInvoiceGrandTotalMinor, item.currency)}</strong></div>
      <div className={styles.keyValue}><span>Điều chỉnh lần này</span><strong className={styles.muted}>-{money(item.totalMinor, item.currency)}</strong></div>
      <div className={styles.keyValue}><span>Đã điều chỉnh lũy kế</span><strong>{money(detail?.context?.invoice?.cumulativeAdjustmentMinor ?? item.cumulativeAdjustmentMinor, item.currency)}</strong></div>
      <div className={styles.totalLine}><span>Giá trị sau điều chỉnh</span><strong>{money(detail?.context?.invoice?.adjustedInvoiceValueMinor ?? item.adjustedInvoiceValueMinor, item.currency)}</strong></div>
      <Badge kind="green">Không sửa invoice gốc</Badge>
    </div>
    <div className={`${styles.card} ${styles.inspectorCard}`}>
      <h2 className={styles.sectionTitle}>Refund liên quan</h2>
      <div className={styles.keyValue}><span>Mã hoàn tiền</span><strong>{contextData?.refund?.reference ?? item.refundReference}</strong></div>
      <div className={styles.keyValue}><span>Trạng thái refund</span><strong>{contextData?.refund?.status ?? item.refundStatus}</strong></div>
      <div className={styles.keyValue}><span>Loại</span><strong>{kindLabel(item.refundKind)}</strong></div>
      {contextData?.refund?.completedMinor !== undefined ? <div className={styles.keyValue}><span>Đã hoàn</span><strong>{money(contextData.refund.completedMinor, item.currency)}</strong></div> : null}
      <Link className={styles.link} href={`/admin/refunds/${item.refundId}`}>Mở chi tiết refund <span>→</span></Link>
    </div>
    <div className={`${styles.card} ${styles.inspectorCard}`}>
      <div className={styles.inspectorHeader}><h2 className={styles.sectionTitle}>Phân phối chứng từ</h2><Badge kind={delivery?.latestState === "PENDING" || item.latestDeliveryState === "PENDING" ? "amber" : "gray"}>{delivery?.latestState === "PENDING" || item.latestDeliveryState === "PENDING" ? "Yêu cầu đã ghi nhận" : "Chưa xác minh"}</Badge></div>
      <p className={styles.footerNote}>{delivery?.note ?? "Chưa có trạng thái delivery ledger; không hiển thị thành Đã gửi."}</p>
      <div className={styles.buttonRow} style={{ marginTop: 10 }}>
        {item.status === "ISSUED" && hasPermission(context, "credit_note.print") ? <button className={styles.button} onClick={onPrint}>In chứng từ</button> : null}
        {item.status === "ISSUED" && hasPermission(context, "credit_note.deliver") ? <button className={`${styles.button} ${styles.buttonPrimary}`} onClick={() => onDeliver("EMAIL")} disabled={deliveryBusy}>{deliveryBusy ? "Đang ghi nhận…" : "Gửi email"}</button> : null}
      </div>
    </div>
    <div className={`${styles.card} ${styles.inspectorCard}`}>
      <h2 className={styles.sectionTitle}>Chứng từ liên quan</h2>
      <div className={styles.linkList}><Link className={styles.link} href={`/admin/financial/invoices?invoiceId=${item.originalInvoiceId}`}>Hóa đơn gốc <span>→</span></Link><Link className={styles.link} href={`/admin/refunds/${item.refundId}`}>Refund nguồn <span>→</span></Link></div>
    </div>
    <div className={`${styles.card} ${styles.inspectorCard}`}>
      <h2 className={styles.sectionTitle}>Lịch sử xử lý</h2>
      {detail?.context?.history?.length ? detail.context.history.map((event, index) => <div className={styles.deliveryRow} key={`${event.event}-${event.occurredAt}-${index}`}><span>{event.event.replaceAll("credit_note.", "").replaceAll("_", " ")}</span><strong>{dateTime(event.occurredAt, item.branchTimezone)}</strong></div>) : <div className={styles.noData}>Chưa có financial event cho chứng từ này.</div>}
    </div>
    {detail?.lines?.length ? <div className={`${styles.card} ${styles.inspectorCard}`}><h2 className={styles.sectionTitle}>Dòng điều chỉnh</h2>{detail.lines.map((line: any) => <div className={styles.deliveryRow} key={line.id}><span>{line.description_snapshot_json?.name ?? line.description_snapshot_json?.displayName ?? `Dòng ${line.line_no}`}</span><strong>{money(Number(line.total_minor ?? 0), item.currency)}</strong></div>)}</div> : null}
  </aside>;
}

export default function CreditNoteDirectoryPage() {
  const [filters, setFilters] = useState<Filters>(readFilters);
  const [requestedId] = useState(readRequestedCreditNoteId);
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [context, setContext] = useState<AuthContext>();
  const [directory, setDirectory] = useState<Directory>();
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<Detail>();
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const refreshContext = async () => {
      try {
        const result = await getAuthorizedBranchContext();
        setContext(result.context);
        setBranches(result.branches);
        if (!filters.branchId && result.branchId) setFilters((value) => ({ ...value, branchId: result.branchId ?? "", page: 1 }));
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể tải thông tin chi nhánh."); }
    };
    void refreshContext();
    const onBranch = (event: Event) => setFilters((value) => ({ ...value, branchId: (event as CustomEvent<string | undefined>).detail ?? "", page: 1 }));
    const onPop = () => { const next = readFilters(); setFilters(next); setSearchDraft(next.search); };
    window.addEventListener("nailsoft:active-branch-change", onBranch);
    window.addEventListener("popstate", onPop);
    return () => { window.removeEventListener("nailsoft:active-branch-change", onBranch); window.removeEventListener("popstate", onPop); };
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => setFilters((value) => ({ ...value, search: searchDraft.trim(), page: 1 })), 300); return () => window.clearTimeout(timer); }, [searchDraft]);
  useEffect(() => { const query = toQuery(filters); const next = `${window.location.pathname}${query ? `?${query}` : ""}`; if (`${window.location.pathname}${window.location.search}` !== next) window.history.replaceState(null, "", next); }, [filters]);
  const directoryPath = useMemo(() => { const query = toQuery(filters); return `/v1/credit-notes/directory${query ? `?${query}` : ""}`; }, [filters]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true); setError("");
    void json(directoryPath, { signal: controller.signal }).then((value) => {
      if (!active) return;
      const next = value as Directory;
      setDirectory(next);
      setSelectedId((current) => requestedId || (current && next.items.some((item) => item.id === current) ? current : next.items[0]?.id));
    }).catch((reason: any) => { if (active && reason?.name !== "AbortError") setError(reason instanceof Error ? reason.message : "Không thể tải danh sách chứng từ điều chỉnh."); }).finally(() => active && setLoading(false));
    return () => { active = false; controller.abort(); };
  }, [directoryPath]);
  useEffect(() => {
    if (!selectedId) { setDetail(undefined); return; }
    let active = true;
    const controller = new AbortController();
    setDetailLoading(true);
    void json(`/v1/credit-notes/${selectedId}`, { signal: controller.signal }).then((value) => active && setDetail(value as Detail)).catch((reason: any) => { if (active && reason?.name !== "AbortError") setError(reason instanceof Error ? reason.message : "Không thể tải chi tiết Credit Note."); }).finally(() => active && setDetailLoading(false));
    return () => { active = false; controller.abort(); };
  }, [selectedId]);
  const update = (key: keyof Filters, value: string | number) => setFilters((current) => ({ ...current, [key]: value, ...(key === "pageSize" || key === "sort" ? { page: 1 } : {}) }));
  const refresh = () => setFilters((value) => ({ ...value }));
  const exportData = async () => {
    if (!hasPermission(context, "financial.export")) { setError("Bạn không có quyền financial.export."); return; }
    try {
      const response = await json("/v1/financial/exports", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `credit-note-export-${Date.now()}` }, body: JSON.stringify({ branchId: filters.branchId || undefined, exportType: "CREDIT_NOTES", filters: { ...filters, page: undefined, pageSize: undefined } }) });
      setNotice(`Đã tạo job xuất dữ liệu ${response?.id ? `(${response.id})` : ""}. Trạng thái ban đầu: ${response?.status ?? "PENDING"}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể tạo job xuất Credit Note."); }
  };
  const deliver = async (channel: "EMAIL" | "PRINT") => {
    if (!selectedId || !detail) return;
    const destination = channel === "EMAIL" ? detail.context?.customer?.email ?? detail.context?.customer?.emailAddress : undefined;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await json(`/v1/credit-notes/${selectedId}/deliver`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `credit-note-delivery-${Date.now()}` }, body: JSON.stringify({ channel, ...(destination ? { destination } : {}) }) });
      setNotice(result?.status === "READY" ? "Yêu cầu in chứng từ đã được ghi nhận." : "Yêu cầu phân phối đã được ghi nhận, đang chờ xử lý; chưa có trạng thái đã gửi.");
      refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể ghi nhận yêu cầu phân phối."); } finally { setBusy(false); }
  };
  const print = async () => {
    if (!selectedId) return;
    try { await json(`/v1/credit-notes/${selectedId}/print`); setNotice("Đã lấy snapshot in chính thức từ backend. Delivery ledger chưa xác nhận trạng thái gửi."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể lấy bản in Credit Note."); }
  };
  const selected = directory?.items.find((item) => item.id === selectedId);
  const totalPages = directory?.pagination.totalPages ?? 1;
  const from = directory && directory.pagination.total ? (directory.pagination.page - 1) * directory.pagination.pageSize + 1 : 0;
  const to = directory ? Math.min(directory.pagination.page * directory.pagination.pageSize, directory.pagination.total) : 0;
  return <main className={styles.page}><div className={styles.content}>
    <div className={styles.header}><div><div className={styles.eyebrow}>Tài chính / Credit Note</div><h1 className={styles.title}>Chứng từ điều chỉnh</h1><p className={styles.subtitle}>Theo dõi các Credit Note được phát hành từ hoàn tiền và các điều chỉnh hợp lệ của hóa đơn.</p></div><div className={styles.headerActions}><button className={styles.button} onClick={exportData} disabled={loading}><UiIcon name="download" /> Xuất dữ liệu</button><button className={styles.button} onClick={refresh}><UiIcon name="refresh" /> Làm mới</button></div></div>
    {error ? <div className={styles.notice}><strong>Không thể hoàn tất thao tác.</strong><span>{error}</span><button className={styles.button} onClick={() => setError("")}>Đóng</button></div> : null}
    {notice ? <div className={`${styles.notice} ${styles.noticeNeutral}`}><strong>Đã ghi nhận.</strong><span>{notice}</span><button className={styles.button} onClick={() => setNotice("")}>Đóng</button></div> : null}
    <section className={styles.kpis} aria-label="Chỉ số Credit Note"><Kpi icon="file" label="Credit Note trong kỳ" value={String(directory?.counts.total ?? 0)} meta="Bản ghi từ domain" /><Kpi icon="trend" label="Tổng giá trị điều chỉnh" value={money(directory?.counts.totalAdjustmentMinor)} meta="Từ các Credit Note thật" /><Kpi icon="check" label="Đã phát hành" value={String(directory?.counts.issued ?? 0)} meta="Lifecycle ISSUED" /><Kpi icon="receipt" label="Hóa đơn có điều chỉnh" value={String(directory?.counts.adjustedInvoiceCount ?? 0)} meta="Tính theo invoice gốc" /><Kpi icon="notification" label="Yêu cầu gửi ghi nhận" value={String(directory?.counts.deliveryRequestedCount ?? 0)} meta="Không phải trạng thái đã gửi" /></section>
    <div className={styles.workspace}><div className={styles.mainColumn}>
      <section className={`${styles.card} ${styles.filters}`} aria-label="Bộ lọc Credit Note"><div className={styles.filterGrid}><div className={styles.field}><label htmlFor="credit-note-search">Tìm số Credit Note / hóa đơn / refund / khách hàng</label><input id="credit-note-search" className={styles.input} value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Nhập từ khóa tìm kiếm…" /></div><div className={styles.field}><label htmlFor="credit-note-branch">Chi nhánh</label><select id="credit-note-branch" className={styles.select} value={filters.branchId} onChange={(event) => update("branchId", event.target.value)}><option value="">Tất cả chi nhánh</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></div><div className={styles.field}><label htmlFor="credit-note-status">Trạng thái thật</label><select id="credit-note-status" className={styles.select} value={filters.status} onChange={(event) => update("status", event.target.value)}><option value="">Tất cả</option><option value="ISSUED">Đã phát hành</option><option value="DRAFT">Bản nháp</option></select></div><div className={styles.field}><label htmlFor="credit-note-kind">Nguồn điều chỉnh</label><select id="credit-note-kind" className={styles.select} value={filters.refundKind} onChange={(event) => update("refundKind", event.target.value)}><option value="">Tất cả</option><option value="FULL">Hoàn toàn</option><option value="PARTIAL">Hoàn một phần</option><option value="TIP_ONLY">Hoàn tip</option><option value="MIXED">Hoàn hỗn hợp</option></select></div><div className={styles.field}><label htmlFor="credit-note-sort">Sắp xếp</label><select id="credit-note-sort" className={styles.select} value={filters.sort} onChange={(event) => update("sort", event.target.value)}><option value="NEWEST">Mới nhất</option><option value="OLDEST">Cũ nhất</option><option value="AMOUNT_DESC">Giá trị cao nhất</option><option value="AMOUNT_ASC">Giá trị thấp nhất</option></select></div></div><div className={styles.filterLine}><div className={styles.chips}>{[["", "Tất cả"], ["ISSUED", "Đã phát hành"], ["DRAFT", "Bản nháp"]].map(([value, label]) => <button key={value} className={`${styles.chip} ${filters.status === value ? styles.chipActive : ""}`} onClick={() => update("status", value ?? "")}>{label}</button>)}</div><div className={styles.field}><label htmlFor="credit-note-from">Từ ngày</label><input id="credit-note-from" className={styles.dateInput} type="date" value={filters.issuedFrom} onChange={(event) => update("issuedFrom", event.target.value)} /></div><div className={styles.field}><label htmlFor="credit-note-to">Đến ngày</label><input id="credit-note-to" className={styles.dateInput} type="date" value={filters.issuedTo} onChange={(event) => update("issuedTo", event.target.value)} /></div><button className={styles.button} onClick={() => setFilters({ ...EMPTY_FILTERS, branchId: filters.branchId })}>Xóa bộ lọc</button></div><div className={styles.filterLine}><span className={styles.tableMeta}>Nguồn thật: hoàn tiền đã hoàn tất → Credit Note. Không có nút tạo thủ công.</span><span className={styles.tableMeta}>Phân phối: chưa có delivery ledger hoàn tất.</span></div></section>
      {loading ? <section className={`${styles.card} ${styles.tableCard}`}><div className={styles.tableHeader}><div className={styles.skeleton} style={{ width: 220 }} /><div className={styles.skeleton} style={{ width: 100 }} /></div><div className={styles.tableWrap}><table className={styles.table}><tbody>{Array.from({ length: 6 }, (_, row) => <tr key={row}>{Array.from({ length: 9 }, (_, cell) => <td key={cell}><div className={styles.skeleton} /></td>)}</tr>)}</tbody></table></div></section> : error && !directory ? <section className={`${styles.card} ${styles.error}`}><strong>Không thể tải danh sách Credit Note</strong><p>{error}</p><button className={styles.button} onClick={refresh}>Thử lại</button></section> : <section className={`${styles.card} ${styles.tableCard}`}><div className={styles.tableHeader}><div><h2 className={styles.sectionTitle}>Danh sách chứng từ điều chỉnh</h2><div className={styles.tableMeta}>{directory?.pagination.total ?? 0} chứng từ trong bộ lọc hiện tại</div></div><span className={styles.tableMeta}>Số liệu lấy từ Credit Note directory read model</span></div>{directory?.items.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr>{["Số chứng từ", "Ngày phát hành", "Khách hàng", "Hóa đơn gốc", "Nguồn", "Giá trị", "Trạng thái", "Phân phối", "Thao tác"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{directory.items.map((item) => <tr key={item.id} className={item.id === selectedId ? styles.selected : ""} onClick={() => setSelectedId(item.id)} aria-selected={item.id === selectedId}><td><span className={styles.strong}>{item.creditNoteNumber}</span><span className={styles.small}>{item.branchName}</span></td><td>{item.issuedAt ? dateTime(item.issuedAt, item.branchTimezone) : <span className={styles.muted}>Chưa phát hành</span>}</td><td><span className={styles.strong}>{item.customerDisplayName}</span>{item.customerPhone ? <span className={styles.small}>{item.customerPhone}</span> : null}</td><td><span className={styles.strong}>{item.invoiceNumber ?? "—"}</span><span className={styles.small}>Sau lũy kế: {money(item.adjustedInvoiceValueMinor, item.currency)}</span></td><td><Badge kind={item.refundKind === "FULL" ? "green" : item.refundKind === "PARTIAL" ? "rose" : "purple"}>{kindLabel(item.refundKind)}</Badge><span className={styles.small}>{item.refundReference}</span></td><td className={`${styles.money} ${styles.strong}`}>{money(item.totalMinor, item.currency)}</td><td><Badge kind={item.status === "ISSUED" ? "green" : "amber"}>{item.status === "ISSUED" ? "Đã phát hành" : "Bản nháp"}</Badge></td><td>{item.latestDeliveryState === "PENDING" ? <Badge kind="amber">Yêu cầu ghi nhận</Badge> : <Badge kind="gray">Chưa xác minh</Badge>}</td><td><div className={styles.rowActions} onClick={(event) => event.stopPropagation()}><button className={styles.iconButton} title="Xem chi tiết" onClick={() => setSelectedId(item.id)}>◉</button><Link className={styles.iconButton} href={`/admin/credit-notes/${item.id}`} title="Mở route chi tiết">↗</Link></div></td></tr>)}</tbody></table></div> : <div className={styles.empty}><strong>Không có Credit Note phù hợp</strong><p>Không có bản ghi nào phù hợp với bộ lọc hiện tại. Chứng từ chỉ phát sinh sau khi refund hoàn tất.</p><button className={styles.button} onClick={() => setFilters({ ...EMPTY_FILTERS, branchId: filters.branchId })}>Xóa bộ lọc</button></div>}<div className={styles.pagination}><span>Hiển thị {from}–{to} trong {directory?.pagination.total ?? 0} chứng từ</span><div className={styles.paginationControls}><button className={styles.pageButton} disabled={filters.page <= 1} onClick={() => update("page", filters.page - 1)}>‹</button>{Array.from({ length: Math.min(5, totalPages) }, (_, index) => { const page = Math.min(Math.max(1, filters.page - 2) + index, totalPages); return <button key={page} className={`${styles.pageButton} ${filters.page === page ? styles.pageButtonActive : ""}`} onClick={() => update("page", page)}>{page}</button>; })}<button className={styles.pageButton} disabled={filters.page >= totalPages} onClick={() => update("page", filters.page + 1)}>›</button><select className={styles.select} style={{ width: 90, minHeight: 30 }} value={filters.pageSize} onChange={(event) => update("pageSize", Number(event.target.value))}><option value={10}>10 / trang</option><option value={20}>20 / trang</option><option value={50}>50 / trang</option><option value={100}>100 / trang</option></select></div></div></section>}
      <section className={styles.summaryGrid}><div className={`${styles.card} ${styles.summary}`}><div className={styles.summaryLabel}>Tổng giá trị điều chỉnh</div><div className={styles.summaryValue}>{money(directory?.counts.totalAdjustmentMinor)}</div></div><div className={`${styles.card} ${styles.summary}`}><div className={styles.summaryLabel}>Đã phát hành</div><div className={styles.summaryValue}>{directory?.counts.issued ?? 0}</div></div><div className={`${styles.card} ${styles.summary}`}><div className={styles.summaryLabel}>Hóa đơn bị điều chỉnh</div><div className={styles.summaryValue}>{directory?.counts.adjustedInvoiceCount ?? 0}</div></div><div className={`${styles.card} ${styles.summary}`}><div className={styles.summaryLabel}>Yêu cầu phân phối</div><div className={styles.summaryValue}>{directory?.counts.deliveryRequestedCount ?? 0}</div></div></section>
    </div><Inspector item={selected} detail={detail} loading={detailLoading} context={context} onDeliver={deliver} deliveryBusy={busy} onPrint={print} /></div>
  </div></main>;
}

function Kpi({ icon, label, value, meta }: { icon: string; label: string; value: string; meta: string }) {
  return <div className={styles.kpi}><div className={styles.kpiIcon}><UiIcon name={icon as any} /></div><div><div className={styles.kpiLabel}>{label}</div><div className={styles.kpiValue}>{value}</div><div className={styles.kpiMeta}>{meta}</div></div></div>;
}

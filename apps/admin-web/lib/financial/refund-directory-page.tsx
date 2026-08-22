"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  authorizedFetch,
  getActiveBranchId,
  getAuthContext,
  getAuthorizedBranchContext,
} from "../auth";
import styles from "./refund-directory-page.module.css";

type Branch = { id: string; name: string; code?: string; status?: string };
type RefundStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "PROCESSING" | "COMPLETED" | "FAILED" | "UNKNOWN" | "REJECTED" | "CANCELLED";
type RefundItem = {
  id: string;
  branchId: string;
  branch: { name: string; code?: string; timezone?: string | null };
  refundReference: string;
  status: RefundStatus;
  refundKind: "FULL" | "PARTIAL" | "TIP_ONLY" | "MIXED";
  tenderTypes: string[];
  currency: string;
  requestedMinor: number;
  approvedMinor: number | null;
  completedMinor: number;
  outstandingMinor: number;
  serviceRefundMinor: number;
  taxRefundMinor: number;
  tipRefundMinor: number;
  reasonCode: string;
  reasonText: string;
  requestedAt: string;
  approvedAt?: string | null;
  completedAt?: string | null;
  version: number;
  customer: { id?: string | null; displayName: string; phone?: string | null };
  invoice?: { id: string; number: string; status: string; href: string } | null;
  posOrder?: { id: string; number: string; status: string; href: string } | null;
  appointment?: { id: string; href: string } | null;
  requester?: { id: string; displayName: string } | null;
  approver?: { id: string; displayName: string } | null;
  creditNote?: { id: string; number: string; status: string; totalMinor: number; href: string } | null;
  itemCount: number;
  orderSource?: string;
  orderStatus?: string;
  invoiceTotalMinor: number;
};
type Directory = {
  items: RefundItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  counts: { total: number; completed: number; needsReview: number; unknown: number; pendingApproval: number; processing: number };
  summary: { requestedMinor: number; completedMinor: number; outstandingMinor: number; completionPercentage: number; kindMix: { full: number; partial: number; tipOnly: number; mixed: number } };
};
type Detail = RefundItem & { items: any[]; paymentAllocations: any[]; creditNote?: any; history: any[] };
type AuthContext = Awaited<ReturnType<typeof getAuthContext>>;
type Filters = { branchId: string; search: string; status: string; refundKind: string; tenderType: string; requestedFrom: string; requestedTo: string; sort: string; page: number; pageSize: number };

const EMPTY_FILTERS: Filters = { branchId: "", search: "", status: "", refundKind: "", tenderType: "", requestedFrom: "", requestedTo: "", sort: "NEWEST", page: 1, pageSize: 10 };
const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Bản nháp", PENDING_APPROVAL: "Chờ duyệt", APPROVED: "Đã duyệt", PROCESSING: "Đang xử lý", COMPLETED: "Hoàn thành", FAILED: "Thất bại", UNKNOWN: "UNKNOWN", REJECTED: "Từ chối", CANCELLED: "Đã hủy",
};
const KIND_LABEL: Record<string, string> = { FULL: "Hoàn toàn bộ", PARTIAL: "Hoàn một phần", TIP_ONLY: "Hoàn tip", MIXED: "Hoàn hỗn hợp" };
const TENDER_LABEL: Record<string, string> = { CASH: "Tiền mặt", CARD_EXTERNAL: "Thẻ", BANK_TRANSFER: "Chuyển khoản", OTHER_EXTERNAL: "Khác" };

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
    tenderType: params.get("tenderType") ?? "",
    requestedFrom: params.get("requestedFrom") ?? "",
    requestedTo: params.get("requestedTo") ?? "",
    sort: params.get("sort") ?? "NEWEST",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: [10, 20, 50, 100].includes(pageSize) ? pageSize : 10,
  };
}
function readRequestedId() { return typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("refundId") ?? ""; }
function toQuery(filters: Filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value !== "" && value !== undefined) params.set(key, String(value)); });
  return params.toString();
}
function money(value: number | null | undefined, currency = "VND") { return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value ?? 0); }
function dateTime(value?: string | null, timezone?: string | null) { if (!value) return "—"; return new Intl.DateTimeFormat("vi-VN", { timeZone: timezone || undefined, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function unwrap(body: any) { return body?.data; }
async function json(path: string, init?: RequestInit) {
  const response = await authorizedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body?.error?.message ?? "Không thể tải dữ liệu."), { status: response.status });
  return unwrap(body);
}
function hasPermission(context: AuthContext | undefined, permission: string) { const permissions = context?.supportAccess?.permissions ?? context?.authorization.permissions ?? []; return permissions.includes(permission); }
function statusTone(status: string) { if (status === "COMPLETED") return "green"; if (["UNKNOWN", "FAILED"].includes(status)) return "purple"; if (["PENDING_APPROVAL", "APPROVED", "PROCESSING"].includes(status)) return "amber"; if (["REJECTED", "CANCELLED"].includes(status)) return "gray"; return "rose"; }
function kindTone(kind: string) { return kind === "FULL" ? "green" : kind === "TIP_ONLY" ? "purple" : "amber"; }

function Badge({ tone, children }: { tone: string; children: ReactNode }) { return <span className={`${styles.badge} ${styles[`badge${tone[0]!.toUpperCase()}${tone.slice(1)}`] ?? styles.badgeGray}`}>{children}</span>; }
function IconCircle({ tone = "rose", children }: { tone?: string; children: ReactNode }) { return <span className={`${styles.iconCircle} ${styles[`icon${tone[0]!.toUpperCase()}${tone.slice(1)}`] ?? styles.iconRose}`}>{children}</span>; }
function Kpi({ icon, tone, label, value, meta }: { icon: string; tone: string; label: string; value: ReactNode; meta: ReactNode }) { return <article className={styles.kpi}><IconCircle tone={tone}>{icon}</IconCircle><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></article>; }
function Stat({ label, value, tone = "ink" }: { label: string; value: ReactNode; tone?: string }) { return <div className={styles.stat}><span>{label}</span><strong className={styles[`text${tone[0]!.toUpperCase()}${tone.slice(1)}`] ?? ""}>{value}</strong></div>; }
function Row({ label, children }: { label: string; children: ReactNode }) { return <div className={styles.row}><span>{label}</span><strong>{children}</strong></div>; }
function LinkButton({ href, children, tone = "quiet" }: { href: string; children: ReactNode; tone?: string }) { return <Link className={`${styles.linkButton} ${tone === "danger" ? styles.dangerButton : ""}`} href={href}>{children}</Link>; }

function Inspector({ item, detail, loading, context }: { item: RefundItem | undefined; detail: Detail | undefined; loading: boolean; context: AuthContext | undefined }) {
  if (!item) return <aside className={styles.rail}><section className={styles.card}><div className={styles.emptyRail}><IconCircle>↗</IconCircle><strong>Chọn một yêu cầu hoàn tiền</strong><p>Chọn một dòng để xem snapshot, quan hệ chứng từ và bước xử lý tiếp theo.</p></div></section></aside>;
  const detailCreditNote = detail?.creditNote ?? item.creditNote;
  return <aside className={styles.rail}>
    <section className={styles.card}>
      <div className={styles.cardHeader}><div><p className={styles.cardEyebrow}>Chi tiết hoàn tiền</p><h2>{item.refundReference}</h2></div><Badge tone={statusTone(item.status)}>{STATUS_LABEL[item.status]}</Badge></div>
      <div className={styles.customer}><div className={styles.avatar}>{item.customer.displayName.slice(0, 1).toUpperCase()}</div><div><strong>{item.customer.displayName}</strong><small>{item.customer.phone ?? "Thông tin liên hệ được giới hạn"}</small></div></div>
      <Row label="Ngày yêu cầu">{dateTime(item.requestedAt, item.branch.timezone)}</Row>
      <Row label="Chi nhánh">{item.branch.name}</Row>
      <Row label="Người yêu cầu">{item.requester?.displayName ?? "—"}</Row>
      {item.approver ? <Row label="Người duyệt">{item.approver.displayName}</Row> : null}
      <div className={styles.amountPanel}><div><span>Yêu cầu</span><strong>{money(item.requestedMinor, item.currency)}</strong></div><div><span>Đã hoàn</span><strong className={item.completedMinor ? styles.textGreen : ""}>{money(item.completedMinor, item.currency)}</strong></div><div><span>Còn lại</span><strong className={item.outstandingMinor ? styles.textRose : ""}>{money(item.outstandingMinor, item.currency)}</strong></div></div>
    </section>
    <section className={styles.card}>
      <h3 className={styles.sectionTitle}>Nguồn & chứng từ</h3>
      {item.invoice ? <LinkButton href={item.invoice.href}>Hóa đơn · {item.invoice.number} <span>→</span></LinkButton> : null}
      {item.posOrder ? <LinkButton href={item.posOrder.href}>Đơn POS · {item.posOrder.number} <span>→</span></LinkButton> : null}
      {item.appointment ? <LinkButton href={item.appointment.href}>Lịch hẹn gốc <span>→</span></LinkButton> : null}
      {detailCreditNote ? <LinkButton href={item.creditNote?.href ?? `/admin/credit-notes/${detailCreditNote.id}`}>Credit note · {detailCreditNote.credit_note_number ?? detailCreditNote.number} <span>→</span></LinkButton> : <p className={styles.muted}>Credit note sẽ được phát hành khi refund hoàn tất.</p>}
      <div className={styles.rows}><Row label="Loại hoàn">{KIND_LABEL[item.refundKind]}</Row><Row label="Phương thức">{item.tenderTypes.length ? item.tenderTypes.map((x) => TENDER_LABEL[x] ?? x).join(", ") : "—"}</Row><Row label="Số mục">{item.itemCount}</Row></div>
    </section>
    <section className={styles.card}>
      <h3 className={styles.sectionTitle}>Lý do hoàn tiền</h3>
      <div className={styles.reason}><strong>{item.reasonCode}</strong><p>{item.reasonText}</p></div>
      {item.status === "UNKNOWN" ? <div className={styles.warning}><strong>⚠ Chưa xác định từ provider</strong><p>Không retry mù quáng. Hãy mở chi tiết, xác minh provider rồi mới chuyển UNKNOWN → PROCESSING.</p></div> : null}
      {loading ? <div className={styles.loadingLine}>Đang tải lịch sử…</div> : detail?.history?.length ? <div className={styles.timeline}>{detail.history.map((event: any, index) => <div className={styles.timelineItem} key={`${event.id ?? event.created_at}-${index}`}><i /><div><strong>{STATUS_LABEL[event.to_status] ?? event.to_status}</strong><small>{dateTime(event.created_at, item.branch.timezone)} · {event.actor_type === "SYSTEM" ? "Hệ thống" : "Người dùng"}</small>{event.note ? <p>{event.note}</p> : null}</div></div>)}</div> : null}
    </section>
    <section className={styles.card}>
      <h3 className={styles.sectionTitle}>Thao tác</h3>
      <div className={styles.actionGrid}>
        {item.status === "PENDING_APPROVAL" ? <LinkButton href={`/admin/refunds/${item.id}/approval`} tone="danger">Mở duyệt hoàn tiền</LinkButton> : null}
        {["APPROVED", "PROCESSING", "FAILED", "UNKNOWN"].includes(item.status) ? <LinkButton href={`/admin/refunds/${item.id}/execute`} tone="danger">Mở xử lý hoàn tiền</LinkButton> : null}
        {item.status === "DRAFT" ? <LinkButton href={`/admin/refunds/${item.id}`}>Mở yêu cầu nháp</LinkButton> : null}
        {item.status === "COMPLETED" && item.creditNote ? <LinkButton href={item.creditNote.href}>Mở credit note</LinkButton> : null}
        {hasPermission(context, "refund.read") ? <LinkButton href={`/admin/refunds/${item.id}`}>Xem chi tiết nghiệp vụ</LinkButton> : null}
      </div>
    </section>
  </aside>;
}

export default function RefundDirectoryPage() {
  const [filters, setFilters] = useState<Filters>(readFilters);
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const [requestedId, setRequestedId] = useState(readRequestedId);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [context, setContext] = useState<AuthContext>();
  const [directory, setDirectory] = useState<Directory>();
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<Detail>();
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void getAuthorizedBranchContext().then((result) => {
      setContext(result.context); setBranches(result.branches);
      if (!filters.branchId && result.branchId) setFilters((value) => ({ ...value, branchId: result.branchId ?? "", page: 1 }));
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Không thể tải thông tin chi nhánh."));
    const onBranch = (event: Event) => { setRequestedId(""); setSelectedId(undefined); setFilters((value) => ({ ...value, branchId: (event as CustomEvent<string | undefined>).detail ?? "", page: 1 })); };
    const onPop = () => { const next = readFilters(); setFilters(next); setSearchDraft(next.search); setRequestedId(readRequestedId()); };
    window.addEventListener("nailsoft:active-branch-change", onBranch); window.addEventListener("popstate", onPop);
    return () => { window.removeEventListener("nailsoft:active-branch-change", onBranch); window.removeEventListener("popstate", onPop); };
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => setFilters((value) => ({ ...value, search: searchDraft.trim(), page: 1 })), 300); return () => window.clearTimeout(timer); }, [searchDraft]);
  useEffect(() => { const query = toQuery(filters); const next = `${window.location.pathname}${query ? `?${query}${requestedId ? `&refundId=${encodeURIComponent(requestedId)}` : ""}` : requestedId ? `?refundId=${encodeURIComponent(requestedId)}` : ""}`; if (`${window.location.pathname}${window.location.search}` !== next) window.history.replaceState(null, "", next); }, [filters, requestedId]);
  const directoryPath = useMemo(() => { const query = toQuery(filters); return `/v1/refunds/directory${query ? `?${query}` : ""}`; }, [filters]);
  useEffect(() => {
    let active = true; const controller = new AbortController(); setLoading(true); setError("");
    void json(directoryPath, { signal: controller.signal }).then((value) => {
      if (!active) return; const next = value as Directory; setDirectory(next);
      if (requestedId) { const exact = next.items.find((row) => row.id === requestedId); setSelectedId(exact?.id); if (!exact) setError("Không tìm thấy đúng yêu cầu hoàn tiền trong chi nhánh và bộ lọc hiện tại."); }
      else setSelectedId((current) => current && next.items.some((row) => row.id === current) ? current : next.items[0]?.id);
    }).catch((reason: any) => { if (active && reason?.name !== "AbortError") setError(reason instanceof Error ? reason.message : "Không thể tải danh sách hoàn tiền."); }).finally(() => active && setLoading(false));
    return () => { active = false; controller.abort(); };
  }, [directoryPath, requestedId]);
  useEffect(() => {
    if (!selectedId) { setDetail(undefined); return; }
    let active = true; setDetailLoading(true);
    void Promise.all([json(`/v1/refunds/${selectedId}`), json(`/v1/refunds/${selectedId}/history`)]).then(([value, history]) => { if (active) setDetail({ ...(value as any), history: Array.isArray(history) ? history : [] }); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Không thể tải chi tiết hoàn tiền."); }).finally(() => active && setDetailLoading(false));
    return () => { active = false; };
  }, [selectedId]);
  const update = (patch: Partial<Filters>) => { if (patch.branchId !== undefined && patch.branchId !== filters.branchId) { setRequestedId(""); setSelectedId(undefined); } setFilters((value) => ({ ...value, ...patch, page: patch.page ?? 1 })); };
  const clearFilters = () => { setSearchDraft(""); setRequestedId(""); setSelectedId(undefined); setFilters({ ...EMPTY_FILTERS, branchId: filters.branchId }); };
  const selectRow = (id: string) => { setSelectedId(id); setRequestedId(id); const params = new URLSearchParams(window.location.search); params.set("refundId", id); window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`); };
  const exportReport = async () => { setSaving(true); setError(""); try { const result = await json("/v1/financial/exports", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ branchId: filters.branchId || undefined, exportType: "REFUNDS", filters }) }); setNotice(`Đã tạo yêu cầu xuất báo cáo (${result.status ?? "PENDING"}).`); } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể tạo export."); } finally { setSaving(false); } };
  const selected = directory?.items.find((row) => row.id === selectedId);
  const activeBranchName = branches.find((branch) => branch.id === filters.branchId)?.name ?? "Tất cả chi nhánh";
  return <main className={styles.page}>
    <div className={styles.content}>
      <header className={styles.header}><div><p className={styles.eyebrow}>Tài chính&nbsp; / &nbsp;Hoàn tiền</p><h1>Hoàn tiền</h1><p className={styles.subtitle}>Theo dõi yêu cầu hoàn tiền, trạng thái xử lý và chứng từ điều chỉnh liên quan đến giao dịch thanh toán.</p></div><div className={styles.headerActions}><button className={styles.secondaryButton} onClick={() => void exportReport()} disabled={saving || !hasPermission(context, "financial.export")}>↓&nbsp; Xuất báo cáo</button><Link className={styles.primaryButton} href="/admin/refunds/new">＋&nbsp; Tạo yêu cầu hoàn tiền</Link></div></header>
      {error ? <div className={styles.error} role="alert">{error}<button onClick={() => setError("")}>Đóng</button></div> : null}{notice ? <div className={styles.notice} role="status">✓ {notice}<button onClick={() => setNotice("")}>Đóng</button></div> : null}
      <section className={styles.kpis} aria-label="Chỉ số hoàn tiền"><Kpi icon="▣" tone="rose" label="Yêu cầu trong kỳ" value={directory?.counts.total ?? "—"} meta={`${activeBranchName}`} /><Kpi icon="$" tone="amber" label="Giá trị yêu cầu" value={directory ? money(directory.summary.requestedMinor) : "—"} meta="Tổng yêu cầu" /><Kpi icon="✓" tone="green" label="Đã hoàn thành" value={directory?.counts.completed ?? "—"} meta={directory ? money(directory.summary.completedMinor) : "—"} /><Kpi icon="◷" tone="purple" label="Đang xử lý" value={directory?.counts.processing ?? "—"} meta={`${directory?.counts.pendingApproval ?? 0} chờ duyệt`} /><Kpi icon="?" tone="coral" label="Cần xem xét" value={directory?.counts.unknown ?? "—"} meta="UNKNOWN cần xác minh" /></section>
      <section className={styles.overview}><Stat label="Đã hoàn" value={directory ? money(directory.summary.completedMinor) : "—"} tone="green" /><Stat label="Đang xử lý / chờ duyệt" value={directory ? money(directory.summary.outstandingMinor) : "—"} tone="amber" /><Stat label="Tỷ lệ hoàn thành" value={directory ? `${directory.summary.completionPercentage.toLocaleString("vi-VN")} %` : "—"} tone="purple" /><Stat label="UNKNOWN" value={directory?.counts.unknown ?? "—"} tone="rose" /></section>
      <section className={styles.card}><div className={styles.filterGrid}><label className={`${styles.field} ${styles.searchField}`}><span>Tìm mã hoàn tiền / hóa đơn / POS / khách hàng</span><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Tìm kiếm…" /></label><label className={styles.field}><span>Chi nhánh</span><select value={filters.branchId} onChange={(event) => update({ branchId: event.target.value })}><option value="">Tất cả</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label className={styles.field}><span>Trạng thái</span><select value={filters.status} onChange={(event) => update({ status: event.target.value })}><option value="">Tất cả</option>{Object.entries(STATUS_LABEL).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label><label className={styles.field}><span>Loại hoàn</span><select value={filters.refundKind} onChange={(event) => update({ refundKind: event.target.value })}><option value="">Tất cả</option>{Object.entries(KIND_LABEL).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label><label className={styles.field}><span>Phương thức</span><select value={filters.tenderType} onChange={(event) => update({ tenderType: event.target.value })}><option value="">Tất cả</option>{Object.entries(TENDER_LABEL).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label><label className={styles.field}><span>Từ ngày</span><input type="date" value={filters.requestedFrom} onChange={(event) => update({ requestedFrom: event.target.value })} /></label><label className={styles.field}><span>Đến ngày</span><input type="date" value={filters.requestedTo} onChange={(event) => update({ requestedTo: event.target.value })} /></label></div><div className={styles.filterBottom}><div className={styles.chips}><button className={!filters.status ? styles.chipActive : styles.chip} onClick={() => update({ status: "" })}>Tất cả</button><button className={filters.status === "PENDING_APPROVAL" ? styles.chipActive : styles.chip} onClick={() => update({ status: "PENDING_APPROVAL" })}>Chờ duyệt</button><button className={filters.status === "PROCESSING" ? styles.chipActive : styles.chip} onClick={() => update({ status: "PROCESSING" })}>Đang xử lý</button><button className={filters.status === "COMPLETED" ? styles.chipActive : styles.chip} onClick={() => update({ status: "COMPLETED" })}>Hoàn thành</button><button className={filters.status === "UNKNOWN" ? styles.chipActive : styles.chip} onClick={() => update({ status: "UNKNOWN" })}>UNKNOWN</button><button className={filters.status === "FAILED" ? styles.chipActive : styles.chip} onClick={() => update({ status: "FAILED" })}>Cần xử lý</button></div><div className={styles.filterTools}><span>Sắp xếp</span><select value={filters.sort} onChange={(event) => update({ sort: event.target.value })}><option value="NEWEST">Mới nhất</option><option value="OLDEST">Cũ nhất</option><option value="AMOUNT_DESC">Giá trị cao</option><option value="AMOUNT_ASC">Giá trị thấp</option></select><button className={styles.clearButton} onClick={clearFilters}>Xóa bộ lọc</button></div></div></section>
      <div className={styles.workspace}><section className={styles.mainColumn}><section className={`${styles.card} ${styles.tableCard}`}><div className={styles.tableHeader}><div><h2>Danh sách yêu cầu hoàn tiền</h2><p>{directory ? `Hiển thị ${directory.items.length} / ${directory.pagination.total} yêu cầu` : "Đang tải dữ liệu…"}</p></div><span className={styles.live}>● Dữ liệu từ server</span></div>{loading && !directory ? <div className={styles.loadingBox}>Đang tải danh sách…</div> : directory?.items.length ? <div className={styles.tableWrap}><table><thead><tr><th>Mã hoàn tiền</th><th>Thời gian</th><th>Khách hàng</th><th>Hóa đơn / POS</th><th>Loại</th><th>Yêu cầu</th><th>Đã hoàn</th><th>Phương thức</th><th>Trạng thái</th><th /></tr></thead><tbody>{directory.items.map((item) => <tr key={item.id} className={selectedId === item.id ? styles.selectedRow : ""} onClick={() => selectRow(item.id)}><td><strong>{item.refundReference}</strong><small>{item.reasonCode}</small></td><td>{dateTime(item.requestedAt, item.branch.timezone)}</td><td><strong>{item.customer.displayName}</strong><small>{item.customer.phone ?? "—"}</small></td><td><strong>{item.invoice?.number ?? "—"}</strong><small>{item.posOrder?.number ?? "—"}</small></td><td><Badge tone={kindTone(item.refundKind)}>{KIND_LABEL[item.refundKind]}</Badge></td><td className={styles.money}>{money(item.requestedMinor, item.currency)}</td><td className={`${styles.money} ${item.completedMinor ? styles.textGreen : ""}`}>{money(item.completedMinor, item.currency)}</td><td>{item.tenderTypes.length ? item.tenderTypes.map((x) => TENDER_LABEL[x] ?? x).join(", ") : "—"}</td><td><Badge tone={statusTone(item.status)}>{STATUS_LABEL[item.status]}</Badge></td><td className={styles.chevron}>›</td></tr>)}</tbody></table></div> : <div className={styles.empty}>Không có yêu cầu hoàn tiền phù hợp với bộ lọc hiện tại.<button onClick={clearFilters}>Xóa bộ lọc</button></div>}{directory ? <div className={styles.tableFooter}><span>Trang {directory.pagination.page} / {directory.pagination.totalPages}</span><div><button disabled={directory.pagination.page <= 1} onClick={() => update({ page: directory.pagination.page - 1 })}>‹</button><button disabled={directory.pagination.page >= directory.pagination.totalPages} onClick={() => update({ page: directory.pagination.page + 1 })}>›</button><select value={filters.pageSize} onChange={(event) => update({ pageSize: Number(event.target.value) })}><option value={10}>10 / trang</option><option value={20}>20 / trang</option><option value={50}>50 / trang</option></select></div></div> : null}</section><section className={styles.bottomGrid}><div className={`${styles.card} ${styles.bottomCard}`}><h3>Tổng quan theo loại hoàn</h3><div className={styles.mix}><span><i className={styles.dotGreen} />Hoàn toàn bộ <b>{directory?.summary.kindMix.full ?? 0}</b></span><span><i className={styles.dotAmber} />Hoàn một phần <b>{directory?.summary.kindMix.partial ?? 0}</b></span><span><i className={styles.dotPurple} />Hoàn tip / hỗn hợp <b>{(directory?.summary.kindMix.tipOnly ?? 0) + (directory?.summary.kindMix.mixed ?? 0)}</b></span></div></div><div className={`${styles.card} ${styles.bottomCard}`}><h3>Nguyên tắc xử lý</h3><p>UNKNOWN phải được xác minh provider trước khi retry. Hoàn tiền mặt do backend kiểm tra register/session và tự tạo movement một lần.</p></div></section></section><Inspector item={selected} detail={detail} loading={detailLoading} context={context} /></div>
    </div>
  </main>;
}

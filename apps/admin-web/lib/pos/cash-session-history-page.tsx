"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { io } from "socket.io-client";
import { activeSession, authorizedFetch, getActiveBranchId } from "../auth";
import styles from "./cash-session-history-page.module.css";

type Money = number | null;
type DirectoryItem = {
  id: string;
  reference: string;
  branchId: string;
  branchName: string;
  registerId: string;
  registerCode: string;
  registerName: string;
  cashierUserId: string;
  cashierDisplayName: string;
  businessDate: string;
  timezone: string;
  status: "OPEN" | "CLOSING" | "CLOSED" | "CANCELLED";
  openedAt: string;
  closingStartedAt?: string | null;
  closedAt?: string | null;
  openingFloatMinor: Money;
  expectedCashMinor: Money;
  declaredCashMinor: Money;
  varianceMinor: Money;
  varianceThresholdMinor: Money;
  varianceReason?: string | null;
  varianceApprovedByDisplayName?: string | null;
  closedByDisplayName?: string | null;
  currency: string;
  transactionCount: number;
  sessionSalesMinor: Money;
  totalCapturedMinor: Money;
  cashCapturedMinor: Money;
  cashOutMinor: Money;
  cashRefundMinor: Money;
  cashDropMinor: Money;
  paymentMix: Record<string, { amountMinor: Money; paymentCount: number }> | null;
  reconciliation: "PENDING" | "MATCHED" | "VARIANCE";
  blindCount: boolean;
};
type DirectoryData = {
  items: DirectoryItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  counts: { total: number; open: number; closing: number; closed: number; matched: number; variance: number };
  periodSummary: {
    sessionCount: number;
    closedSessionCount: number;
    transactionCount: number;
    reconciledSalesMinor: number;
    netVarianceMinor: number;
    shortSessionCount: number;
    overSessionCount: number;
  };
  facets: {
    branches: Array<{ id: string; name: string }>;
    registers: Array<{ id: string; branchId: string; code: string; name: string }>;
    cashiers: Array<{ id: string; displayName: string }>;
  };
};
type Overview = {
  metrics: {
    sessionSalesMinor: Money;
    totalCapturedMinor: Money;
    cashCapturedMinor: Money;
    paymentMix: Record<string, { amountMinor: Money; paymentCount: number }> | null;
  };
  cashFlow: { cashRefundMinor: Money; cashOutMinor: Money };
  attention: Array<{ code: string; blocking: boolean; message: string; amountMinor: Money }>;
};
type Filters = {
  branchId: string;
  registerId: string;
  cashierUserId: string;
  status: string;
  reconciliation: "ALL" | "MATCHED" | "VARIANCE";
  varianceDirection: "" | "SHORT" | "OVER";
  from: string;
  to: string;
  sort: "NEWEST" | "OLDEST" | "REVENUE_DESC" | "REVENUE_ASC" | "VARIANCE_DESC";
  page: number;
  pageSize: number;
  search: string;
};
type ApiBody = { data?: DirectoryData; error?: { message?: string; code?: string } };

const defaultFilters: Filters = {
  branchId: "",
  registerId: "",
  cashierUserId: "",
  status: "",
  reconciliation: "ALL",
  varianceDirection: "",
  from: "",
  to: "",
  sort: "NEWEST",
  page: 1,
  pageSize: 10,
  search: "",
};
const statusLabels: Record<string, string> = { OPEN: "Đang mở", CLOSING: "Đang đối soát", CLOSED: "Đã đóng", CANCELLED: "Đã hủy" };
const paymentLabels: Record<string, string> = { CASH: "Tiền mặt", BANK_TRANSFER: "Chuyển khoản", CARD_EXTERNAL: "Thẻ", OTHER_EXTERNAL: "Khác" };

function money(value: Money, currency = "VND") {
  if (value == null) return "—";
  const zeroDecimal = ["VND", "JPY", "KRW"].includes(currency);
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: zeroDecimal ? 0 : 2 }).format(zeroDecimal ? value : value / 100);
}
function dateTime(value: string | null | undefined, timezone: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(value));
}
function timeOnly(value: string | null | undefined, timezone: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(value));
}
function duration(item: DirectoryItem) {
  const end = item.status === "CLOSED" && item.closedAt ? new Date(item.closedAt).getTime() : Date.now();
  const minutes = Math.max(0, Math.floor((end - new Date(item.openedAt).getTime()) / 60000));
  return `${Math.floor(minutes / 60)} giờ ${minutes % 60} phút`;
}
function queryString(filters: Filters, forApi = true) {
  const params = new URLSearchParams();
  const entries: Record<string, string | number> = {
    branchId: filters.branchId,
    registerId: filters.registerId,
    cashierUserId: filters.cashierUserId,
    status: filters.status,
    reconciliation: filters.reconciliation,
    varianceDirection: filters.varianceDirection,
    ...(forApi ? { businessDateFrom: filters.from, businessDateTo: filters.to } : { from: filters.from, to: filters.to }),
    sort: filters.sort,
    page: filters.page,
    pageSize: filters.pageSize,
    search: filters.search,
  };
  Object.entries(entries).forEach(([key, value]) => { if (value !== "" && value !== "ALL") params.set(key, String(value)); });
  return params.toString();
}
function readFilters(): Filters {
  if (typeof window === "undefined") return defaultFilters;
  const params = new URLSearchParams(window.location.search);
  const value = (key: string) => params.get(key) ?? "";
  return {
    ...defaultFilters,
    branchId: value("branchId") || getActiveBranchId() || "", registerId: value("registerId"), cashierUserId: value("cashierUserId"),
    status: value("status"), reconciliation: (value("reconciliation") as Filters["reconciliation"]) || "ALL",
    varianceDirection: (value("varianceDirection") as Filters["varianceDirection"]) || "",
    from: value("from") || value("businessDateFrom"), to: value("to") || value("businessDateTo"), search: value("search"),
    sort: (value("sort") as Filters["sort"]) || "NEWEST",
    page: Math.max(1, Number(value("page")) || 1), pageSize: [10, 20, 50].includes(Number(value("pageSize"))) ? Number(value("pageSize")) : 10,
  } as Filters;
}
function statusClass(value: string) {
  return value === "CLOSED" ? styles.closed : value === "CLOSING" ? styles.closing : styles.open;
}
function varianceClass(value: Money) {
  return value == null ? styles.muted : value === 0 ? styles.good : value < 0 ? styles.short : styles.over;
}
function errorMessage(body: ApiBody, fallback: string) { return body.error?.message ?? fallback; }

export default function CashSessionHistoryPage() {
  const [filters, setFilters] = useState<Filters>(readFilters);
  const [data, setData] = useState<DirectoryData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [online, setOnline] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const loadDirectory = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await authorizedFetch(`/v1/cash-sessions/directory?${queryString(filters)}`, { signal: controller.signal });
      const body = (await response.json().catch(() => ({}))) as ApiBody;
      if (!response.ok || !body.data) throw new Error(errorMessage(body, "Không thể tải lịch sử phiên thu ngân."));
      setData(body.data);
      setSelectedId((current) => current && body.data!.items.some((item) => item.id === current) ? current : body.data!.items[0]?.id ?? null);
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") setError((cause as Error).message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const update = () => setOnline(navigator.onLine);
      update(); window.addEventListener("online", update); window.addEventListener("offline", update);
      return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadDirectory(); }, filters.search ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [filters, loadDirectory]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = queryString(filters, false);
    window.history.replaceState(null, "", next ? `/admin/pos/cash-sessions?${next}` : "/admin/pos/cash-sessions");
  }, [filters]);
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    const controller = new AbortController();
    setDetailLoading(true); setDetailError("");
    void authorizedFetch(`/v1/cash-sessions/${encodeURIComponent(selectedId)}/overview?page=1&pageSize=10`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as { data?: Overview; error?: { message?: string } };
        if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Không thể tải chi tiết phiên.");
        setDetail(body.data);
      })
      .catch((cause) => { if ((cause as Error).name !== "AbortError") setDetailError((cause as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selectedId]);

  const dataReady = data !== null;
  useEffect(() => {
    if (!dataReady) return;
    const session = activeSession();
    if (!session.accessToken) return;
    const socket = io(`${session.api}/scheduling`, {
      auth: { token: session.accessToken },
      transports: ["websocket"],
    });
    const refresh = () => { void loadDirectory(); };
    ["cash_session.updated", "pos.order.updated"].forEach((event) => socket.on(event, refresh));
    return () => { socket.disconnect(); };
  }, [dataReady, loadDirectory]);

  const selected = useMemo(() => data?.items.find((item) => item.id === selectedId) ?? null, [data, selectedId]);
  const update = (patch: Partial<Filters>, resetPage = true) => setFilters((current) => ({ ...current, ...patch, page: resetPage ? 1 : patch.page ?? current.page }));
  const clear = () => setFilters(defaultFilters);
  const exportCsv = async () => {
    setExporting(true);
    try {
      const response = await authorizedFetch(`/v1/cash-sessions/export?${queryString(filters)}`);
      if (!response.ok) throw new Error("Không thể xuất dữ liệu phiên thu ngân.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "cash-session-history.csv"; anchor.click(); URL.revokeObjectURL(url);
    } catch (cause) { setError((cause as Error).message); } finally { setExporting(false); }
  };
  const hasFilters = Boolean(filters.search || filters.branchId || filters.registerId || filters.cashierUserId || filters.status || filters.reconciliation !== "ALL" || filters.varianceDirection || filters.from || filters.to || filters.sort !== "NEWEST");
  const isTodayScope = Boolean(filters.branchId && !filters.from && !filters.to);
  const pageStart = data && data.pagination.total ? (data.pagination.page - 1) * data.pagination.pageSize + 1 : 0;
  const pageEnd = data ? Math.min(data.pagination.total, data.pagination.page * data.pagination.pageSize) : 0;

  return <main className={styles.page}>
    {!online && <div className={styles.offline} role="status">Đang ngoại tuyến. Dữ liệu có thể chưa phải mới nhất.</div>}
    <header className={styles.pageHeader}>
      <div><p className={styles.breadcrumb}><a href="/admin/pos/registers">POS</a><b>/</b>Quầy thu ngân<b>/</b>Lịch sử phiên</p><h1>Lịch sử phiên thu ngân</h1><p className={styles.subtitle}>Tra cứu hoạt động quầy, doanh thu, tiền mặt và kết quả đối soát của từng phiên thu ngân.</p></div>
      <div className={styles.headerActions}><button className={styles.secondaryButton} type="button" onClick={() => void exportCsv()} disabled={exporting || !online}>⇩ &nbsp;{exporting ? "Đang xuất..." : "Xuất báo cáo"}</button><a className={styles.primaryButton} href="/admin/pos/cash-sessions/open">＋ &nbsp;Mở phiên thu ngân</a></div>
    </header>
    {error && <div className={styles.error} role="alert"><strong>Không thể tải lịch sử phiên.</strong><span>{error}</span><button type="button" onClick={() => void loadDirectory()}>Thử lại</button></div>}
    {loading && !data ? <LoadingState /> : <>
      <section className={styles.kpiGrid} aria-label="Tổng quan phiên thu ngân">
        <Kpi icon="▣" label={isTodayScope ? "Tổng số phiên hôm nay" : "Tổng số phiên trong bộ lọc"} value={String(data?.counts.total ?? 0)} note={`${data?.periodSummary.sessionCount ?? 0} phiên trong bộ lọc`} tone="rose" />
        <Kpi icon="▶" label="Phiên đang mở" value={String((data?.counts.open ?? 0) + (data?.counts.closing ?? 0))} note={`${data?.counts.open ?? 0} đang mở · ${data?.counts.closing ?? 0} đối soát`} tone="green" />
        <Kpi icon="✓" label="Phiên đã đóng" value={String(data?.counts.closed ?? 0)} note={`${data?.counts.matched ?? 0} phiên khớp`} tone="blue" />
        <Kpi icon="⌁" label="Doanh thu đã đối soát" value={money(data?.periodSummary.reconciledSalesMinor ?? 0)} note={`${data?.periodSummary.closedSessionCount ?? 0} phiên CLOSED`} tone="purple" />
        <Kpi icon="!" label="Phiên có chênh lệch" value={String(data?.counts.variance ?? 0)} note={money(data?.periodSummary.netVarianceMinor ?? 0)} tone="amber" />
      </section>
      <section className={styles.filterCard} aria-label="Bộ lọc lịch sử phiên">
        <div className={styles.filterRow}>
          <label className={styles.search}><span aria-hidden="true">⌕</span><span className={styles.srOnly}>Tìm kiếm phiên</span><input value={filters.search} onChange={(event) => update({ search: event.target.value })} placeholder="Tìm mã phiên / tên quầy / nhân viên..." /></label>
          <Field label="Chi nhánh"><select value={filters.branchId} onChange={(event) => update({ branchId: event.target.value, registerId: "" })}><option value="">Tất cả</option>{data?.facets.branches.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></Field>
          <Field label="Quầy thu ngân"><select value={filters.registerId} onChange={(event) => update({ registerId: event.target.value })}><option value="">Tất cả</option>{data?.facets.registers.filter((option) => !filters.branchId || option.branchId === filters.branchId).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></Field>
          <Field label="Nhân viên"><select value={filters.cashierUserId} onChange={(event) => update({ cashierUserId: event.target.value })}><option value="">Tất cả</option>{data?.facets.cashiers.map((option) => <option key={option.id} value={option.id}>{option.displayName}</option>)}</select></Field>
          <Field label="Trạng thái"><select value={filters.status} onChange={(event) => update({ status: event.target.value })}><option value="">Tất cả</option><option value="OPEN">Đang mở</option><option value="CLOSING">Đang đối soát</option><option value="CLOSED">Đã đóng</option></select></Field>
        </div>
        <div className={styles.filterRowSecondary}>
          <Field label="Từ ngày"><input type="date" value={filters.from} onChange={(event) => update({ from: event.target.value })} /></Field><Field label="Đến ngày"><input type="date" value={filters.to} onChange={(event) => update({ to: event.target.value })} /></Field>
          <Field label="Sắp xếp"><select value={filters.sort} onChange={(event) => update({ sort: event.target.value as Filters["sort"] })}><option value="NEWEST">Mới nhất</option><option value="OLDEST">Cũ nhất</option><option value="REVENUE_DESC">Doanh thu cao nhất</option><option value="REVENUE_ASC">Doanh thu thấp nhất</option><option value="VARIANCE_DESC">Chênh lệch lớn nhất</option></select></Field>
          <label className={styles.direction}><span>Hướng chênh lệch</span><select value={filters.varianceDirection} onChange={(event) => update({ varianceDirection: event.target.value as Filters["varianceDirection"] })}><option value="">Tất cả</option><option value="SHORT">Thiếu tiền</option><option value="OVER">Thừa tiền</option></select></label>
          <button className={styles.clearButton} type="button" onClick={clear} disabled={!hasFilters}>⌫ &nbsp;Xóa bộ lọc</button>
        </div>
        <div className={styles.chips} aria-label="Lọc nhanh theo đối soát">
          <button className={!filters.status && filters.reconciliation === "ALL" ? styles.chipActive : styles.chip} type="button" onClick={() => update({ status: "", reconciliation: "ALL", varianceDirection: "" })}>Tất cả</button>
          <button className={filters.status === "OPEN" ? styles.chipActive : styles.chip} type="button" onClick={() => update({ status: "OPEN", reconciliation: "ALL", varianceDirection: "" })}>● Đang mở</button>
          <button className={filters.status === "CLOSING" ? styles.chipActive : styles.chip} type="button" onClick={() => update({ status: "CLOSING", reconciliation: "ALL", varianceDirection: "" })}>◷ Đang đối soát</button>
          <button className={filters.status === "CLOSED" && filters.reconciliation === "ALL" ? styles.chipActive : styles.chip} type="button" onClick={() => update({ status: "CLOSED", reconciliation: "ALL", varianceDirection: "" })}>✓ Đã đóng</button>
          <button className={filters.reconciliation === "VARIANCE" ? styles.chipActive : styles.chip} type="button" onClick={() => update({ status: "CLOSED", reconciliation: "VARIANCE" })}>! Có chênh lệch</button>
          <button className={filters.reconciliation === "MATCHED" ? styles.chipActive : styles.chip} type="button" onClick={() => update({ status: "CLOSED", reconciliation: "MATCHED", varianceDirection: "" })}>✓ Khớp hoàn toàn</button>
        </div>
      </section>
      <div className={styles.workspace}>
        <section className={styles.mainColumn}>
          <div className={styles.tableCard}><div className={styles.cardHeader}><div><h2>Danh sách phiên thu ngân</h2><p>{pageStart}–{pageEnd} trong {data?.pagination.total ?? 0} phiên · dữ liệu server-side</p></div><button className={styles.refresh} type="button" onClick={() => void loadDirectory()} aria-label="Làm mới">↻</button></div>
            <div className={styles.tableWrap}><table><caption className={styles.srOnly}>Danh sách phiên thu ngân</caption><thead><tr><th scope="col">Mã phiên</th><th scope="col">Quầy</th><th scope="col">Nhân viên</th><th scope="col">Bắt đầu</th><th scope="col">Kết thúc</th><th scope="col">Giao dịch</th><th scope="col">Doanh thu</th><th scope="col">Dự kiến</th><th scope="col">Thực tế</th><th scope="col">Chênh lệch</th><th scope="col">Trạng thái</th><th scope="col">Thao tác</th></tr></thead><tbody>{data?.items.map((item) => <SessionRow key={item.id} item={item} selected={item.id === selectedId} onSelect={() => setSelectedId(item.id)} />)}</tbody></table>{!data?.items.length && <div className={styles.empty}><strong>Không tìm thấy phiên thu ngân phù hợp.</strong><span>Thử thay đổi bộ lọc hoặc xóa bộ lọc hiện tại.</span><button type="button" onClick={clear}>Xóa bộ lọc</button></div>}</div>
            <div className={styles.tableFooter}><span>Hiển thị {pageStart}–{pageEnd} trong {data?.pagination.total ?? 0} phiên thu ngân</span><div className={styles.pagination}><select aria-label="Số dòng mỗi trang" value={filters.pageSize} onChange={(event) => update({ pageSize: Number(event.target.value) }, false)}><option value={10}>10 / trang</option><option value={20}>20 / trang</option><option value={50}>50 / trang</option></select><button type="button" disabled={!data || filters.page <= 1} onClick={() => update({ page: filters.page - 1 }, false)}>‹</button><span>Trang {filters.page} / {data?.pagination.totalPages ?? 1}</span><button type="button" disabled={!data || filters.page >= (data.pagination.totalPages ?? 1)} onClick={() => update({ page: filters.page + 1 }, false)}>›</button></div></div>
          </div>
          <SummaryCards summary={data?.periodSummary} currency="VND" isTodayScope={isTodayScope} />
        </section>
        <HistoryRail item={selected} detail={detail} loading={detailLoading} error={detailError} />
      </div>
    </>}
  </main>;
}

function Kpi({ icon, label, value, note, tone }: { icon: string; label: string; value: string; note: string; tone: string }) { return <article className={styles.kpi}><span className={`${styles.kpiIcon} ${styles[`tone_${tone}`]}`}>{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></article>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className={styles.field}><span>{label}</span>{children}</label>; }
function StatusBadge({ item }: { item: DirectoryItem }) { return <span className={`${styles.status} ${statusClass(item.status)}`}>{statusLabels[item.status] ?? item.status}</span>; }
function ReconciliationBadge({ item }: { item: DirectoryItem }) { if (item.status !== "CLOSED") return null; return <span className={`${styles.reconciliation} ${item.reconciliation === "MATCHED" ? styles.reconciliationGood : styles.reconciliationWarning}`}>{item.reconciliation === "MATCHED" ? "Khớp" : "Có chênh lệch"}</span>; }
function SessionRow({ item, selected, onSelect }: { item: DirectoryItem; selected: boolean; onSelect: () => void }) {
  return <tr className={selected ? styles.selectedRow : undefined} aria-selected={selected} onClick={onSelect}><td><strong>{item.reference}</strong><small>{item.businessDate}</small></td><td><strong>{item.registerName}</strong><small>{item.registerCode}</small></td><td>{item.cashierDisplayName}</td><td>{timeOnly(item.openedAt, item.timezone)}</td><td>{timeOnly(item.closedAt, item.timezone)}</td><td>{item.transactionCount}</td><td>{money(item.sessionSalesMinor, item.currency)}</td><td>{money(item.expectedCashMinor, item.currency)}</td><td>{item.status === "CLOSING" && item.declaredCashMinor == null ? "Chưa kiểm đếm" : money(item.declaredCashMinor, item.currency)}</td><td><strong className={varianceClass(item.varianceMinor)}>{item.varianceMinor == null ? "—" : `${item.varianceMinor > 0 ? "+" : ""}${money(item.varianceMinor, item.currency)}`}</strong></td><td><div className={styles.statusStack}><StatusBadge item={item} /><ReconciliationBadge item={item} /></div></td><td><a className={styles.action} href={item.status === "CLOSING" ? `/admin/pos/cash-sessions/${item.id}/close` : `/admin/pos/cash-sessions/${item.id}`} onClick={(event) => event.stopPropagation()}>{item.status === "OPEN" ? "Mở phiên" : item.status === "CLOSING" ? "Tiếp tục" : "Xem chi tiết"} →</a></td></tr>;
}
function HistoryRail({ item, detail, loading, error }: { item: DirectoryItem | null; detail: Overview | null; loading: boolean; error: string }) {
  const mix = detail?.metrics.paymentMix ?? item?.paymentMix ?? null;
  const attention = detail?.attention ?? [];
  return <aside className={styles.rail} aria-label="Chi tiết phiên thu ngân">{!item ? <div className={styles.railEmpty}>Chọn một phiên để xem chi tiết.</div> : <>
    <section className={styles.railCard}><div className={styles.cardHeader}><div><h2>Chi tiết phiên</h2><p>{item.reference}</p></div><StatusBadge item={item} /></div><div className={styles.badgeLine}><ReconciliationBadge item={item} /></div><dl className={styles.details}><div><dt>Quầy</dt><dd>{item.registerName}</dd></div><div><dt>Nhân viên</dt><dd>{item.cashierDisplayName}</dd></div><div><dt>Ngày kinh doanh</dt><dd>{item.businessDate}</dd></div><div><dt>Bắt đầu</dt><dd>{dateTime(item.openedAt, item.timezone)}</dd></div><div><dt>Kết thúc</dt><dd>{dateTime(item.closedAt, item.timezone)}</dd></div><div><dt>Thời lượng</dt><dd>{duration(item)}</dd></div></dl><div className={styles.railActions}><a href={`/admin/pos/cash-sessions/${item.id}`}>Xem toàn bộ phiên</a>{item.status === "CLOSED" ? <a href={`/admin/pos/orders?cashSessionId=${item.id}`}>Xem giao dịch</a> : <a href={`/admin/pos/cash-sessions/${item.id}/close`}>{item.status === "OPEN" ? "Chuẩn bị đóng phiên" : "Tiếp tục đối soát"}</a>}</div></section>
    <section className={styles.railCard}><div className={styles.cardHeader}><h2>Tóm tắt tài chính</h2></div>{loading ? <div className={styles.railLoading}>Đang tải chi tiết...</div> : error ? <div className={styles.railError}>{error}</div> : <><dl className={styles.details}><div><dt>Doanh thu</dt><dd>{money(detail?.metrics.sessionSalesMinor ?? item.sessionSalesMinor, item.currency)}</dd></div><div><dt>Giao dịch</dt><dd>{item.transactionCount}</dd></div><div><dt>Tiền mặt đã thu</dt><dd>{money(detail?.metrics.cashCapturedMinor ?? item.cashCapturedMinor, item.currency)}</dd></div><div><dt>Hoàn tiền mặt</dt><dd>{money(detail?.cashFlow.cashRefundMinor ?? item.cashRefundMinor, item.currency)}</dd></div><div><dt>Tiền dự kiến</dt><dd>{money(item.expectedCashMinor, item.currency)}</dd></div><div><dt>Tiền thực tế</dt><dd>{money(item.declaredCashMinor, item.currency)}</dd></div></dl><div className={`${styles.railTotal} ${varianceClass(item.varianceMinor)}`}><span>Chênh lệch</span><strong>{item.varianceMinor == null ? "—" : `${item.varianceMinor > 0 ? "+" : ""}${money(item.varianceMinor, item.currency)}`}</strong></div></>}</section>
    <section className={styles.railCard}><div className={styles.cardHeader}><h2>Thanh toán trong phiên</h2></div>{mix ? <div className={styles.mix}>{Object.entries(mix).map(([type, value]) => <div key={type}><span><i className={`${styles.mixDot} ${styles[`mix_${type}`]}`} />{paymentLabels[type] ?? type}</span><strong>{money(value.amountMinor, item.currency)}</strong></div>)}</div> : <div className={styles.hidden}>Số liệu tài chính đang được bảo vệ theo chế độ blind count.</div>}</section>
    <section className={styles.railCard}><div className={styles.cardHeader}><div><h2>Ngoại lệ phiên</h2><p>{attention.length} sự kiện từ API</p></div><span className={styles.count}>{attention.length}</span></div>{attention.length ? <div className={styles.attention}>{attention.slice(0, 5).map((entry) => <div key={`${entry.code}-${entry.message}`}><b>!</b><span>{entry.message}</span><strong>{entry.amountMinor == null ? "" : money(entry.amountMinor, item.currency)}</strong></div>)}</div> : item.status === "CLOSED" && item.reconciliation === "VARIANCE" && item.varianceReason ? <div className={styles.explained}><b>✓</b><span>Chênh lệch đã được ghi nhận</span><small>{item.varianceReason}</small></div> : <div className={styles.hidden}>Không có ngoại lệ chưa xử lý.</div>}</section>
    <section className={styles.railCard}><div className={styles.cardHeader}><h2>Xác nhận đóng phiên</h2></div>{item.status === "CLOSED" ? <dl className={styles.details}><div><dt>Người đóng</dt><dd>{item.closedByDisplayName ?? "—"}</dd></div><div><dt>Đóng lúc</dt><dd>{dateTime(item.closedAt, item.timezone)}</dd></div><div><dt>Kiểm đếm</dt><dd>{item.declaredCashMinor == null ? "Chưa ghi nhận" : "Đã ghi nhận"}</dd></div><div><dt>Ghi chú</dt><dd>{item.varianceReason ? "Có" : "Không"}</dd></div><div><dt>Phê duyệt</dt><dd>{item.varianceApprovedByDisplayName ?? "Không yêu cầu"}</dd></div></dl> : <div className={styles.hidden}>Phiên chưa được đóng. Thao tác đối soát được kiểm soát ở màn đóng phiên.</div>}<div className={styles.railActions}><a href={`/admin/pos/cash-sessions/${item.id}`}>Xem chi tiết phiên</a>{item.status !== "CLOSED" && <a href={`/admin/pos/cash-sessions/${item.id}/close`}>Mở quy trình đóng</a>}</div></section>
  </>}</aside>;
}
function SummaryCards({ summary, currency, isTodayScope }: { summary: DirectoryData["periodSummary"] | undefined; currency: string; isTodayScope: boolean }) { return <div className={styles.summaryGrid}><section className={styles.summaryCard}><h2>{isTodayScope ? "Tổng kết phiên hôm nay" : "Tổng kết phiên trong bộ lọc"}</h2><div><strong>{summary?.sessionCount ?? 0}</strong><span>Tổng số phiên</span></div><div><strong>{summary?.transactionCount ?? 0}</strong><span>Tổng giao dịch</span></div><div><strong>{money(summary?.reconciledSalesMinor ?? 0, currency)}</strong><span>Doanh thu đối soát</span></div></section><section className={styles.summaryCard}><h2>Chênh lệch trong kỳ</h2><div><strong>{summary?.closedSessionCount ? `${Math.round(((summary.closedSessionCount - summary.shortSessionCount - summary.overSessionCount) / summary.closedSessionCount) * 100)}%` : "—"}</strong><span>Phiên khớp</span></div><div><strong>{summary?.shortSessionCount ?? 0}</strong><span>Phiên thiếu tiền</span></div><div><strong>{summary?.overSessionCount ?? 0}</strong><span>Phiên thừa tiền</span></div><div><strong className={varianceClass(summary?.netVarianceMinor ?? 0)}>{money(summary?.netVarianceMinor ?? 0, currency)}</strong><span>Tổng chênh lệch ròng</span></div></section></div>; }
function LoadingState() { return <><div className={styles.loadingKpis}>{[1, 2, 3, 4, 5].map((value) => <div key={value} />)}</div><div className={styles.loadingWorkspace}><div className={styles.loadingBlock} /><div className={styles.loadingBlock} /></div></>; }

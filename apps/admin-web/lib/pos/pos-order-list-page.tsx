"use client";

import { useEffect, useMemo, useState } from "react";
import { authorizedFetch, getActiveBranchId, getAuthorizedBranchContext, setActiveBranchId } from "../auth";
import styles from "./pos-order-list-page.module.css";

type Order = {
  id: string;
  orderNumber: string;
  source: string;
  status: string;
  customerDisplayName: string;
  customerPhone: string;
  bookingReference?: string | null;
  itemCount: number;
  itemSummary: Array<Record<string, unknown>>;
  paymentMethods: string[];
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  tipMinor: number;
  grandTotalMinor: number;
  amountPaidMinor: number;
  amountDueMinor: number;
  createdAt: string;
  paidAt?: string | null;
  cashier?: { userId: string; displayName: string } | null;
  invoice?: { id: string; invoiceNumber: string; status: string } | null;
  branchId: string;
  appointmentId?: string | null;
};

type Directory = {
  items: Order[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  counts: { total: number; byStatus: Record<string, number> };
  summary: { totalGrandTotalMinor: number; averageGrandTotalMinor: number };
};

type Financial = {
  totalCollectedMinor: number;
  orders: number;
  paymentMix: Record<string, { amountMinor: number; count: number }>;
};
type ApiBody = { data?: unknown; error?: { message?: string } };
type Detail = { lines?: unknown[] };
type CashSession = { cashierUserId?: string; openedAt?: string };

const STATUS_OPTIONS = [
  ["", "Tất cả"],
  ["DRAFT", "Đơn nháp"],
  ["READY_FOR_PAYMENT", "Chờ thanh toán"],
  ["PARTIALLY_PAID", "Thanh toán một phần"],
  ["PAID", "Đã thanh toán"],
  ["VOIDED", "Đã hủy"],
] as const;
const SOURCE_LABELS: Record<string, string> = {
  APPOINTMENT: "Lịch hẹn",
  WALK_IN: "Walk-in",
  COUNTER_SALE: "Bán lẻ",
  MANUAL: "Thủ công",
};
const STATUS_LABELS: Record<string, string> = Object.fromEntries(STATUS_OPTIONS.filter(([value]) => value).map(([value, label]) => [value, label]));
const TENDER_LABELS: Record<string, string> = {
  CASH: "Tiền mặt",
  CARD_EXTERNAL: "Thẻ",
  BANK_TRANSFER: "Chuyển khoản",
  OTHER_EXTERNAL: "Khác",
};

function money(value: number | undefined | null, currency = "VND") {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value ?? 0);
}
function dateTime(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function unwrap(body: ApiBody) {
  return body?.data;
}
async function getJson(path: string) {
  const response = await authorizedFetch(path);
  const body = (await response.json().catch(() => ({}))) as ApiBody;
  if (!response.ok) throw Object.assign(new Error(body?.error?.message ?? "Không thể tải dữ liệu."), { status: response.status });
  return unwrap(body);
}
function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  return params.toString();
}
function initialQueryValue(key: string, fallback = "") {
  if (typeof window === "undefined") return fallback;
  return new URLSearchParams(window.location.search).get(key) ?? fallback;
}
function initialQueryNumber(key: string, fallback: number, allowed?: readonly number[]) {
  const parsed = Number(initialQueryValue(key));
  return Number.isFinite(parsed) && (!allowed || allowed.includes(parsed)) ? parsed : fallback;
}

export default function PosOrderListPage() {
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [branchId, setBranchId] = useState(initialQueryValue("branchId", getActiveBranchId() ?? ""));
  const [searchDraft, setSearchDraft] = useState(() => initialQueryValue("search"));
  const [search, setSearch] = useState(() => initialQueryValue("search"));
  const [status, setStatus] = useState(() => initialQueryValue("status"));
  const [source, setSource] = useState(() => initialQueryValue("source"));
  const [tenderType, setTenderType] = useState(() => initialQueryValue("tenderType"));
  const [dateFrom, setDateFrom] = useState(() => initialQueryValue("dateFrom"));
  const [dateTo, setDateTo] = useState(() => initialQueryValue("dateTo"));
  const [sort, setSort] = useState(() => initialQueryValue("sort", "NEWEST"));
  const [page, setPage] = useState(() => initialQueryNumber("page", 1));
  const [pageSize, setPageSize] = useState(() => initialQueryNumber("pageSize", 10, [10, 20, 50, 100]));
  const [view, setView] = useState<"list" | "cards">("list");
  const [directory, setDirectory] = useState<Directory>();
  const [financial, setFinancial] = useState<Financial>();
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedDetail, setSelectedDetail] = useState<Detail>();
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [financialNote, setFinancialNote] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearch(searchDraft.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    const query = queryString({ branchId, search, status, source, tenderType, dateFrom, dateTo, sort, page, pageSize });
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (nextUrl !== currentUrl) window.history.replaceState(null, "", nextUrl);
  }, [branchId, search, status, source, tenderType, dateFrom, dateTo, sort, page, pageSize]);

  useEffect(() => {
    void getAuthorizedBranchContext().then((result) => {
      setBranches(result.branches);
      setBranchId(result.branchId ?? "");
    }).catch(() => setError("Không thể tải thông tin chi nhánh."));
    const onBranchChanged = (event: Event) => setBranchId((event as CustomEvent<string | undefined>).detail ?? "");
    window.addEventListener("nailsoft:active-branch-change", onBranchChanged);
    return () => window.removeEventListener("nailsoft:active-branch-change", onBranchChanged);
  }, []);

  const directoryPath = useMemo(() => {
    const query = queryString({ branchId, search, status, source, tenderType, dateFrom, dateTo, sort, page, pageSize });
    return `/v1/pos-orders/directory${query ? `?${query}` : ""}`;
  }, [branchId, search, status, source, tenderType, dateFrom, dateTo, sort, page, pageSize]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void getJson(directoryPath).then((value) => {
      if (!active) return;
      setDirectory(value as Directory);
      setSelected((current) => current.filter((id) => (value as Directory).items.some((item) => item.id === id)));
      setSelectedId((current) => current && (value as Directory).items.some((item) => item.id === current) ? current : (value as Directory).items[0]?.id);
    }).catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : "Request failed")).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [directoryPath]);

  useEffect(() => {
    if (!branchId) {
      setFinancial(undefined);
      return;
    }
    let active = true;
    const businessDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
    void getJson(`/v1/financial/reconciliation/daily?${queryString({ branchId, businessDate })}`).then((value) => active && setFinancial(value as Financial)).catch((reason: unknown) => {
      if (active && typeof reason === "object" && reason !== null && "status" in reason && reason.status === 403) setFinancialNote("Financial reconciliation permission is unavailable; list KPIs remain active.");
    });
    return () => { active = false; };
  }, [branchId]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedDetail(undefined);
      return;
    }
    let active = true;
    setDetailLoading(true);
    void getJson(`/v1/pos-orders/${selectedId}`).then((value) => active && setSelectedDetail(value as Detail)).catch(() => active && setSelectedDetail(undefined)).finally(() => active && setDetailLoading(false));
    return () => { active = false; };
  }, [selectedId]);

  const items = directory?.items ?? [];
  const branchName = branchId ? (branches.find((branch) => branch.id === branchId)?.name ?? "Chi nhánh hiện tại") : "Tất cả chi nhánh";
  const counts = directory?.counts.byStatus ?? {};
  const selectedOrder = items.find((item) => item.id === selectedId);
  const allOnPageSelected = items.length > 0 && items.every((item) => selected.includes(item.id));
  const paidToday = financial?.totalCollectedMinor ?? 0;
  const paymentMixTotal = financial ? Object.values(financial.paymentMix).reduce((sum, item) => sum + Number(item.amountMinor), 0) : 0;

  function changeBranch(next: string) {
    setBranchId(next);
    setActiveBranchId(next || undefined);
    setPage(1);
  }
  function toggleSelection(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }
  function selectPage() {
    setSelected((current) => allOnPageSelected ? current.filter((id) => !items.some((item) => item.id === id)) : Array.from(new Set([...current, ...items.map((item) => item.id)])));
  }
  function resetFilters() {
    setSearchDraft(""); setSearch(""); setStatus(""); setSource(""); setTenderType(""); setDateFrom(""); setDateTo(""); setSort("NEWEST"); setPage(1);
  }
  const navigateTo = (path: string) => { window.location.href = path; };

  return (
    <main className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <p className={styles.breadcrumb}><span>POS</span><b>/</b> Danh sách đơn hàng</p>
          <h1>Đơn hàng POS</h1>
          <p className={styles.subtitle}>Theo dõi giao dịch bán hàng, trạng thái thanh toán và các đơn đang cần xử lý tại salon.</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.secondaryButton} type="button" onClick={() => downloadExport(directoryPath)}><span>⇩</span> Xuất báo cáo</button>
          <button className={styles.primaryButton} type="button" onClick={() => setDialogOpen(true)}><span>＋</span> Tạo đơn mới</button>
        </div>
      </div>

      <section className={styles.kpiGrid} aria-label="Chỉ số POS">
        <Kpi label="Doanh thu hôm nay" value={financial ? money(paidToday) : "—"} detail={financial ? `${financial.orders} đơn đã phát hành` : financialNote || "Đang chờ quyền đối soát"} tone="red" icon="$" />
        <Kpi label="Đơn hôm nay" value={financial ? String(financial.orders) : "—"} detail="Theo kỳ kinh doanh hiện tại" tone="pink" icon="▣" />
        <Kpi label="Chờ thanh toán" value={String((counts.READY_FOR_PAYMENT ?? 0) + (counts.PARTIALLY_PAID ?? 0))} detail="Cần tiếp tục thu tiền" tone="amber" icon="◷" />
        <Kpi label="Đã thanh toán" value={String(counts.PAID ?? 0)} detail="Đơn có trạng thái PAID" tone="green" icon="✓" />
        <Kpi label="Giá trị đơn trung bình" value={directory ? money(directory.summary.averageGrandTotalMinor) : "—"} detail="Trên bộ lọc hiện tại" tone="red" icon="◈" />
      </section>

      <div className={styles.workspace}>
        <section className={styles.mainColumn}>
          <section className={styles.filterCard} aria-label="Bộ lọc đơn hàng">
            <div className={styles.filterRow}>
              <label className={styles.searchField}><span>⌕</span><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Tìm mã đơn / khách hàng / SĐT / mã lịch hẹn..." aria-label="Tìm kiếm đơn hàng" /></label>
              <Select label="Chi nhánh" value={branchId} onChange={changeBranch} options={[["", "Tất cả"] as const, ...branches.map((branch) => [branch.id, branch.name] as const)]} />
              <Select label="Trạng thái" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={STATUS_OPTIONS} />
              <Select label="Nguồn đơn" value={source} onChange={(value) => { setSource(value); setPage(1); }} options={[["", "Tất cả"], ["APPOINTMENT", "Lịch hẹn"], ["WALK_IN", "Walk-in"], ["COUNTER_SALE", "Bán lẻ"], ["MANUAL", "Thủ công"]]} />
              <Select label="Thanh toán" value={tenderType} onChange={(value) => { setTenderType(value); setPage(1); }} options={[["", "Tất cả"], ["CASH", "Tiền mặt"], ["CARD_EXTERNAL", "Thẻ"], ["BANK_TRANSFER", "Chuyển khoản"], ["OTHER_EXTERNAL", "Khác"]]} />
              <div className={styles.dateRange} aria-label="Khoảng ngày">
                <label><span>Từ ngày</span><input type="date" value={dateFrom} onInput={(event) => { setDateFrom(event.currentTarget.value); setPage(1); }} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} aria-label="Từ ngày" /></label>
                <label><span>Đến ngày</span><input type="date" value={dateTo} onInput={(event) => { setDateTo(event.currentTarget.value); setPage(1); }} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} aria-label="Đến ngày" /></label>
              </div>
            </div>
            <div className={styles.filterFooter}>
              <div className={styles.chips}>
                {STATUS_OPTIONS.map(([value, label]) => <button type="button" key={label} className={`${styles.filterChip} ${status === value ? styles.filterChipActive : ""}`} onClick={() => { setStatus(value); setPage(1); }}><i className={value ? `statusDot ${styles[`dot_${value}`] ?? ""}` : "statusDot"} />{label}{value ? <small>{counts[value] ?? 0}</small> : null}</button>)}
              </div>
              <div className={styles.viewControls}>
                <Select label="Sắp xếp" value={sort} onChange={(value) => { setSort(value); setPage(1); }} options={[["NEWEST", "Mới nhất"], ["OLDEST", "Cũ nhất"], ["AMOUNT_DESC", "Giá trị cao"], ["AMOUNT_ASC", "Giá trị thấp"]]} />
                <div className={styles.viewToggle} role="group" aria-label="Kiểu hiển thị"><button className={view === "list" ? styles.toggleActive : ""} onClick={() => setView("list")} type="button">☷ Danh sách</button><button className={view === "cards" ? styles.toggleActive : ""} onClick={() => setView("cards")} type="button">▦ Thẻ</button></div>
              </div>
            </div>
          </section>

          <section className={styles.tableCard}>
            <div className={styles.tableHeader}><h2>Danh sách đơn hàng</h2>{selected.length > 0 ? <div className={styles.selectionBar}><strong>{selected.length} đơn đã chọn</strong><button type="button" onClick={() => downloadExport(directoryPath)}>⇩ Xuất dữ liệu</button><button type="button" disabled={!selected.every((id) => items.find((item) => item.id === id)?.invoice?.status === "ISSUED")} title="Chỉ in được biên nhận đã phát hành">▣ In biên nhận</button></div> : null}</div>
            {error ? <div className={styles.error} role="alert"><strong>Không thể tải danh sách.</strong> {error}<button type="button" onClick={() => window.location.reload()}>Thử lại</button></div> : null}
            {loading ? <div className={styles.loading}>Đang tải dữ liệu đơn hàng…</div> : view === "cards" ? <CardList items={items} selectedId={selectedId} onSelect={setSelectedId} /> : <OrderTable items={items} selected={selected} selectedId={selectedId} allSelected={allOnPageSelected} onSelect={setSelectedId} onToggle={toggleSelection} onSelectPage={selectPage} navigateTo={navigateTo} />}
            {!loading && !error && items.length === 0 ? <div className={styles.empty}><strong>Chưa có đơn hàng phù hợp</strong><span>Thử bỏ bớt bộ lọc hoặc tạo đơn từ một lịch hẹn có thật.</span><button type="button" onClick={resetFilters}>Xóa bộ lọc</button></div> : null}
            <Pagination page={directory?.pagination.page ?? page} totalPages={directory?.pagination.totalPages ?? 1} pageSize={pageSize} total={directory?.pagination.total ?? 0} onPage={setPage} onPageSize={(value) => { setPageSize(value); setPage(1); }} />
          </section>
        </section>

        <aside className={styles.rail} aria-label="Chi tiết POS">
          <DetailCard order={selectedOrder} detail={selectedDetail} loading={detailLoading} navigateTo={navigateTo} />
          <NeedsActionCard items={items} totalCount={(counts.DRAFT ?? 0) + (counts.READY_FOR_PAYMENT ?? 0) + (counts.PARTIALLY_PAID ?? 0)} navigateTo={navigateTo} />
          <CashSessionCard branchId={branchId} branchName={branchName} navigateTo={navigateTo} />
          <PaymentMixCard financial={financial} total={paymentMixTotal} />
        </aside>
      </div>

      {dialogOpen ? <NewOrderDialog onClose={() => setDialogOpen(false)} navigateTo={navigateTo} /> : null}
    </main>
  );
}

function Kpi({ label, value, detail, tone, icon }: { label: string; value: string; detail: string; tone: string; icon: string }) {
  return <article className={`${styles.kpi} ${styles[`kpi_${tone}`]}`}><span className={styles.kpiIcon}>{icon}</span><div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div></article>;
}
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: ReadonlyArray<readonly [string, string]> }) {
  return <label className={styles.selectField}><span>{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([optionValue, optionLabel]) => <option key={`${label}-${optionValue}`} value={optionValue}>{optionLabel}</option>)}</select></label>;
}
function itemNames(summary: Record<string, unknown>) {
  const value = summary.name ?? summary.displayName ?? summary.serviceName;
  return typeof value === "string" ? value : "";
}
function orderActionPath(order: Order) {
  if (order.status === "DRAFT") return `/admin/pos/orders/${order.id}`;
  if (order.status === "READY_FOR_PAYMENT" || order.status === "PARTIALLY_PAID") return `/admin/pos/orders/${order.id}/payment`;
  return `/admin/pos/orders/${order.id}`;
}
function orderActionLabel(order: Order) {
  if (order.status === "DRAFT") return "Tiếp tục";
  if (order.status === "READY_FOR_PAYMENT") return "Thu tiền";
  if (order.status === "PARTIALLY_PAID") return "Tiếp tục thanh toán";
  return "Xem đơn";
}
function OrderTable({ items, selected, selectedId, allSelected, onSelect, onToggle, onSelectPage, navigateTo }: { items: Order[]; selected: string[]; selectedId: string | undefined; allSelected: boolean; onSelect: (id: string) => void; onToggle: (id: string) => void; onSelectPage: () => void; navigateTo: (path: string) => void }) {
  return <div className={styles.tableScroll}><table><thead><tr><th scope="col"><input type="checkbox" checked={allSelected} onChange={onSelectPage} aria-label="Chọn tất cả đơn trên trang" /></th><th scope="col">Mã đơn</th><th scope="col">Thời gian</th><th scope="col">Khách hàng</th><th scope="col">Nguồn</th><th scope="col">Dịch vụ / sản phẩm</th><th scope="col">Tổng tiền</th><th scope="col">Thanh toán</th><th scope="col">Trạng thái</th><th scope="col">Thu ngân</th><th scope="col">Thao tác</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className={selectedId === item.id ? styles.rowSelected : ""} onClick={() => onSelect(item.id)}><td onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} aria-label={`Chọn ${item.orderNumber}`} /></td><td><strong className={styles.orderNumber}>{item.orderNumber}</strong></td><td>{dateTime(item.createdAt)}</td><td><strong>{item.customerDisplayName}</strong><small>{item.customerPhone || "—"}</small></td><td><span className={styles.sourceTag}>{SOURCE_LABELS[item.source] ?? item.source}</span>{item.bookingReference ? item.appointmentId ? <a href={`/admin/appointments/${item.appointmentId}/overview`} onClick={(event) => event.stopPropagation()}><small>{item.bookingReference}</small></a> : <small>{item.bookingReference}</small> : null}</td><td><span>{item.itemCount} dịch vụ</span><small>{item.itemSummary.map(itemNames).filter(Boolean).slice(0, 2).join(", ") || "—"}</small></td><td><strong>{money(item.grandTotalMinor)}</strong>{item.tipMinor ? <small>Tip {money(item.tipMinor)}</small> : null}</td><td>{item.paymentMethods.length ? item.paymentMethods.map((method) => TENDER_LABELS[method] ?? method).join(" + ") : "—"}{item.amountDueMinor > 0 ? <small>Còn {money(item.amountDueMinor)}</small> : null}</td><td><span className={`${styles.statusBadge} ${styles[`status_${item.status}`] ?? ""}`}>{STATUS_LABELS[item.status] ?? item.status}</span></td><td>{item.cashier?.displayName || "—"}</td><td><div className={styles.rowActions}><button type="button" aria-label={`Xem chi tiết ${item.orderNumber}`} onClick={(event) => { event.stopPropagation(); onSelect(item.id); }}>◉</button>{["DRAFT", "READY_FOR_PAYMENT", "PARTIALLY_PAID"].includes(item.status) ? <button type="button" aria-label={`${orderActionLabel(item)} ${item.orderNumber}`} onClick={(event) => { event.stopPropagation(); navigateTo(orderActionPath(item)); }}>▣</button> : null}{item.status === "PAID" && item.invoice?.status === "ISSUED" ? <button type="button" aria-label={`Mở biên nhận ${item.orderNumber}`} onClick={(event) => { event.stopPropagation(); navigateTo(`/admin/pos/orders/${item.id}/receipt`); }}>▣</button> : null}<button type="button" aria-label={`Thao tác khác cho đơn ${item.orderNumber}`} onClick={(event) => event.stopPropagation()}>…</button></div></td></tr>)}</tbody></table></div>;
}
function CardList({ items, selectedId, onSelect }: { items: Order[]; selectedId: string | undefined; onSelect: (id: string) => void }) {
  return <div className={styles.cardList}>{items.map((item) => <button type="button" key={item.id} className={`${styles.orderCard} ${selectedId === item.id ? styles.orderCardSelected : ""}`} onClick={() => onSelect(item.id)}><span className={styles.cardTop}><strong>{item.orderNumber}</strong><span className={`${styles.statusBadge} ${styles[`status_${item.status}`] ?? ""}`}>{STATUS_LABELS[item.status] ?? item.status}</span></span><span className={styles.cardCustomer}>{item.customerDisplayName}</span><span>{item.itemCount} dịch vụ · {dateTime(item.createdAt)}</span><strong>{money(item.grandTotalMinor)}</strong></button>)}</div>;
}
function Pagination({ page, totalPages, pageSize, total, onPage, onPageSize }: { page: number; totalPages: number; pageSize: number; total: number; onPage: (page: number) => void; onPageSize: (pageSize: number) => void }) {
  return <div className={styles.pagination}><span>Hiển thị {total === 0 ? 0 : (page - 1) * pageSize + 1} – {Math.min(page * pageSize, total)} trong {total} đơn hàng</span><div><select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))} aria-label="Số đơn mỗi trang"><option value={10}>10 / trang</option><option value={20}>20 / trang</option><option value={50}>50 / trang</option><option value={100}>100 / trang</option></select><button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹</button><span>Trang {page} / {totalPages}</span><button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>›</button></div></div>;
}
function DetailCard({ order, detail, loading, navigateTo }: { order: Order | undefined; detail: Detail | undefined; loading: boolean; navigateTo: (path: string) => void }) {
  if (!order) return <section className={styles.railCard}><h2>Chi tiết đơn hàng</h2><div className={styles.railEmpty}>Chọn một đơn hàng để xem chi tiết.</div></section>;
  return <section className={styles.railCard}><div className={styles.railTitle}><h2>Chi tiết đơn hàng</h2><span className={`${styles.statusBadge} ${styles[`status_${order.status}`] ?? ""}`}>{STATUS_LABELS[order.status] ?? order.status}</span></div><strong className={styles.railOrderNumber}>{order.orderNumber}</strong><div className={styles.customerLine}><span className={styles.avatar}>{order.customerDisplayName.slice(0, 1)}</span><div><strong>{order.customerDisplayName}</strong><small>{order.customerPhone || "Khách vãng lai"}</small></div></div><dl className={styles.detailList}><div><dt>Dịch vụ</dt><dd>{order.itemCount} dịch vụ</dd></div><div><dt>Tổng tiền</dt><dd>{money(order.grandTotalMinor)}</dd></div><div><dt>Đã thanh toán</dt><dd>{money(order.amountPaidMinor)}</dd></div><div><dt>Thu ngân</dt><dd>{order.cashier?.displayName || "Chưa ghi nhận"}</dd></div><div><dt>Nguồn đơn</dt><dd>{SOURCE_LABELS[order.source] ?? order.source}</dd></div></dl>{loading ? <small className={styles.muted}>Đang tải chi tiết chính thức…</small> : detail?.lines ? <small className={styles.muted}>{detail.lines.length} line trong read-model chi tiết</small> : null}<div className={styles.railActions}><button type="button" onClick={() => navigateTo(`/admin/pos/orders/${order.id}`)}>Xem giao dịch</button>{order.invoice?.status === "ISSUED" ? <button type="button" onClick={() => navigateTo(`/admin/pos/orders/${order.id}/receipt`)}>Biên nhận</button> : null}</div></section>;
}
function NeedsActionCard({ items, totalCount, navigateTo }: { items: Order[]; totalCount: number; navigateTo: (path: string) => void }) {
  const pending = items.filter((item) => ["DRAFT", "READY_FOR_PAYMENT", "PARTIALLY_PAID"].includes(item.status)).slice(0, 4);
  return <section className={styles.railCard}><div className={styles.railTitle}><h2>Cần xử lý</h2><span className={styles.countBadge}>{totalCount}</span></div>{pending.length ? pending.map((item) => <button type="button" className={styles.actionRow} key={item.id} onClick={() => navigateTo(orderActionPath(item))}><span><strong>{item.orderNumber}</strong><small>{item.customerDisplayName}</small></span><span><b>{orderActionLabel(item)}</b><em>{item.status === "PARTIALLY_PAID" ? "Thanh toán một phần" : "Chờ thanh toán"}</em></span><i>›</i></button>) : <div className={styles.railEmpty}>Không có đơn cần xử lý trong trang hiện tại.</div>}<button className={styles.textLink} type="button" onClick={() => navigateTo("/admin/pos/orders?status=READY_FOR_PAYMENT")}>Xem tất cả →</button></section>;
}
function CashSessionCard({ branchId, branchName, navigateTo }: { branchId: string; branchName: string; navigateTo: (path: string) => void }) {
  const [session, setSession] = useState<CashSession>();
  useEffect(() => { if (!branchId) { setSession(undefined); return; } let active = true; void getJson(`/v1/cash-sessions?${queryString({ branchId, status: "OPEN" })}`).then((value) => active && setSession(Array.isArray(value) ? value[0] : undefined)).catch(() => active && setSession(undefined)); return () => { active = false; }; }, [branchId]);
  return <section className={styles.railCard}><div className={styles.railTitle}><h2>Phiên thu ngân</h2><span className={session ? styles.liveBadge : styles.neutralBadge}>{session ? "Đang mở" : "Chưa mở"}</span></div><dl className={styles.detailList}><div><dt>Chi nhánh</dt><dd>{branchName}</dd></div>{session ? <><div><dt>Thu ngân</dt><dd>{session.cashierUserId ? "Đã đăng nhập" : "—"}</dd></div><div><dt>Mở lúc</dt><dd>{dateTime(session.openedAt)}</dd></div></> : <div><dt>Trạng thái</dt><dd>Chưa có phiên OPEN</dd></div>}</dl><button className={styles.fullButton} type="button" onClick={() => navigateTo("/admin/pos/cash-sessions")}>Xem phiên thu ngân</button></section>;
}
function PaymentMixCard({ financial, total }: { financial: Financial | undefined; total: number }) {
  return <section className={styles.railCard}><h2>Thanh toán hôm nay</h2>{financial ? Object.entries(financial.paymentMix).filter(([, value]) => value.amountMinor > 0).map(([key, value]) => <div className={styles.mixRow} key={key}><span><i className={`${styles.mixDot} ${styles[`mix_${key}`] ?? ""}`} />{TENDER_LABELS[key] ?? key}</span><span>{total ? Math.round(value.amountMinor / total * 100) : 0}%</span><strong>{money(value.amountMinor)}</strong></div>) : <div className={styles.railEmpty}>Chưa có quyền hoặc dữ liệu đối soát hôm nay.</div>}</section>;
}
function NewOrderDialog({ onClose, navigateTo }: { onClose: () => void; navigateTo: (path: string) => void }) {
  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={onClose}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="new-order-title" onMouseDown={(event) => event.stopPropagation()}><button className={styles.modalClose} type="button" onClick={onClose} aria-label="Đóng">×</button><p className={styles.breadcrumb}><span>POS</span><b>/</b> Quy trình tạo đơn</p><h2 id="new-order-title">Tạo đơn mới</h2><p className={styles.subtitle}>Chọn nguồn dữ liệu thật để bắt đầu, hệ thống sẽ chuyển bạn sang quy trình tương ứng.</p><div className={styles.workflowGrid}><button type="button" onClick={() => navigateTo("/admin/appointments/new")}><strong>Lịch hẹn</strong><span>Tạo từ khách hàng và dịch vụ đã đặt.</span><b>Đi tới lịch hẹn →</b></button><button type="button" onClick={() => navigateTo("/admin/operations/walk-ins/new")}><strong>Walk-in</strong><span>Mở quy trình tiếp nhận khách vãng lai.</span><b>Đi tới walk-in →</b></button></div><div className={styles.dialogNote}>Không tạo generic POS order ở đây nếu chưa có nguồn nghiệp vụ tương ứng.</div></section></div>;
}
async function downloadExport(path: string) {
  const response = await authorizedFetch(path.replace("/directory", "/directory/export"));
  if (!response.ok) return;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = "pos-orders.csv"; anchor.click(); URL.revokeObjectURL(url);
}

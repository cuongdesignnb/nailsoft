/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Icon as UiIcon } from "@nailsoft/ui-web";
import {
  ACTIVE_BRANCH_CHANGED_EVENT,
  authorizedFetch,
  getActiveBranchId,
  getAuthorizedBranchContext,
  getAuthContext,
  setActiveBranchId,
} from "../auth";
import styles from "./employee-commission-page.module.css";

type Period = {
  id: string;
  code: string;
  startDate: string;
  endDate: string;
  status: "OPEN" | "REVIEW" | "LOCKED";
  currency: string;
  version: number;
  reviewStartedAt?: string | null;
  lockedAt?: string | null;
};
type Branch = { id: string; name: string; code?: string; status?: string };
type StaffItem = {
  staffId: string;
  staffName: string;
  employeeCode?: string | null;
  roleLabel?: string | null;
  serviceCount: number;
  eligibleBaseMinor: number;
  earningMinor: number;
  refundReversalMinor: number;
  manualAdjustmentMinor: number;
  payableMinor: number;
  grossTipMinor: number;
  refundedTipMinor: number;
  netTipMinor: number;
  adjustmentCount: number;
  periodStatus: Period["status"];
  rank: number;
  currency: string;
};
type Overview = {
  period: Period & { totals?: Record<string, unknown> };
  totals: {
    eligibleBaseMinor: number;
    earningMinor: number;
    refundReversalMinor: number;
    manualAdjustmentMinor: number;
    payableMinor: number;
    grossTipMinor: number;
    refundedTipMinor: number;
    netTipMinor: number;
    staffCount: number;
    serviceCount: number;
  };
  sources: {
    earningMinor: number;
    refundReversalMinor: number;
    manualAdjustmentMinor: number;
    netTipMinor: number;
  };
  readiness: {
    canStartReview: boolean;
    canLock: boolean;
    blockers: Array<{ code: string; message: string; count: number }>;
    warnings: Array<{ code: string; message: string }>;
  };
  ranking: Array<{
    staffId: string;
    staffName: string;
    eligibleBaseMinor: number;
    earningMinor: number;
    payableMinor: number;
    currency: string;
  }>;
};
type Directory = {
  items: StaffItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  counts: { total: number; withAdjustment: number };
};
type Detail = {
  period: Period;
  staff: { staffId: string; staffName: string; employeeCode?: string | null; roleLabel?: string | null };
  summary: StaffItem;
  entries: Array<{
    id: string;
    entryType: string;
    businessDate: string;
    commissionMinor: number;
    baseMinor: number;
    currency: string;
    invoiceId: string;
    refundId?: string | null;
    ruleSnapshot?: Record<string, unknown>;
  }>;
  ruleEvidence: Array<Record<string, unknown>>;
  adjustments: Array<{ id: string; amountMinor: number; currency: string; reasonCode: string; note: string; status: string; createdAt: string }>;
};
type AuthContext = Awaited<ReturnType<typeof getAuthContext>>;
type Filters = { branchId: string; search: string; adjustment: string; sort: string; page: number; pageSize: number };

const EMPTY_FILTERS: Filters = { branchId: "", search: "", adjustment: "ALL", sort: "REVENUE_DESC", page: 1, pageSize: 10 };

function unwrap(body: any) { return body?.data; }
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authorizedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message ?? "Không thể tải dữ liệu hoa hồng.");
  return unwrap(body) as T;
}
function money(value: number | null | undefined, currency = "VND") {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value ?? 0);
}
function dateLabel(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}
function dateTime(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function initials(name: string) { return name.trim().split(/\s+/).slice(-2).map((part) => part[0]).join("").toUpperCase() || "?"; }
function periodStatusLabel(status: Period["status"]) { return { OPEN: "Đang mở", REVIEW: "Đang rà soát", LOCKED: "Đã khóa" }[status]; }
function statusTone(status: Period["status"]) { return status === "LOCKED" ? "green" : status === "REVIEW" ? "amber" : "rose"; }
function entryTypeLabel(type: string) {
  return { EARNING: "Phát sinh", REFUND_REVERSAL: "Hoàn tiền", LOCKED_PERIOD_REFUND_ADJUSTMENT: "Điều chỉnh kỳ đã khóa", MANUAL_ADJUSTMENT: "Điều chỉnh thủ công" }[type] ?? type;
}

function Badge({ tone, children }: { tone: "green" | "amber" | "rose" | "blue" | "gray"; children: ReactNode }) {
  return <span className={`${styles.badge} ${styles[`badge${tone[0]!.toUpperCase()}${tone.slice(1)}`]}`}>{children}</span>;
}
function Kpi({ icon, label, value, meta, tone = "rose" }: { icon: "wallet" | "trend" | "gift" | "people" | "transfer"; label: string; value: string; meta?: string; tone?: string }) {
  return <article className={`${styles.kpi} ${styles[`kpi${tone[0]!.toUpperCase()}${tone.slice(1)}`]}`}><span className={styles.kpiIcon}><UiIcon name={icon} /></span><div><div className={styles.kpiLabel}>{label}</div><strong className={styles.kpiValue}>{value}</strong>{meta ? <div className={styles.kpiMeta}>{meta}</div> : null}</div></article>;
}
function KeyValue({ label, value, strong = true }: { label: string; value: ReactNode; strong?: boolean }) {
  return <div className={styles.keyValue}><span>{label}</span>{strong ? <strong>{value}</strong> : <span>{value}</span>}</div>;
}

export default function EmployeeCommissionPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [context, setContext] = useState<AuthContext>();
  const [periodId, setPeriodId] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [overview, setOverview] = useState<Overview>();
  const [directory, setDirectory] = useState<Directory>();
  const [detail, setDetail] = useState<Detail>();
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [action, setAction] = useState<"REVIEW" | "LOCK" | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const updateUrl = useCallback((changes: Record<string, string | number | undefined>) => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    Object.entries(changes).forEach(([key, value]) => {
      if (value === undefined || value === "") params.delete(key);
      else params.set(key, String(value));
    });
    window.history.replaceState(null, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`);
  }, []);
  const updateFilters = useCallback((changes: Partial<Filters>, resetPage = true) => {
    setFilters((current) => {
      const next = { ...current, ...changes, ...(resetPage ? { page: 1 } : {}) };
      updateUrl({ ...next, periodId });
      return next;
    });
  }, [periodId, updateUrl]);

  const loadPeriods = useCallback(async () => {
    const value = await api<Period[]>("/v1/commission-periods");
    setPeriods(value ?? []);
    setPeriodId((current) => {
      if (current && value.some((period) => period.id === current)) return current;
      const fromUrl = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("periodId") : "";
      const selected = value.find((period) => period.id === fromUrl) ?? value[0];
      if (selected) updateUrl({ periodId: selected.id });
      return selected?.id ?? "";
    });
  }, [updateUrl]);

  useEffect(() => {
    let active = true;
    void Promise.all([getAuthorizedBranchContext(), loadPeriods()]).then(([branchContext]) => {
      if (!active) return;
      setContext(branchContext.context);
      setBranches(branchContext.branches as Branch[]);
      setFilters((current) => ({ ...current, branchId: current.branchId || branchContext.branchId || getActiveBranchId() || "" }));
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Không thể tải quyền truy cập."); });
    const onBranchChange = () => {
      void getAuthorizedBranchContext().then((branchContext) => {
        setContext(branchContext.context);
        setBranches(branchContext.branches as Branch[]);
        const branchId = branchContext.branchId ?? "";
        setFilters((current) => ({ ...current, branchId, page: 1 }));
        updateUrl({ branchId, page: 1 });
      }).catch(() => undefined);
    };
    window.addEventListener(ACTIVE_BRANCH_CHANGED_EVENT, onBranchChange);
    return () => { active = false; window.removeEventListener(ACTIVE_BRANCH_CHANGED_EVENT, onBranchChange); };
  }, [loadPeriods, updateUrl]);

  useEffect(() => {
    if (!periodId) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (filters.branchId) params.set("branchId", filters.branchId);
    const directoryParams = new URLSearchParams(params);
    if (filters.search) directoryParams.set("search", filters.search);
    if (filters.adjustment !== "ALL") directoryParams.set("adjustment", filters.adjustment);
    directoryParams.set("sort", filters.sort);
    directoryParams.set("page", String(filters.page));
    directoryParams.set("pageSize", String(filters.pageSize));
    void Promise.all([
      api<Overview>(`/v1/commission-periods/${periodId}/overview?${params}`),
      api<Directory>(`/v1/commission-periods/${periodId}/staff-directory?${directoryParams}`),
    ]).then(([nextOverview, nextDirectory]) => {
      if (!active) return;
      setOverview(nextOverview);
      setDirectory(nextDirectory);
      setSelectedStaffId((current) => current || nextDirectory.items[0]?.staffId || "");
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Không thể tải dữ liệu hoa hồng."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters, periodId]);

  useEffect(() => {
    if (!periodId || !selectedStaffId) { setDetail(undefined); return; }
    let active = true;
    setDetailLoading(true);
    const params = filters.branchId ? `?branchId=${encodeURIComponent(filters.branchId)}` : "";
    void api<Detail>(`/v1/commission-periods/${periodId}/staff/${selectedStaffId}/overview${params}`).then((value) => { if (active) setDetail(value); }).catch(() => { if (active) setDetail(undefined); }).finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [filters.branchId, periodId, selectedStaffId]);

  const selectedPeriod = useMemo(() => periods.find((period) => period.id === periodId), [periodId, periods]);
  const canManagePeriod = Boolean((context?.supportAccess?.permissions ?? context?.authorization.permissions ?? []).includes("commission.period.manage"));
  const canLockPeriod = Boolean((context?.supportAccess?.permissions ?? context?.authorization.permissions ?? []).includes("commission.period.lock"));

  async function executeAction() {
    if (!selectedPeriod || !action) return;
    setActionBusy(true); setError("");
    try {
      const endpoint = action === "REVIEW" ? "start-review" : "lock";
      await api(`/v1/commission-periods/${selectedPeriod.id}/${endpoint}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ version: selectedPeriod.version, reason: action === "REVIEW" ? "Bắt đầu rà soát từ workspace hoa hồng." : "Khóa kỳ sau khi kiểm tra readiness." }) });
      setNotice(action === "REVIEW" ? "Kỳ đã chuyển sang trạng thái đang rà soát." : "Kỳ hoa hồng đã được khóa và snapshot đã ghi nhận.");
      setAction(null);
      await loadPeriods();
      setFilters((current) => ({ ...current }));
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "Không thể cập nhật trạng thái kỳ."); } finally { setActionBusy(false); }
  }
  async function exportReport() {
    if (!periodId) return;
    try {
      const result = await api<{ id?: string }>("/v1/financial/exports", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ exportType: "COMMISSION_STATEMENTS", branchId: filters.branchId || undefined, filters: { periodId, search: filters.search || undefined } }) });
      setNotice(`Đã tạo yêu cầu xuất báo cáo${result?.id ? ` ${result.id}` : ""}.`);
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "Không thể tạo báo cáo."); }
  }

  return <main className={styles.page}><div className={styles.content}>
    <header className={styles.header}><div><div className={styles.breadcrumb}>Tài chính <span>/</span> Hoa hồng</div><h1 className={styles.title}>Hoa hồng nhân viên</h1><p className={styles.subtitle}>Theo dõi doanh thu được ghi nhận, hoa hồng, tip và các khoản điều chỉnh của từng kỹ thuật viên.</p></div><div className={styles.headerActions}><button className={styles.button} onClick={() => void exportReport()} disabled={!periodId}><UiIcon name="download" /> Xuất báo cáo</button><Link className={styles.button} href="/admin/commission/adjustments"><UiIcon name="transfer" /> Xem điều chỉnh</Link><button className={`${styles.button} ${styles.buttonPrimary}`} onClick={() => selectedPeriod?.status === "OPEN" ? setAction("REVIEW") : selectedPeriod?.status === "REVIEW" ? setAction("LOCK") : undefined} disabled={!selectedPeriod || (selectedPeriod.status === "OPEN" && !canManagePeriod) || (selectedPeriod.status === "REVIEW" && (!canLockPeriod || !overview?.readiness.canLock))}><UiIcon name={selectedPeriod?.status === "LOCKED" ? "lock" : "check"} /> {selectedPeriod ? selectedPeriod.status === "OPEN" ? "Chốt kỳ hoa hồng" : selectedPeriod.status === "REVIEW" ? "Khóa kỳ hoa hồng" : "Kỳ đã khóa" : "Chưa có kỳ"}</button></div></header>
    {error ? <div className={styles.noticeError} role="alert"><UiIcon name="alert" /><span>{error}</span><button className={styles.textButton} onClick={() => { setError(""); setFilters((current) => ({ ...current })); }}>Thử lại</button></div> : null}
    {notice ? <div className={styles.noticeSuccess} role="status"><UiIcon name="check" /><span>{notice}</span><button className={styles.textButton} onClick={() => setNotice("")}>Đóng</button></div> : null}
    <section className={styles.periodBar}><div><span className={styles.eyebrow}>KỲ HOA HỒNG</span><strong>{selectedPeriod ? `${selectedPeriod.code} · ${dateLabel(selectedPeriod.startDate)} – ${dateLabel(selectedPeriod.endDate)}` : "Chưa có kỳ hoa hồng"}</strong></div><div className={styles.periodControls}><label>Kỳ đang xem<select className={styles.select} value={periodId} onChange={(event) => { setPeriodId(event.target.value); updateUrl({ periodId: event.target.value, page: 1 }); }}><option value="">Chọn kỳ</option>{periods.map((period) => <option value={period.id} key={period.id}>{period.code} · {periodStatusLabel(period.status)}</option>)}</select></label>{selectedPeriod ? <Badge tone={statusTone(selectedPeriod.status)}>{periodStatusLabel(selectedPeriod.status)}</Badge> : null}</div></section>
    {!periods.length && !loading ? <div className={styles.emptyState}><UiIcon name="file" /><strong>Chưa có kỳ hoa hồng</strong><p>Hãy tạo kỳ từ màn quản lý kỳ hoa hồng trước khi xem workspace.</p><Link className={styles.button} href="/admin/commission/periods">Mở quản lý kỳ</Link></div> : null}
    {loading ? <div className={styles.loadingGrid}><div /><div /><div /><div /></div> : null}
    {selectedPeriod && overview && directory && !loading ? <>
      <section className={styles.kpis}><Kpi icon="wallet" label="Doanh thu đủ điều kiện" value={money(overview.totals.eligibleBaseMinor, selectedPeriod.currency)} meta={`${overview.totals.serviceCount} dịch vụ`} /><Kpi icon="trend" label="Hoa hồng phải trả" value={money(overview.totals.payableMinor, selectedPeriod.currency)} meta={`${money(overview.totals.earningMinor, selectedPeriod.currency)} hoa hồng gốc`} tone="purple" /><Kpi icon="gift" label="Tip ròng trong kỳ" value={money(overview.totals.netTipMinor, selectedPeriod.currency)} meta={`${money(overview.totals.refundedTipMinor, selectedPeriod.currency)} đã hoàn`} tone="rose" /><Kpi icon="people" label="Nhân viên có hoa hồng" value={String(overview.totals.staffCount)} meta="Theo dữ liệu commission entry" tone="amber" /><Kpi icon="transfer" label="Điều chỉnh trong kỳ" value={money(overview.totals.refundReversalMinor + overview.totals.manualAdjustmentMinor, selectedPeriod.currency)} meta={`${overview.readiness.blockers.length} blocker khóa kỳ`} tone="blue" /></section>
      <section className={styles.filters}><div className={styles.filterGrid}><label>Kỳ hoa hồng<select className={styles.select} value={periodId} onChange={(event) => { setPeriodId(event.target.value); updateUrl({ periodId: event.target.value, page: 1 }); }}>{periods.map((period) => <option value={period.id} key={period.id}>{period.code} · {dateLabel(period.startDate)} – {dateLabel(period.endDate)}</option>)}</select></label><label>Chi nhánh<select className={styles.select} value={filters.branchId} onChange={(event) => { setActiveBranchId(event.target.value || undefined); updateFilters({ branchId: event.target.value }); }}>{branches.length > 1 ? <option value="">Tất cả chi nhánh</option> : null}{branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label><label className={styles.searchField}>Tìm kiếm<input className={styles.input} value={filters.search} onChange={(event) => updateFilters({ search: event.target.value })} placeholder="Tên nhân viên / mã giao dịch / mã đơn POS..." /></label><label>Trạng thái nhân sự<select className={styles.select} value={filters.adjustment} onChange={(event) => updateFilters({ adjustment: event.target.value })}><option value="ALL">Tất cả</option><option value="WITH_ADJUSTMENT">Có điều chỉnh</option><option value="WITHOUT_ADJUSTMENT">Không điều chỉnh</option></select></label><label>Sắp xếp<select className={styles.select} value={filters.sort} onChange={(event) => updateFilters({ sort: event.target.value })}><option value="REVENUE_DESC">Doanh thu cao nhất</option><option value="COMMISSION_DESC">Hoa hồng cao nhất</option><option value="TIP_DESC">Tip cao nhất</option><option value="NAME_ASC">Tên A–Z</option></select></label></div><div className={styles.filterFooter}><div className={styles.chips}><button className={`${styles.chip} ${filters.adjustment === "ALL" ? styles.chipActive : ""}`} onClick={() => updateFilters({ adjustment: "ALL" })}>Tất cả</button><button className={`${styles.chip} ${filters.adjustment === "WITH_ADJUSTMENT" ? styles.chipActive : ""}`} onClick={() => updateFilters({ adjustment: "WITH_ADJUSTMENT" })}>Có điều chỉnh</button><Badge tone={statusTone(selectedPeriod.status)}>{periodStatusLabel(selectedPeriod.status)} · dữ liệu {selectedPeriod.status === "LOCKED" ? "snapshot" : "live"}</Badge></div><span className={styles.filterMeta}>{directory.pagination.total} nhân viên phù hợp</span></div></section>
      <section className={styles.workspace}><div className={styles.mainColumn}><div className={styles.card}><div className={styles.tableHeader}><div><h2 className={styles.sectionTitle}>Hoa hồng theo nhân viên</h2><span className={styles.tableMeta}>Xếp hạng toàn bộ kết quả theo bộ lọc hiện tại</span></div><span className={styles.tableMeta}>Kỳ: {selectedPeriod.code}</span></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>#</th><th>Nhân viên</th><th>Dịch vụ</th><th>Doanh thu đủ điều kiện</th><th>Hoa hồng</th><th>Tip</th><th>Điều chỉnh</th><th>Hoa hồng phải trả</th><th>Trạng thái</th><th /></tr></thead><tbody>{directory.items.map((item) => <tr key={item.staffId} className={item.staffId === selectedStaffId ? styles.selectedRow : ""} onClick={() => setSelectedStaffId(item.staffId)}><td><span className={styles.rank}>{item.rank <= 3 ? ["♛", "②", "③"][item.rank - 1] : item.rank}</span></td><td><div className={styles.staffCell}><span className={styles.avatar}>{initials(item.staffName)}</span><span><strong>{item.staffName}</strong><small>{item.employeeCode ?? item.roleLabel ?? "Kỹ thuật viên"}</small></span></div></td><td>{item.serviceCount}</td><td className={styles.money}>{money(item.eligibleBaseMinor, item.currency)}</td><td className={`${styles.money} ${styles.purpleText}`}>{money(item.earningMinor, item.currency)}</td><td className={styles.money}>{money(item.netTipMinor, item.currency)}</td><td className={`${styles.money} ${item.refundReversalMinor + item.manualAdjustmentMinor < 0 ? styles.negative : styles.blueText}`}>{money(item.refundReversalMinor + item.manualAdjustmentMinor, item.currency)}{item.adjustmentCount ? <small className={styles.small}>Có điều chỉnh</small> : null}</td><td className={`${styles.money} ${styles.roseText}`}>{money(item.payableMinor, item.currency)}</td><td><Badge tone={statusTone(item.periodStatus)}>{periodStatusLabel(item.periodStatus)}</Badge>{item.adjustmentCount ? <small className={styles.tableHint}>Có điều chỉnh</small> : null}</td><td><button className={styles.iconButton} aria-label={`Xem ${item.staffName}`} onClick={(event) => { event.stopPropagation(); setSelectedStaffId(item.staffId); }}>›</button></td></tr>)}</tbody></table></div>{!directory.items.length ? <div className={styles.emptyInline}><UiIcon name="people" /><strong>Chưa có nhân viên có commission</strong><span>Không có commission entry phù hợp với kỳ và bộ lọc hiện tại.</span></div> : null}<div className={styles.pagination}><span>Hiển thị {directory.items.length ? (directory.pagination.page - 1) * directory.pagination.pageSize + 1 : 0} – {(directory.pagination.page - 1) * directory.pagination.pageSize + directory.items.length} trong {directory.pagination.total} nhân viên</span><div className={styles.paginationControls}><button className={styles.pageButton} disabled={directory.pagination.page <= 1} onClick={() => updateFilters({ page: directory.pagination.page - 1 }, false)}>‹</button><span>{directory.pagination.page} / {directory.pagination.totalPages}</span><button className={styles.pageButton} disabled={directory.pagination.page >= directory.pagination.totalPages} onClick={() => updateFilters({ page: directory.pagination.page + 1 }, false)}>›</button><select className={styles.pageSize} value={filters.pageSize} onChange={(event) => updateFilters({ pageSize: Number(event.target.value) })}><option value={10}>10 / trang</option><option value={20}>20 / trang</option><option value={50}>50 / trang</option></select></div></div></div><div className={styles.bottomGrid}><div className={styles.card}><div className={styles.cardTitleRow}><h2 className={styles.sectionTitle}>Doanh thu & hoa hồng</h2><span className={styles.legend}><i className={styles.legendRose} /> Doanh thu <i className={styles.legendPurple} /> Hoa hồng</span></div>{overview.ranking.length ? <div className={styles.barChart}>{overview.ranking.map((row) => <div className={styles.barRow} key={row.staffId}><span>{row.staffName}</span><div className={styles.barTrack}><i style={{ width: `${Math.min(100, overview.ranking[0]!.eligibleBaseMinor ? row.eligibleBaseMinor / overview.ranking[0]!.eligibleBaseMinor * 100 : 0)}%` }} /><b style={{ width: `${Math.min(100, overview.ranking[0]!.eligibleBaseMinor ? row.earningMinor / overview.ranking[0]!.eligibleBaseMinor * 100 : 0)}%` }} /></div><strong>{money(row.earningMinor, row.currency)}</strong></div>)}</div> : <div className={styles.emptyChart}>Chưa có dữ liệu xếp hạng.</div>}</div><div className={styles.card}><div className={styles.cardTitleRow}><h2 className={styles.sectionTitle}>Nguồn hoa hồng</h2><span className={styles.tableMeta}>Từ financial evidence</span></div><div className={styles.sourceList}><KeyValue label="Dịch vụ / earning" value={money(overview.sources.earningMinor, selectedPeriod.currency)} /><KeyValue label="Refund reversal" value={money(overview.sources.refundReversalMinor, selectedPeriod.currency)} /><KeyValue label="Điều chỉnh thủ công" value={money(overview.sources.manualAdjustmentMinor, selectedPeriod.currency)} /><KeyValue label="Tip ròng" value={money(overview.sources.netTipMinor, selectedPeriod.currency)} /></div></div></div></div>
      <aside className={styles.rail}>{detailLoading ? <div className={`${styles.card} ${styles.railCard}`}><div className={styles.skeleton} /><div className={styles.skeleton} /><div className={styles.skeleton} /></div> : detail ? <><div className={`${styles.card} ${styles.railCard}`}><div className={styles.railHeader}><div><span className={styles.eyebrow}>NHÂN VIÊN ĐƯỢC CHỌN</span><h2>{detail.staff.staffName}</h2><p>{detail.staff.employeeCode ?? detail.staff.roleLabel ?? "Kỹ thuật viên"}</p></div><span className={styles.avatarLarge}>{initials(detail.staff.staffName)}</span></div><Link className={styles.outlineLink} href={`/admin/staff/list?staffId=${detail.staff.staffId}`}>Xem hồ sơ nhân viên <span>→</span></Link></div><div className={`${styles.card} ${styles.railCard}`}><h2 className={styles.sectionTitle}>Tóm tắt hoa hồng</h2><KeyValue label="Doanh thu đủ điều kiện" value={money(detail.summary.eligibleBaseMinor, selectedPeriod.currency)} /><KeyValue label="Hoa hồng gốc" value={money(detail.summary.earningMinor, selectedPeriod.currency)} /><KeyValue label="Tip ròng trong kỳ" value={money(detail.summary.netTipMinor, selectedPeriod.currency)} /><KeyValue label="Điều chỉnh" value={money(detail.summary.refundReversalMinor + detail.summary.manualAdjustmentMinor, selectedPeriod.currency)} /><div className={styles.totalLine}><span>Hoa hồng phải trả</span><strong>{money(detail.summary.payableMinor, selectedPeriod.currency)}</strong></div><p className={styles.footerNote}>Tip là dữ liệu riêng, không cộng vào payable snapshot.</p></div><div className={`${styles.card} ${styles.railCard}`}><h2 className={styles.sectionTitle}>Quy tắc đã áp dụng</h2>{detail.ruleEvidence.length ? detail.ruleEvidence.map((rule, index) => <div className={styles.ruleRow} key={index}><span>{String(rule.ruleCode ?? rule.rule_code ?? `Rule ${index + 1}`)}</span><strong>{rule.percentBasisPoints != null ? `${Number(rule.percentBasisPoints) / 100}%` : rule.percent_basis_points != null ? `${Number(rule.percent_basis_points) / 100}%` : "Theo snapshot"}</strong><small>{String(rule.baseMode ?? rule.base_mode ?? "Historical rule snapshot")}</small></div>) : <span className={styles.noData}>Chưa có rule snapshot trong kỳ.</span>}</div><div className={`${styles.card} ${styles.railCard}`}><h2 className={styles.sectionTitle}>Tip & điều chỉnh</h2><KeyValue label="Gross tip" value={money(detail.summary.grossTipMinor, selectedPeriod.currency)} /><KeyValue label="Tip đã hoàn" value={money(detail.summary.refundedTipMinor, selectedPeriod.currency)} /><KeyValue label="Số dịch vụ" value={`${detail.summary.serviceCount}`} />{detail.adjustments.length ? detail.adjustments.map((adjustment) => <div className={styles.adjustmentRow} key={adjustment.id}><span>{adjustment.reasonCode}<small>{adjustment.status} · {dateTime(adjustment.createdAt)}</small></span><strong>{money(adjustment.amountMinor, adjustment.currency)}</strong></div>) : <span className={styles.noData}>Không có yêu cầu điều chỉnh manual.</span>}</div><div className={`${styles.card} ${styles.railCard}`}><h2 className={styles.sectionTitle}>Bằng chứng gần đây</h2>{detail.entries.slice(-5).reverse().map((entry) => <div className={styles.evidenceRow} key={entry.id}><span><strong>{entryTypeLabel(entry.entryType)}</strong><small>{dateLabel(entry.businessDate)} · {entry.invoiceId.slice(0, 8)}</small></span><strong className={entry.commissionMinor < 0 ? styles.negative : ""}>{money(entry.commissionMinor, entry.currency)}</strong></div>)}{!detail.entries.length ? <span className={styles.noData}>Chưa có commission entry.</span> : null}</div></> : <div className={`${styles.card} ${styles.railCard}`}><div className={styles.emptyRail}><UiIcon name="people" /><strong>Chọn một nhân viên</strong><span>Chọn dòng trong bảng để xem rule snapshot, tip và source evidence.</span></div></div>}</aside></section>
      <section className={styles.readiness}><div><span className={styles.eyebrow}>ĐIỀU KIỆN CHỐT KỲ</span><strong>{overview.readiness.canLock ? "Đủ điều kiện khóa kỳ" : overview.readiness.blockers.length ? "Cần xử lý trước khi khóa" : selectedPeriod.status === "OPEN" ? "Cần bắt đầu rà soát" : "Đang kiểm tra"}</strong></div><div className={styles.readinessChecks}>{overview.readiness.blockers.length ? overview.readiness.blockers.map((blocker) => <span className={styles.checkWarning} key={blocker.code}><UiIcon name="alert" /> {blocker.message} ({blocker.count})</span>) : <span className={styles.checkOk}><UiIcon name="check" /> Không có blocker được backend ghi nhận</span>}{overview.readiness.warnings.map((warning) => <span className={styles.checkWarning} key={warning.code}><UiIcon name="notification" /> {warning.message}</span>)}</div></section>
      <div className={styles.infoNotice}><UiIcon name="file" /><span>Hoa hồng được tính từ dữ liệu giao dịch và đóng góp đã được ghi nhận tại thời điểm phát sinh. Các khoản hoàn tiền tạo bút toán điều chỉnh âm thay vì sửa trực tiếp khoản hoa hồng gốc.</span></div>
      <footer className={styles.stickyFooter}><Link href="/admin/financial" className={styles.button}>← Tài chính</Link><div className={styles.footerActions}><button className={styles.button} onClick={() => void exportReport()}><UiIcon name="download" /> Xuất báo cáo</button><Link className={styles.button} href="/admin/commission/adjustments"><UiIcon name="transfer" /> Xem điều chỉnh</Link><button className={`${styles.button} ${styles.buttonPrimary}`} onClick={() => selectedPeriod.status === "OPEN" ? setAction("REVIEW") : selectedPeriod.status === "REVIEW" ? setAction("LOCK") : undefined} disabled={selectedPeriod.status === "LOCKED" || actionBusy || (selectedPeriod.status === "REVIEW" && !overview.readiness.canLock)}>{selectedPeriod.status === "OPEN" ? "Chốt kỳ hoa hồng" : selectedPeriod.status === "REVIEW" ? "Khóa kỳ hoa hồng" : "Kỳ đã khóa"}</button></div></footer>
    </> : null}
    {action && selectedPeriod ? <div className={styles.modalBackdrop} role="presentation"><div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="commission-action-title"><div className={styles.modalHeader}><div><span className={styles.eyebrow}>WORKFLOW KỲ HOA HỒNG</span><h2 id="commission-action-title">{action === "REVIEW" ? "Bắt đầu rà soát kỳ hoa hồng?" : "Khóa kỳ hoa hồng?"}</h2></div><button className={styles.iconButton} aria-label="Đóng" onClick={() => setAction(null)}>×</button></div><p>{action === "REVIEW" ? "Kỳ sẽ chuyển từ OPEN sang REVIEW. Số liệu vẫn có thể được rà soát trước khi khóa." : "Backend sẽ kiểm tra lại blocker, điều chỉnh và refund reversal trước khi tạo snapshot bất biến."}</p>{action === "LOCK" && overview?.readiness.blockers.length ? <div className={styles.modalBlockers}>{overview.readiness.blockers.map((blocker) => <div key={blocker.code}><UiIcon name="alert" /> {blocker.message}</div>)}</div> : null}<div className={styles.modalActions}><button className={styles.button} onClick={() => setAction(null)}>Hủy</button><button className={`${styles.button} ${styles.buttonPrimary}`} disabled={actionBusy || (action === "LOCK" && !overview?.readiness.canLock)} onClick={() => void executeAction()}>{actionBusy ? "Đang xử lý…" : action === "REVIEW" ? "Bắt đầu rà soát" : "Khóa kỳ hoa hồng"}</button></div></div></div> : null}
  </div></main>;
}

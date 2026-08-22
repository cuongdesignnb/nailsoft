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
  setActiveBranchId,
} from "../auth";
import styles from "./commission-adjustments-page.module.css";

type Status = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
type Period = {
  id: string;
  code: string;
  startDate: string;
  endDate: string;
  status: "OPEN" | "REVIEW" | "LOCKED";
  currency: string;
  version: number;
};
type PeriodRef = Pick<Period, "id" | "code" | "startDate" | "endDate" | "status">;
type Adjustment = {
  id: string;
  staffId: string;
  staffName?: string | null;
  employeeCode?: string | null;
  targetPeriodId: string;
  targetPeriod?: PeriodRef | null;
  postingPeriodId?: string | null;
  postingPeriod?: PeriodRef | null;
  amountMinor: number;
  currency: string;
  reasonCode: string;
  note: string;
  status: Status;
  version: number;
  requestedByUserId: string;
  requestedByName?: string | null;
  decidedByUserId?: string | null;
  decidedByName?: string | null;
  decisionReason?: string | null;
  createdAt: string;
  decidedAt?: string | null;
  hasEntry?: boolean;
};
type Staff = { id: string; displayName: string; employeeCode?: string | null; status?: string };
type Branch = { id: string; name: string; status?: string };
type Filters = { search: string; status: "ALL" | Status; staffId: string; targetPeriodId: string; postingPeriodId: string };
type ModalAction = { type: "APPROVE" | "REJECT" | "CANCEL"; item: Adjustment } | null;

const EMPTY_FILTERS: Filters = { search: "", status: "ALL", staffId: "", targetPeriodId: "", postingPeriodId: "" };

class ApiError extends Error {
  code: string | undefined;
  status: number;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function unwrap(body: any) { return body?.data; }
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authorizedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body?.error?.message ?? "Không thể tải dữ liệu điều chỉnh hoa hồng.", response.status, body?.error?.code);
  return unwrap(body) as T;
}
function money(value: number | null | undefined, currency = "VND") {
  try { return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value ?? 0); }
  catch { return `${value ?? 0} ${currency}`; }
}
function dateLabel(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}
function dateTime(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function initials(name?: string | null) { return name?.trim().split(/\s+/).slice(-2).map((part) => part[0]).join("").toUpperCase() || "?"; }
function periodLabel(period?: PeriodRef | null) { return period ? `${period.code} · ${dateLabel(period.startDate)} – ${dateLabel(period.endDate)}` : "Không gắn kỳ"; }
function statusLabel(status: Status) { return { PENDING: "Chờ phê duyệt", APPROVED: "Đã áp dụng", REJECTED: "Đã từ chối", CANCELLED: "Đã hủy" }[status]; }
function statusTone(status: Status) { return status === "APPROVED" ? "green" : status === "PENDING" ? "amber" : status === "REJECTED" ? "rose" : "gray"; }
function errorMessage(error: unknown) {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : "Đã có lỗi xảy ra.";
  const messages: Record<string, string> = {
    COMMISSION_DUAL_CONTROL_REQUIRED: "Người tạo không được tự phê duyệt điều chỉnh của chính mình.",
    COMMISSION_ADJUSTMENT_CONFLICT: "Điều chỉnh đã thay đổi hoặc không còn ở trạng thái chờ. Dữ liệu đã được tải lại.",
    COMMISSION_POSTING_PERIOD_NOT_OPEN: "Kỳ ghi nhận phải đang mở.",
    LOCKED_PERIOD_POSTING_PERIOD_REQUIRED: "Kỳ đã khóa bắt buộc phải chọn kỳ ghi nhận đang mở.",
    COMMISSION_CURRENCY_MISMATCH: "Đơn vị tiền tệ của điều chỉnh không khớp với kỳ.",
    COMMISSION_ADJUSTMENT_BRANCH_REQUIRED: "Nhân viên chưa có phân công chi nhánh đang hoạt động.",
    STAFF_NOT_FOUND: "Không tìm thấy nhân viên trong phạm vi chi nhánh hiện tại.",
    COMMISSION_PERIOD_NOT_FOUND: "Không tìm thấy kỳ hoa hồng.",
    PERMISSION_DENIED: "Tài khoản không có quyền thực hiện thao tác này.",
  };
  return messages[error.code ?? ""] ?? (error.status === 403 ? "Tài khoản không có quyền truy cập dữ liệu này." : error.message);
}
function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`${styles.badge} ${styles[`badge${tone[0]!.toUpperCase()}${tone.slice(1)}`]}`}>{children}</span>;
}
function Kpi({ icon, label, value, meta, tone = "rose" }: { icon: "notification" | "check" | "trend" | "transfer" | "lock"; label: string; value: string; meta: string; tone?: string }) {
  return <article className={`${styles.kpi} ${styles[`kpi${tone[0]!.toUpperCase()}${tone.slice(1)}`]}`}><span className={styles.kpiIcon}><UiIcon name={icon} /></span><div><span className={styles.kpiLabel}>{label}</span><strong className={styles.kpiValue}>{value}</strong><small className={styles.kpiMeta}>{meta}</small></div></article>;
}
function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return <div className={styles.keyValue}><span>{label}</span><strong>{value}</strong></div>;
}

export default function CommissionAdjustmentsPage() {
  const [items, setItems] = useState<Adjustment[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [context, setContext] = useState<any>();
  const [branchId, setBranchId] = useState(getActiveBranchId() ?? "");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [action, setAction] = useState<ModalAction>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [staffError, setStaffError] = useState("");
  const [createForm, setCreateForm] = useState({ staffId: "", targetPeriodId: "", postingPeriodId: "", amountMinor: "", currency: "VND", reasonCode: "REFUND_REVERSAL", note: "" });
  const [decisionReason, setDecisionReason] = useState("");

  const permissions = context?.supportAccess?.permissions ?? context?.authorization?.permissions ?? [];
  const canRequest = permissions.includes("commission.adjustment.request");
  const canApprove = permissions.includes("commission.adjustment.approve");

  const load = useCallback(async (nextBranchId = branchId) => {
    setLoading(true); setError("");
    try {
      const query = nextBranchId ? `?branchId=${encodeURIComponent(nextBranchId)}` : "";
      const [nextItems, nextPeriods] = await Promise.all([
        api<Adjustment[]>(`/v1/commission-adjustments${query}`),
        api<Period[]>("/v1/commission-periods"),
      ]);
      setItems(nextItems ?? []);
      setPeriods(nextPeriods ?? []);
      setSelectedId((current) => current && (nextItems ?? []).some((item) => item.id === current) ? current : (nextItems ?? [])[0]?.id ?? "");
      setCreateForm((current) => ({ ...current, currency: nextPeriods?.[0]?.currency ?? current.currency, targetPeriodId: current.targetPeriodId || nextPeriods?.[0]?.id || "", postingPeriodId: current.postingPeriodId || nextPeriods?.find((period) => period.status === "OPEN")?.id || "" }));
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }, [branchId]);

  const loadStaff = useCallback(async (nextBranchId = branchId) => {
    setStaffError("");
    try {
      const query = new URLSearchParams({ status: "ACTIVE" });
      if (nextBranchId) query.set("branchId", nextBranchId);
      setStaff(await api<Staff[]>(`/v1/staff?${query}`));
    } catch (cause) { setStaffError(errorMessage(cause)); setStaff([]); }
  }, [branchId]);

  useEffect(() => {
    let active = true;
    void getAuthorizedBranchContext().then(async (value) => {
      if (!active) return;
      setContext(value.context); setBranches(value.branches as Branch[]); setBranchId(value.branchId ?? "");
      await load(value.branchId ?? "");
      await loadStaff(value.branchId ?? "");
    }).catch((cause) => { if (active) { setError(errorMessage(cause)); setLoading(false); } });
    const onBranchChange = () => {
      void getAuthorizedBranchContext().then(async (value) => {
        setContext(value.context); setBranches(value.branches as Branch[]); setBranchId(value.branchId ?? "");
        await load(value.branchId ?? "");
        await loadStaff(value.branchId ?? "");
      }).catch((cause) => setError(errorMessage(cause)));
    };
    window.addEventListener(ACTIVE_BRANCH_CHANGED_EVENT, onBranchChange);
    return () => { active = false; window.removeEventListener(ACTIVE_BRANCH_CHANGED_EVENT, onBranchChange); };
  }, [load, loadStaff]);

  const filtered = useMemo(() => {
    const query = filters.search.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (filters.status !== "ALL" && item.status !== filters.status) return false;
      if (filters.staffId && item.staffId !== filters.staffId) return false;
      if (filters.targetPeriodId && item.targetPeriodId !== filters.targetPeriodId) return false;
      if (filters.postingPeriodId && item.postingPeriodId !== filters.postingPeriodId) return false;
      if (query && ![item.id, item.staffName, item.employeeCode, item.reasonCode, item.note, item.requestedByName, item.decidedByName, item.targetPeriod?.code, item.postingPeriod?.code].some((value) => String(value ?? "").toLocaleLowerCase().includes(query))) return false;
      return true;
    });
  }, [filters, items]);
  const selected = useMemo(() => filtered.find((item) => item.id === selectedId) ?? items.find((item) => item.id === selectedId), [filtered, items, selectedId]);
  const summary = useMemo(() => ({
    pending: items.filter((item) => item.status === "PENDING"),
    approved: items.filter((item) => item.status === "APPROVED"),
    positive: items.filter((item) => item.amountMinor > 0),
    negative: items.filter((item) => item.amountMinor < 0),
    locked: items.filter((item) => item.targetPeriod?.status === "LOCKED"),
  }), [items]);
  const currency = selected?.currency ?? periods[0]?.currency ?? "VND";

  async function refresh() { await load(branchId); }
  async function createAdjustment() {
    const amount = Number(createForm.amountMinor);
    if (!createForm.staffId || !createForm.targetPeriodId || !Number.isSafeInteger(amount) || amount === 0 || !createForm.reasonCode || createForm.note.trim().length < 3) {
      setError("Hãy chọn nhân viên, kỳ, nhập số tiền khác 0, lý do và ghi chú tối thiểu 3 ký tự."); return;
    }
    setBusy(true); setError("");
    try {
      await api("/v1/commission-adjustments", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ staffId: createForm.staffId, targetPeriodId: createForm.targetPeriodId, postingPeriodId: createForm.postingPeriodId || null, amountMinor: amount, currency: createForm.currency, reasonCode: createForm.reasonCode, note: createForm.note.trim() }) });
      setCreateOpen(false); setNotice("Đã tạo yêu cầu điều chỉnh và chuyển sang chờ phê duyệt."); setCreateForm((current) => ({ ...current, amountMinor: "", reasonCode: "REFUND_REVERSAL", note: "" })); await refresh();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  async function mutate() {
    if (!action) return;
    setBusy(true); setError("");
    const endpoint = action.type === "APPROVE" ? "approve" : action.type === "REJECT" ? "reject" : "cancel";
    try {
      await api(`/v1/commission-adjustments/${action.item.id}/${endpoint}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ version: action.item.version, reason: decisionReason.trim() }) });
      setNotice(action.type === "APPROVE" ? "Đã phê duyệt; commission entry MANUAL_ADJUSTMENT được tạo bởi backend." : action.type === "REJECT" ? "Đã từ chối yêu cầu điều chỉnh." : "Đã hủy yêu cầu điều chỉnh."); setAction(null); setDecisionReason(""); await refresh();
    } catch (cause) { setError(errorMessage(cause)); await refresh(); }
    finally { setBusy(false); }
  }

  return <main className={styles.page}><div className={styles.content}>
    <header className={styles.header}><div><div className={styles.breadcrumb}>Tài chính <span>/</span> Hoa hồng nhân viên <span>/</span> Điều chỉnh</div><h1 className={styles.title}>Điều chỉnh hoa hồng</h1><p className={styles.subtitle}>Theo dõi các khoản điều chỉnh phát sinh từ hoàn tiền, nghiệp vụ và phê duyệt trong kỳ hoa hồng.</p></div><div className={styles.headerActions}><button className={styles.button} onClick={() => void refresh()} disabled={loading}><UiIcon name="refresh" /> Làm mới</button><Link className={styles.button} href="/admin/financial/commission"><UiIcon name="arrowLeft" /> Hoa hồng nhân viên</Link><button className={`${styles.button} ${styles.buttonPrimary}`} onClick={() => setCreateOpen(true)} disabled={!canRequest || !periods.length || !staff.length}><UiIcon name="plus" /> Tạo điều chỉnh</button></div></header>
    <div className={styles.infoNotice}><UiIcon name="shield" /><div><strong>Khoản hoa hồng gốc không bị sửa trực tiếp.</strong><span>Mọi thay đổi được ghi nhận bằng adjustment riêng để giữ nguyên lịch sử, bằng chứng và kiểm soát phê duyệt hai người.</span></div></div>
    {error ? <div className={styles.noticeError} role="alert"><UiIcon name="alert" /><span>{error}</span><button className={styles.textButton} onClick={() => { setError(""); void refresh(); }}>Thử lại</button></div> : null}
    {notice ? <div className={styles.noticeSuccess} role="status"><UiIcon name="check" /><span>{notice}</span><button className={styles.textButton} onClick={() => setNotice("")}>Đóng</button></div> : null}
    <section className={styles.kpis}><Kpi icon="notification" label="Chờ phê duyệt" value={money(summary.pending.reduce((sum, item) => sum + item.amountMinor, 0), currency)} meta={`${summary.pending.length} yêu cầu`} tone="amber" /><Kpi icon="check" label="Đã áp dụng" value={money(summary.approved.reduce((sum, item) => sum + item.amountMinor, 0), currency)} meta={`${summary.approved.length} yêu cầu`} tone="green" /><Kpi icon="trend" label="Tổng điều chỉnh tăng" value={money(summary.positive.reduce((sum, item) => sum + Math.max(0, item.amountMinor), 0), currency)} meta={`${summary.positive.length} khoản`} tone="purple" /><Kpi icon="transfer" label="Tổng điều chỉnh giảm" value={money(summary.negative.reduce((sum, item) => sum + Math.min(0, item.amountMinor), 0), currency)} meta={`${summary.negative.length} khoản`} tone="rose" /><Kpi icon="lock" label="Liên quan kỳ đã khóa" value={String(summary.locked.length)} meta="Cần kỳ ghi nhận đang mở" tone="blue" /></section>
    <section className={styles.filters}><div className={styles.filterGrid}><label className={styles.searchField}>Tìm kiếm<input className={styles.input} value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Lý do, ghi chú, nhân viên, mã kỳ..." /></label><label>Chi nhánh<select className={styles.select} value={branchId} onChange={(event) => { setActiveBranchId(event.target.value || undefined); setBranchId(event.target.value); }}><option value="">Tất cả chi nhánh trong phạm vi</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label>Trạng thái<select className={styles.select} value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as Filters["status"] }))}><option value="ALL">Tất cả</option><option value="PENDING">Chờ phê duyệt</option><option value="APPROVED">Đã áp dụng</option><option value="REJECTED">Đã từ chối</option><option value="CANCELLED">Đã hủy</option></select></label><label>Nhân viên<select className={styles.select} value={filters.staffId} onChange={(event) => setFilters((current) => ({ ...current, staffId: event.target.value }))}><option value="">Tất cả</option>{staff.map((person) => <option value={person.id} key={person.id}>{person.displayName}</option>)}</select></label><label>Kỳ mục tiêu<select className={styles.select} value={filters.targetPeriodId} onChange={(event) => setFilters((current) => ({ ...current, targetPeriodId: event.target.value }))}><option value="">Tất cả</option>{periods.map((period) => <option value={period.id} key={period.id}>{period.code}</option>)}</select></label><label>Kỳ ghi nhận<select className={styles.select} value={filters.postingPeriodId} onChange={(event) => setFilters((current) => ({ ...current, postingPeriodId: event.target.value }))}><option value="">Tất cả</option>{periods.map((period) => <option value={period.id} key={period.id}>{period.code}</option>)}</select></label></div><div className={styles.filterFooter}><div className={styles.chips}>{(["ALL", "PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const).map((status) => <button className={`${styles.chip} ${filters.status === status ? styles.chipActive : ""}`} key={status} onClick={() => setFilters((current) => ({ ...current, status }))}>{status === "ALL" ? "Tất cả" : statusLabel(status)}</button>)}</div><button className={styles.textButton} onClick={() => setFilters(EMPTY_FILTERS)}>Xóa bộ lọc</button></div></section>
    <section className={styles.workspace}><div className={styles.mainColumn}><div className={styles.card}><div className={styles.tableHeader}><div><h2 className={styles.sectionTitle}>Danh sách điều chỉnh</h2><span className={styles.tableMeta}>{filtered.length} yêu cầu · dữ liệu theo phạm vi chi nhánh</span></div><Badge tone="blue">Chỉ trạng thái backend</Badge></div>{loading ? <div className={styles.loading}>Đang tải yêu cầu điều chỉnh…</div> : filtered.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Mã điều chỉnh</th><th>Nhân viên</th><th>Kỳ mục tiêu</th><th>Kỳ ghi nhận</th><th>Tăng</th><th>Giảm</th><th>Lý do</th><th>Người tạo</th><th>Người duyệt</th><th>Ngày tạo</th><th>Trạng thái</th><th /></tr></thead><tbody>{filtered.map((item) => <tr key={item.id} className={item.id === selectedId ? styles.selectedRow : ""} onClick={() => setSelectedId(item.id)}><td><strong className={styles.code}>ADJ-{item.id.slice(0, 8).toUpperCase()}</strong><small className={styles.tableHint}>v{item.version}</small></td><td><div className={styles.staffCell}><span className={styles.avatar}>{initials(item.staffName)}</span><span><strong>{item.staffName ?? "Nhân viên"}</strong><small>{item.employeeCode ?? item.staffId.slice(0, 8)}</small></span></div></td><td><span className={styles.periodCell}>{item.targetPeriod?.code ?? item.targetPeriodId.slice(0, 8)}<small>{item.targetPeriod?.status === "LOCKED" ? "Đã khóa" : item.targetPeriod?.status ?? "—"}</small></span></td><td><span className={styles.periodCell}>{item.postingPeriod?.code ?? "Theo kỳ mục tiêu"}<small>{item.postingPeriod?.status ?? "—"}</small></span></td><td className={item.amountMinor > 0 ? styles.positive : styles.muted}> {item.amountMinor > 0 ? money(item.amountMinor, item.currency) : "—"}</td><td className={item.amountMinor < 0 ? styles.negative : styles.muted}>{item.amountMinor < 0 ? money(item.amountMinor, item.currency) : "—"}</td><td><span className={styles.reason}>{item.reasonCode}<small>{item.note}</small></span></td><td>{item.requestedByName ?? item.requestedByUserId.slice(0, 8)}</td><td>{item.decidedByName ?? "—"}</td><td>{dateTime(item.createdAt)}</td><td><Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge></td><td><button className={styles.iconButton} aria-label="Xem chi tiết" onClick={(event) => { event.stopPropagation(); setSelectedId(item.id); }}>›</button></td></tr>)}</tbody></table></div> : <div className={styles.emptyInline}><UiIcon name="transfer" /><strong>{items.length ? "Không có yêu cầu phù hợp" : "Chưa có yêu cầu điều chỉnh"}</strong><span>{items.length ? "Hãy đổi bộ lọc để xem dữ liệu khác." : "Tạo yêu cầu từ khoản nghiệp vụ cần điều chỉnh; backend sẽ giữ riêng bút toán gốc."}</span></div>}<div className={styles.tableFooter}><span>Hiển thị {filtered.length} / {items.length} yêu cầu</span><span>Không hiển thị dữ liệu refund reversal tự động</span></div></div><div className={styles.bottomGrid}><div className={styles.card}><h2 className={styles.sectionTitle}>Ảnh hưởng theo nhân viên</h2>{staff.slice(0, 5).map((person) => { const total = filtered.filter((item) => item.staffId === person.id).reduce((sum, item) => sum + item.amountMinor, 0); return <div className={styles.barRow} key={person.id}><span>{person.displayName}</span><div className={styles.barTrack}><i className={total >= 0 ? styles.barPositive : styles.barNegative} style={{ width: `${Math.min(100, Math.abs(total) / Math.max(1, Math.max(...filtered.map((item) => Math.abs(item.amountMinor)))) * 100)}%` }} /></div><strong className={total < 0 ? styles.negative : styles.positive}>{money(total, currency)}</strong></div>; })}{!staff.length ? <span className={styles.noData}>Không có danh sách nhân viên trong phạm vi hiện tại.</span> : null}</div><div className={styles.card}><h2 className={styles.sectionTitle}>Nguồn dữ liệu</h2><div className={styles.sourceList}><KeyValue label="Yêu cầu manual" value={`${items.length} yêu cầu`} /><KeyValue label="Bút toán đã tạo" value={`${items.filter((item) => item.hasEntry).length} commission entry`} /><KeyValue label="Đã áp dụng" value={`${summary.approved.length} yêu cầu`} /><KeyValue label="Kỳ bị khóa" value={`${summary.locked.length} yêu cầu`} /></div><p className={styles.footerNote}>Approve/reject/cancel luôn chờ server xác nhận và tải lại danh sách.</p></div></div></div>
      <aside className={styles.rail}>{selected ? <><div className={`${styles.card} ${styles.railCard}`}><div className={styles.railHeader}><div><span className={styles.eyebrow}>CHI TIẾT ĐIỀU CHỈNH</span><h2>ADJ-{selected.id.slice(0, 8).toUpperCase()}</h2><p>{selected.staffName ?? selected.staffId}</p></div><Badge tone={statusTone(selected.status)}>{statusLabel(selected.status)}</Badge></div><div className={styles.detailAmount}><span>Số tiền điều chỉnh</span><strong className={selected.amountMinor < 0 ? styles.negative : styles.positive}>{money(selected.amountMinor, selected.currency)}</strong></div><KeyValue label="Nhân viên" value={selected.staffName ?? selected.staffId} /><KeyValue label="Kỳ mục tiêu" value={periodLabel(selected.targetPeriod)} /><KeyValue label="Kỳ ghi nhận" value={periodLabel(selected.postingPeriod)} /><KeyValue label="Lý do" value={selected.reasonCode} /><KeyValue label="Phiên bản" value={`v${selected.version}`} /></div><div className={`${styles.card} ${styles.railCard}`}><h2 className={styles.sectionTitle}>Bằng chứng & phê duyệt</h2><div className={styles.noteBox}>{selected.note}</div><KeyValue label="Người tạo" value={`${selected.requestedByName ?? selected.requestedByUserId} · ${dateTime(selected.createdAt)}`} /><KeyValue label="Người quyết định" value={selected.decidedByName ? `${selected.decidedByName} · ${dateTime(selected.decidedAt)}` : "Chưa có"} />{selected.decisionReason ? <KeyValue label="Lý do quyết định" value={selected.decisionReason} /> : null}<div className={styles.evidenceFlag}><UiIcon name={selected.hasEntry ? "check" : "file"} /><span>{selected.hasEntry ? "Backend đã tạo commission entry MANUAL_ADJUSTMENT." : "Chưa có commission entry; chỉ được tạo sau khi approve."}</span></div></div>{selected.status === "PENDING" ? <div className={`${styles.card} ${styles.railCard}`}><h2 className={styles.sectionTitle}>Thao tác</h2><button className={`${styles.button} ${styles.buttonPrimary} ${styles.fullButton}`} disabled={!canApprove} onClick={() => { setDecisionReason(""); setAction({ type: "APPROVE", item: selected }); }}><UiIcon name="check" /> Phê duyệt</button><button className={`${styles.button} ${styles.fullButton}`} disabled={!canApprove} onClick={() => { setDecisionReason(""); setAction({ type: "REJECT", item: selected }); }}>Từ chối</button><button className={`${styles.button} ${styles.fullButton}`} disabled={!canRequest || selected.requestedByUserId !== context?.user?.id} onClick={() => { setDecisionReason(""); setAction({ type: "CANCEL", item: selected }); }}>Hủy yêu cầu</button>{!canApprove ? <span className={styles.permissionHint}>Cần quyền commission.adjustment.approve để phê duyệt hoặc từ chối.</span> : null}</div> : null}</> : <div className={`${styles.card} ${styles.railCard}`}><div className={styles.emptyRail}><UiIcon name="transfer" /><strong>Chọn một yêu cầu</strong><span>Chọn một dòng để xem số tiền, kỳ mục tiêu, bằng chứng và trạng thái xử lý.</span></div></div>}</aside></section>
    <footer className={styles.stickyFooter}><Link href="/admin/financial/commission" className={styles.button}><UiIcon name="arrowLeft" /> Hoa hồng nhân viên</Link><div className={styles.footerActions}><button className={styles.button} onClick={() => void refresh()}><UiIcon name="refresh" /> Làm mới</button><button className={`${styles.button} ${styles.buttonPrimary}`} onClick={() => setCreateOpen(true)} disabled={!canRequest || !periods.length || !staff.length}><UiIcon name="plus" /> Tạo điều chỉnh</button></div></footer>
    {createOpen ? <div className={styles.modalBackdrop}><div className={`${styles.modal} ${styles.modalWide}`} role="dialog" aria-modal="true" aria-labelledby="create-adjustment-title"><div className={styles.modalHeader}><div><span className={styles.eyebrow}>YÊU CẦU MANUAL ADJUSTMENT</span><h2 id="create-adjustment-title">Tạo điều chỉnh hoa hồng</h2></div><button className={styles.iconButton} aria-label="Đóng" onClick={() => setCreateOpen(false)}>×</button></div>{staffError ? <div className={styles.noticeError}><UiIcon name="alert" /><span>{staffError}</span></div> : null}<div className={styles.formGrid}><label>Nhân viên<select className={styles.select} value={createForm.staffId} onChange={(event) => setCreateForm((current) => ({ ...current, staffId: event.target.value }))}><option value="">Chọn nhân viên</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.displayName}{person.employeeCode ? ` · ${person.employeeCode}` : ""}</option>)}</select></label><label>Đơn vị tiền tệ<input className={styles.input} value={createForm.currency} onChange={(event) => setCreateForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} maxLength={3} /></label><label>Kỳ mục tiêu<select className={styles.select} value={createForm.targetPeriodId} onChange={(event) => setCreateForm((current) => ({ ...current, targetPeriodId: event.target.value, currency: periods.find((period) => period.id === event.target.value)?.currency ?? current.currency }))}><option value="">Chọn kỳ</option>{periods.map((period) => <option key={period.id} value={period.id}>{periodLabel(period)} · {period.status}</option>)}</select></label><label>Kỳ ghi nhận<select className={styles.select} value={createForm.postingPeriodId} onChange={(event) => setCreateForm((current) => ({ ...current, postingPeriodId: event.target.value }))}><option value="">Tự dùng kỳ mục tiêu</option>{periods.filter((period) => period.status === "OPEN").map((period) => <option key={period.id} value={period.id}>{periodLabel(period)} · Đang mở</option>)}</select></label><label>Số tiền điều chỉnh<input className={styles.input} inputMode="numeric" value={createForm.amountMinor} onChange={(event) => setCreateForm((current) => ({ ...current, amountMinor: event.target.value.replace(/[^\d-]/g, "") }))} placeholder="Ví dụ: -30000 hoặc 75000" /><small className={styles.fieldHint}>Số dương là tăng, số âm là giảm; gửi lên backend bằng amountMinor.</small></label><label>Lý do<select className={styles.select} value={createForm.reasonCode} onChange={(event) => setCreateForm((current) => ({ ...current, reasonCode: event.target.value }))}><option value="REFUND_REVERSAL">Hoàn tiền / reversal</option><option value="ATTRIBUTION_CORRECTION">Điều chỉnh phân bổ</option><option value="MANUAL_CORRECTION">Điều chỉnh thủ công</option><option value="OTHER">Khác</option></select></label></div><label className={styles.textareaLabel}>Ghi chú<textarea className={styles.textarea} value={createForm.note} onChange={(event) => setCreateForm((current) => ({ ...current, note: event.target.value }))} placeholder="Nêu rõ căn cứ và lý do điều chỉnh…" rows={4} /></label><div className={styles.modalActions}><button className={styles.button} onClick={() => setCreateOpen(false)}>Hủy</button><button className={`${styles.button} ${styles.buttonPrimary}`} onClick={() => void createAdjustment()} disabled={busy || !canRequest}>{busy ? "Đang gửi…" : "Gửi yêu cầu phê duyệt"}</button></div></div></div> : null}
    {action ? <div className={styles.modalBackdrop}><div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="adjustment-action-title"><div className={styles.modalHeader}><div><span className={styles.eyebrow}>DUAL CONTROL · {action.type}</span><h2 id="adjustment-action-title">{action.type === "APPROVE" ? "Phê duyệt điều chỉnh?" : action.type === "REJECT" ? "Từ chối điều chỉnh?" : "Hủy yêu cầu điều chỉnh?"}</h2></div><button className={styles.iconButton} aria-label="Đóng" onClick={() => setAction(null)}>×</button></div><p className={styles.modalDescription}>Yêu cầu <strong>ADJ-{action.item.id.slice(0, 8).toUpperCase()}</strong> · {money(action.item.amountMinor, action.item.currency)} · phiên bản v{action.item.version}.</p><label className={styles.textareaLabel}>Lý do quyết định<textarea className={styles.textarea} value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} rows={4} placeholder="Nhập lý do, tối thiểu 3 ký tự…" /></label><div className={styles.modalActions}><button className={styles.button} onClick={() => setAction(null)}>Hủy</button><button className={`${styles.button} ${action.type === "APPROVE" ? styles.buttonPrimary : styles.buttonDanger}`} onClick={() => void mutate()} disabled={busy || decisionReason.trim().length < 3}>{busy ? "Đang xử lý…" : action.type === "APPROVE" ? "Xác nhận phê duyệt" : action.type === "REJECT" ? "Xác nhận từ chối" : "Xác nhận hủy"}</button></div></div></div> : null}
  </div></main>;
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ACTIVE_BRANCH_CHANGED_EVENT, authorizedFetch, getActiveBranchId, getAuthorizedBranchContext, setActiveBranchId } from "../auth";
import styles from "./pos-register-management.module.css";

type Drawer = { id: string; code: string; name: string; currency: string; status: string };
type Metrics = {
  orderCount: number;
  capturedPaymentCount: number;
  salesMinor: number | null;
  totalCollectedMinor: number | null;
  cashCollectedMinor: number | null;
  paymentMix: Record<string, { amountMinor: number; count: number }> | null;
  movements: { openingFloatMinor: number; cashSalesMinor: number; cashInMinor: number; cashOutMinor: number } | null;
};
type Session = {
  id: string;
  branchId: string;
  registerId: string;
  registerCode: string;
  cashDrawerId: string;
  drawerCode: string;
  cashierUserId: string;
  cashier?: { userId: string; displayName: string } | null;
  businessDate: string;
  timezone: string;
  currency: string;
  status: "OPEN" | "CLOSING" | "CLOSED" | "CANCELLED";
  blindCount: boolean;
  openedAt: string;
  openingFloatMinor: number | null;
  expectedCashMinor: number | null;
  declaredCashMinor: number | null;
  varianceMinor: number | null;
  version: number;
};
type Attention = { code: string; orderId?: string | null; sessionId?: string | null; amountMinor: number | null; occurredAt?: string | null };
type RegisterView = {
  register: { id: string; branchId: string; code: string; name: string; status: "ACTIVE" | "INACTIVE"; deviceBindingRequired: boolean; version: number; drawers: Drawer[] };
  currentSession: Session | null;
  cashier: { userId: string; displayName: string } | null;
  metrics: Metrics | null;
  attention: Attention[];
  sessionCount: number;
};
type Activity = { code: string; id: string; registerId: string; sessionId: string; orderId?: string | null; amountMinor: number | null; detail?: string | null; actorName?: string | null; occurredAt?: string | null };
type Overview = {
  branchId: string;
  businessDate: string;
  timezone: string;
  currency: string;
  financialVisible: boolean;
  totals: { registerCount: number; openRegisterCount: number; closingRegisterCount: number; unopenedRegisterCount: number; collectedMinor: number | null; cashExpectedMinor: number | null; orderCount: number | null; attentionCount: number };
  registers: RegisterView[];
  openSessions: Array<Session & { metrics: Metrics | null }>;
  paymentMix: Record<string, { amountMinor: number; count: number }> | null;
  activity: Activity[];
  generatedAt: string;
};
type ApiBody = { data?: unknown; error?: { message?: string; code?: string } };
const statusLabels: Record<string, string> = { OPEN: "Đang hoạt động", UNOPENED: "Chưa mở", CLOSING: "Đang đóng ca", NOT_AVAILABLE: "Không khả dụng" };
const attentionLabels: Record<string, string> = { PARTIAL_ORDER: "Đơn chưa thu đủ", FAILED_PAYMENT: "Thanh toán lỗi", UNISSUED_INVOICE: "Chưa phát hành hóa đơn", CLOSING_SESSION: "Phiên đang đóng ca", CASH_VARIANCE: "Cần kiểm tra chênh lệch" };
const paymentLabels: Record<string, string> = { CASH: "Tiền mặt", CARD_EXTERNAL: "Thẻ", BANK_TRANSFER: "Chuyển khoản", OTHER_EXTERNAL: "Khác" };

function unwrap(body: ApiBody) { return body.data; }
async function getJson(path: string) {
  const response = await authorizedFetch(path);
  const body = (await response.json().catch(() => ({}))) as ApiBody;
  if (!response.ok) throw Object.assign(new Error(body.error?.message ?? "Không thể tải dữ liệu quầy thu ngân."), { status: response.status, code: body.error?.code });
  return unwrap(body);
}
function query(values: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => value && params.set(key, value));
  return params.toString();
}
function money(value: number | null | undefined, currency = "VND") {
  if (value == null) return "—";
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value));
}
function dateTime(value?: string | null, timezone?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(value));
}
function shortId(id?: string | null) { return id ? `#${id.slice(0, 8).toUpperCase()}` : "—"; }
function dateInZone(timezone = "Asia/Ho_Chi_Minh") { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date()); }
function stateOf(item: RegisterView): "OPEN" | "UNOPENED" | "CLOSING" | "NOT_AVAILABLE" {
  if (item.register.status !== "ACTIVE") return "NOT_AVAILABLE";
  if (item.currentSession?.status === "CLOSING") return "CLOSING";
  if (item.currentSession?.status === "OPEN") return "OPEN";
  return "UNOPENED";
}
function errorText(reason: unknown) {
  if (reason && typeof reason === "object" && "code" in reason) {
    const code = String((reason as { code?: string }).code ?? "");
    if (code === "CASH_SESSION_ALREADY_OPEN") return "Quầy hoặc thu ngân đã có phiên đang mở. Dữ liệu đã được tải lại.";
    if (code === "POS_REGISTER_DEVICE_NOT_BOUND") return "Thiết bị hiện tại chưa được liên kết với quầy này.";
    if (code === "POS_REGISTER_DEVICE_SESSION_INVALID") return "Phiên thiết bị không hợp lệ. Hãy đăng nhập lại để tiếp tục.";
  }
  return reason instanceof Error ? reason.message : "Không thể hoàn tất thao tác.";
}

export default function PosRegisterManagementPage() {
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [branchId, setBranchId] = useState(() => getActiveBranchId() ?? "");
  const [overview, setOverview] = useState<Overview>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [message, setMessage] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date>();

  const load = useCallback(async (silent = false) => {
    if (!branchId) { setLoading(false); return; }
    if (!silent) setLoading(true);
    setError("");
    try {
      const value = await getJson(`/v1/pos-registers/overview?${query({ branchId, businessDate: dateInZone(overview?.timezone ?? "Asia/Ho_Chi_Minh") })}`) as Overview;
      setOverview(value);
      setLastUpdated(new Date());
      setSelectedId((current) => current && value.registers.some((item) => item.register.id === current) ? current : value.registers[0]?.register.id);
    } catch (reason) { setError(errorText(reason)); } finally { if (!silent) setLoading(false); }
  }, [branchId, overview?.timezone]);

  useEffect(() => {
    void getAuthorizedBranchContext().then((result) => { setBranches(result.branches); setBranchId(result.branchId ?? ""); }).catch((reason) => setError(errorText(reason)));
    const onBranchChanged = (event: Event) => setBranchId((event as CustomEvent<string | undefined>).detail ?? "");
    window.addEventListener(ACTIVE_BRANCH_CHANGED_EVENT, onBranchChanged);
    return () => window.removeEventListener(ACTIVE_BRANCH_CHANGED_EVENT, onBranchChanged);
  }, []);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(true), 15000); return () => window.clearInterval(timer); }, [load]);

  const filtered = useMemo(() => (overview?.registers ?? []).filter((item) => {
    const state = stateOf(item);
    const haystack = `${item.register.code} ${item.register.name} ${item.cashier?.displayName ?? ""}`.toLowerCase();
    return (status === "ALL" || status === state || (status === "ATTENTION" && item.attention.length > 0)) && (!search.trim() || haystack.includes(search.trim().toLowerCase()));
  }), [overview?.registers, search, status]);
  const selected = (overview?.registers ?? []).find((item) => item.register.id === selectedId) ?? filtered[0];
  const branchName = branches.find((branch) => branch.id === branchId)?.name ?? "Chi nhánh hiện tại";
  const activeCount = (overview?.registers ?? []).filter((item) => item.register.status === "ACTIVE").length;
  const currency = overview?.currency ?? "VND";

  function selectBranch(next: string) { setBranchId(next); setActiveBranchId(next || undefined); setSelectedId(undefined); }
  function navigate(path: string) { window.location.href = path; }

  return <main className={styles.page}>
    <header className={styles.pageHeader}>
      <div><p className={styles.breadcrumb}><span>POS</span><b>/</b> Quầy thu ngân</p><h1>Quản lý quầy thu ngân</h1><p className={styles.subtitle}>Theo dõi trạng thái quầy, phiên thu ngân và tiền mặt trong từng ca làm việc.</p></div>
      <div className={styles.headerActions}><button className={styles.secondaryButton} type="button" onClick={() => navigate("/admin/pos/cash-sessions")}>◷ &nbsp;Lịch sử phiên thu ngân</button><button className={styles.primaryButton} type="button" onClick={() => { const candidate = filtered.find((item) => stateOf(item) === "UNOPENED"); if (candidate) navigate(`/admin/pos/cash-sessions/open?registerId=${candidate.register.id}`); else setMessage("Không có quầy đang sẵn sàng mở phiên."); }}>＋ &nbsp;Mở phiên thu ngân</button></div>
    </header>
    {message && <div className={styles.notice} role="status">{message}<button type="button" onClick={() => setMessage("")}>×</button></div>}
    <section className={styles.kpiGrid} aria-label="Tổng quan quầy thu ngân">
      <Kpi icon="▣" label="Quầy đang hoạt động" value={overview ? `${overview.totals.openRegisterCount} / ${activeCount}` : "—"} detail={overview ? `${overview.totals.unopenedRegisterCount} quầy chưa mở phiên` : "Đang tải dữ liệu"} tone="pink" />
      <Kpi icon="↗" label="Doanh thu trong ca" value={overview?.financialVisible ? money(overview.totals.collectedMinor, currency) : "Được ẩn"} detail={overview?.financialVisible ? "Tổng đã thu trong các phiên mở" : "Theo quyền tài chính"} tone="pink" />
      <Kpi icon="▣" label="Tiền mặt dự kiến" value={overview?.totals.cashExpectedMinor == null ? (overview?.financialVisible ? "Được ẩn" : "Không có quyền") : money(overview.totals.cashExpectedMinor, currency)} detail={overview?.totals.cashExpectedMinor == null ? "Kiểm đếm mù đang bật" : "Từ cash movement thực tế"} tone="red" />
      <Kpi icon="▤" label="Giao dịch trong ca" value={overview?.totals.orderCount == null ? "Được ẩn" : String(overview.totals.orderCount)} detail="Đơn có thanh toán đã ghi nhận" tone="blue" />
      <Kpi icon="!" label="Ngoại lệ cần kiểm tra" value={String(overview?.totals.attentionCount ?? 0)} detail="Đơn, thanh toán hoặc phiên" tone="amber" />
    </section>
    <div className={styles.filterCard}>
      <div className={styles.filterRow}>
        <label className={styles.field}><span>Chi nhánh</span><select value={branchId} onChange={(event) => selectBranch(event.target.value)}>{branches.length !== 1 && <option value="">Chọn chi nhánh</option>}{branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label>
        <label className={styles.field}><span>Trạng thái quầy</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">Tất cả</option><option value="OPEN">Đang hoạt động</option><option value="UNOPENED">Chưa mở</option><option value="CLOSING">Đang đóng ca</option><option value="ATTENTION">Cần kiểm tra</option><option value="NOT_AVAILABLE">Không khả dụng</option></select></label>
        <label className={styles.searchField}><span className="sr-only">Tìm quầy</span><b>⌕</b><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm tên quầy / nhân viên thu ngân..." /></label>
        <button className={styles.refreshButton} type="button" onClick={() => void load()}>↻ &nbsp;Làm mới</button>
      </div>
      <div className={styles.filterMeta}><span className={styles.liveDot}></span>Cập nhật trực tiếp · {lastUpdated ? `lúc ${lastUpdated.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}` : "đang đồng bộ"}<span className={styles.branchHint}>{branchName} · {overview?.businessDate ?? "—"}</span></div>
    </div>
    {loading && !overview && <LoadingState />}
    {error && <div className={styles.errorCard} role="alert"><strong>Không thể tải dữ liệu quầy</strong><span>{error}</span><button type="button" onClick={() => void load()}>Thử lại</button></div>}
    {overview && <div className={styles.workspace}>
      <section className={styles.mainColumn} aria-label="Danh sách quầy thu ngân">
        <div className={styles.sectionHeading}><div><h2>Quầy thu ngân</h2><p>{filtered.length} / {overview.registers.length} quầy theo bộ lọc hiện tại</p></div><span className={styles.legend}><i className={styles.greenDot}></i>Đang hoạt động <i className={styles.grayDot}></i>Chưa mở <i className={styles.amberDot}></i>Cần kiểm tra</span></div>
        {filtered.length === 0 ? <div className={styles.emptyCard}>Không có quầy phù hợp với bộ lọc hiện tại.</div> : <div className={styles.registerGrid}>{filtered.map((item) => <RegisterCard key={item.register.id} item={item} currency={currency} selected={item.register.id === selected?.register.id} onSelect={() => setSelectedId(item.register.id)} onOpen={() => navigate(`/admin/pos/cash-sessions/open?registerId=${item.register.id}`)} onNavigate={navigate} />)}</div>}
        <section className={styles.tableCard}><div className={styles.sectionHeading}><div><h2>Phiên thu ngân đang mở</h2><p>Chỉ hiển thị phiên OPEN và CLOSING trong ngày kinh doanh.</p></div><button className={styles.textButton} type="button" onClick={() => navigate("/admin/pos/cash-sessions")}>Xem lịch sử →</button></div><SessionTable sessions={overview.openSessions} currency={currency} timezone={overview.timezone} onNavigate={navigate} /></section>
        <div className={styles.bottomGrid}><PaymentMix mix={overview.paymentMix} currency={currency} /><RecentActivity activity={overview.activity} currency={currency} timezone={overview.timezone} /></div>
      </section>
      <RightRail item={selected} overview={overview} currency={currency} onOpen={(item) => navigate(`/admin/pos/cash-sessions/open?registerId=${item.register.id}`)} onNavigate={navigate} />
    </div>}
    <footer className={styles.stickyFooter}><button className={styles.footerSecondary} type="button" onClick={() => navigate("/admin/pos")}>← &nbsp;POS / Bán hàng</button><div><button className={styles.footerSecondary} type="button" onClick={() => navigate("/admin/pos/cash-sessions")}>◷ &nbsp;Lịch sử phiên</button><button className={styles.footerPrimary} type="button" onClick={() => { if (selected && stateOf(selected) === "UNOPENED") navigate(`/admin/pos/cash-sessions/open?registerId=${selected.register.id}`); else navigate("/admin/pos/orders"); }}>＋ &nbsp;Tạo đơn mới</button></div></footer>
  </main>;
}

function Kpi({ icon, label, value, detail, tone }: { icon: string; label: string; value: string; detail: string; tone: string }) { return <article className={styles.kpi}><span className={`${styles.kpiIcon} ${styles[`tone_${tone}`]}`}>{icon}</span><div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div></article>; }

function RegisterCard({ item, currency, selected, onSelect, onOpen, onNavigate }: { item: RegisterView; currency: string; selected: boolean; onSelect: () => void; onOpen: () => void; onNavigate: (path: string) => void }) {
  const state = stateOf(item); const session = item.currentSession; const metrics = item.metrics;
  return <article className={`${styles.registerCard} ${selected ? styles.registerSelected : ""}`} onClick={onSelect} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") onSelect(); }}>
    <div className={styles.cardTop}><div><h3>{item.register.name}</h3><span>{item.register.code}</span></div><StatusBadge state={state} /></div>
    {session ? <><div className={styles.cashier}><span className={styles.avatar}>{(item.cashier?.displayName ?? "?").slice(0, 1).toUpperCase()}</span><div><strong>{item.cashier?.displayName ?? "Thu ngân chưa xác định"}</strong><small>{shortId(session.id)} · mở {dateTime(session.openedAt, session.timezone)}</small></div></div><div className={styles.cardStats}><div><span>Giao dịch</span><b>{metrics?.orderCount ?? 0}</b></div><div><span>Đã thu</span><b>{metrics?.totalCollectedMinor == null ? "Được ẩn" : money(metrics.totalCollectedMinor, currency)}</b></div><div><span>Tiền mặt dự kiến</span><b>{session.expectedCashMinor == null ? "Được ẩn" : money(session.expectedCashMinor, currency)}</b></div></div></> : <div className={styles.unopened}><span className={styles.registerGlyph}>▣</span><p>Chưa có phiên thu ngân đang hoạt động.</p><small>Sẵn sàng sử dụng</small></div>}
    <div className={styles.deviceLine}><span>Thiết bị</span><b><i className={styles.greenDot}></i>{item.register.deviceBindingRequired ? "Yêu cầu thiết bị đã liên kết" : "Không yêu cầu liên kết"}</b></div>
    <div className={styles.cardActions}>{session ? <><button type="button" onClick={(event) => { event.stopPropagation(); onNavigate(`/admin/pos/cash-sessions/${session.id}`); }}>◷ &nbsp;Xem phiên</button>{state === "CLOSING" && <button type="button" onClick={(event) => { event.stopPropagation(); onNavigate(`/admin/pos/cash-sessions/${session.id}/close`); }}>Tiếp tục đóng ca</button>}</> : <button type="button" onClick={(event) => { event.stopPropagation(); onOpen(); }}>Mở phiên</button>}</div>
  </article>;
}

function StatusBadge({ state }: { state: string }) { return <span className={`${styles.statusBadge} ${styles[`state_${state}`]}`}><i></i>{statusLabels[state] ?? state}</span>; }

function SessionTable({ sessions, currency, timezone, onNavigate }: { sessions: Array<Session & { metrics: Metrics | null }>; currency: string; timezone: string; onNavigate: (path: string) => void }) { return <div className={styles.tableScroll}><table><thead><tr><th>Phiên</th><th>Quầy</th><th>Thu ngân</th><th>Bắt đầu</th><th>Giao dịch</th><th>Doanh thu</th><th>Tiền mặt dự kiến</th><th>Trạng thái</th><th></th></tr></thead><tbody>{sessions.map((session) => <tr key={session.id}><td><strong>{shortId(session.id)}</strong><small>{session.businessDate}</small></td><td>{session.registerCode}</td><td>{session.cashier?.displayName ?? "—"}</td><td>{dateTime(session.openedAt, timezone)}</td><td>{session.metrics?.orderCount ?? 0}</td><td>{session.metrics?.totalCollectedMinor == null ? "Được ẩn" : money(session.metrics.totalCollectedMinor, currency)}</td><td>{session.expectedCashMinor == null ? "Được ẩn" : money(session.expectedCashMinor, currency)}</td><td><StatusBadge state={session.status === "CLOSING" ? "CLOSING" : "OPEN"} /></td><td><button className={styles.tableAction} type="button" onClick={() => onNavigate(`/admin/pos/cash-sessions/${session.id}${session.status === "CLOSING" ? "/close" : ""}`)}>{session.status === "CLOSING" ? "Đóng ca" : "Xem"}</button></td></tr>)}</tbody></table>{sessions.length === 0 && <div className={styles.tableEmpty}>Chưa có phiên OPEN hoặc CLOSING trong ngày này.</div>}</div>; }

function PaymentMix({ mix, currency }: { mix: Record<string, { amountMinor: number; count: number }> | null; currency: string }) { const rows = Object.entries(mix ?? {}).sort(([, a], [, b]) => Number(b.amountMinor) - Number(a.amountMinor)); const total = rows.reduce((sum, [, value]) => sum + Number(value.amountMinor), 0); return <section className={styles.smallCard}><div className={styles.sectionHeading}><div><h2>Thanh toán trong phiên</h2><p>Phân bổ theo phương thức đã ghi nhận.</p></div></div>{rows.length ? rows.map(([key, value]) => <div className={styles.mixRow} key={key}><span><i className={`${styles.mixDot} ${styles[`mix_${key}`]}`}></i>{paymentLabels[key] ?? key}</span><b>{total ? Math.round(Number(value.amountMinor) / total * 100) : 0}%</b><strong>{money(Number(value.amountMinor), currency)}</strong></div>) : <div className={styles.railEmpty}>{mix === null ? "Dữ liệu tài chính được giới hạn theo quyền." : "Chưa có giao dịch đã ghi nhận."}</div>}</section>; }

function RecentActivity({ activity, currency, timezone }: { activity: Activity[]; currency: string; timezone: string }) { return <section className={styles.smallCard}><div className={styles.sectionHeading}><div><h2>Hoạt động gần đây</h2><p>Nhật ký sự kiện từ API.</p></div></div>{activity.slice(0, 5).map((event) => <div className={styles.activityRow} key={`${event.code}-${event.id}`}><i></i><div><strong>{activityLabel(event.code)}</strong><small>{event.actorName ?? "Hệ thống"} · {dateTime(event.occurredAt, timezone)}</small></div><b>{event.amountMinor == null ? "" : money(event.amountMinor, currency)}</b></div>)}{activity.length === 0 && <div className={styles.railEmpty}>Chưa có hoạt động gần đây.</div>}</section>; }
function activityLabel(code: string) { const labels: Record<string, string> = { PAYMENT_CAPTURED: "Thanh toán đã ghi nhận", CASH_SESSION_OPENED: "Mở phiên thu ngân", CLOSING_STARTED: "Bắt đầu đóng ca", CASH_SESSION_UPDATED: "Cập nhật phiên", CASH_MOVEMENT: "Biến động tiền mặt" }; return labels[code] ?? code; }

function RightRail({ item, overview, currency, onOpen, onNavigate }: { item: RegisterView | undefined; overview: Overview; currency: string; onOpen: (item: RegisterView) => void; onNavigate: (path: string) => void }) { const session = item?.currentSession; const state = item ? stateOf(item) : "UNOPENED"; const attention = item?.attention ?? []; return <aside className={styles.rail} aria-label="Chi tiết quầy thu ngân"><section className={styles.railCard}><div className={styles.sectionHeading}><div><h2>Chi tiết quầy</h2><p>Đang chọn theo danh sách bên trái.</p></div></div>{item ? <><div className={styles.railRegister}><span className={styles.largeGlyph}>▣</span><div><strong>{item.register.name}</strong><small>{item.register.code} · {item.register.status === "ACTIVE" ? "Đang hoạt động" : "Không khả dụng"}</small></div></div><dl className={styles.detailList}><div><dt>Chi nhánh</dt><dd>{item.register.branchId === overview.branchId ? "Chi nhánh hiện tại" : item.register.branchId}</dd></div><div><dt>Thiết bị</dt><dd>{item.register.deviceBindingRequired ? "Bắt buộc liên kết" : "Không bắt buộc"}</dd></div><div><dt>Ngăn kéo</dt><dd>{item.register.drawers.filter((drawer) => drawer.status === "ACTIVE").map((drawer) => drawer.code).join(", ") || "Chưa cấu hình"}</dd></div></dl></> : <div className={styles.railEmpty}>Chọn một quầy để xem chi tiết.</div>}</section><section className={styles.railCard}><div className={styles.sectionHeading}><div><h2>Phiên hiện tại</h2><p>{session ? shortId(session.id) : "Không có phiên đang mở"}</p></div>{session && <StatusBadge state={state} />}</div>{session ? <><dl className={styles.detailList}><div><dt>Thu ngân</dt><dd>{item?.cashier?.displayName ?? "—"}</dd></div><div><dt>Mở lúc</dt><dd>{dateTime(session.openedAt, session.timezone)}</dd></div><div><dt>Thời gian hoạt động</dt><dd>{session.businessDate}</dd></div><div><dt>Tiền mặt dự kiến</dt><dd>{session.expectedCashMinor == null ? "Được ẩn" : money(session.expectedCashMinor, currency)}</dd></div></dl><div className={styles.railActions}><button type="button" onClick={() => onNavigate(`/admin/pos/cash-sessions/${session.id}`)}>Xem phiên</button>{state === "CLOSING" ? <button type="button" onClick={() => onNavigate(`/admin/pos/cash-sessions/${session.id}/close`)}>Đóng ca</button> : <button type="button" onClick={() => onNavigate(`/admin/pos/orders?cashSessionId=${session.id}`)}>Xem đơn</button>}</div></> : item && state === "UNOPENED" ? <button className={styles.fullButton} type="button" onClick={() => onOpen(item)}>＋ &nbsp;Mở phiên thu ngân</button> : <div className={styles.railEmpty}>Quầy hiện không sẵn sàng để thao tác.</div>}</section><section className={styles.railCard}><div className={styles.sectionHeading}><div><h2>Tiền mặt trong quầy</h2><p>Số liệu từ phiên hiện tại.</p></div></div>{session && item?.metrics?.movements && !session.blindCount && overview.financialVisible ? <><strong className={styles.railMoney}>{money(item.metrics.movements.openingFloatMinor + item.metrics.movements.cashSalesMinor + item.metrics.movements.cashInMinor - item.metrics.movements.cashOutMinor, currency)}</strong><small className={styles.muted}>Dự kiến theo cash movement thực tế</small><dl className={styles.detailList}><div><dt>Đầu ca</dt><dd>{money(item.metrics.movements.openingFloatMinor, currency)}</dd></div><div><dt>Bán hàng tiền mặt</dt><dd>+{money(item.metrics.movements.cashSalesMinor, currency)}</dd></div><div><dt>Tiền ra</dt><dd>-{money(item.metrics.movements.cashOutMinor, currency)}</dd></div></dl></> : <div className={styles.hiddenPanel}>{session?.blindCount ? "Đang bật chế độ kiểm đếm mù." : "Số liệu chỉ hiển thị khi có quyền tài chính."}</div>}</section><section className={styles.railCard}><div className={styles.sectionHeading}><div><h2>Cần chú ý</h2><p>{attention.length} sự kiện cần xử lý.</p></div><span className={styles.countBadge}>{attention.length}</span></div>{attention.slice(0, 5).map((event) => <button className={styles.attentionRow} key={`${event.code}-${event.orderId ?? event.sessionId}`} type="button" onClick={() => event.sessionId ? onNavigate(`/admin/pos/cash-sessions/${event.sessionId}${event.code === "CLOSING_SESSION" ? "/close" : ""}`) : event.orderId ? onNavigate(`/admin/pos/orders/${event.orderId}`) : undefined}><span className={`${styles.attentionIcon} ${event.code === "CASH_VARIANCE" ? styles.attentionRed : ""}`}>!</span><span><strong>{attentionLabels[event.code] ?? event.code}</strong><small>{event.amountMinor == null ? "" : money(event.amountMinor, currency)}</small></span><b>→</b></button>)}{attention.length === 0 && <div className={styles.railEmpty}>Không có ngoại lệ cần xử lý.</div>}</section><section className={styles.railCard}><h2>Thao tác nhanh</h2><button className={styles.actionRow} type="button" onClick={() => onNavigate("/admin/pos/orders")}>▤ <span>Tạo hoặc xem đơn POS</span><b>→</b></button><button className={styles.actionRow} type="button" onClick={() => onNavigate("/admin/pos/cash-sessions")}>◷ <span>Xem lịch sử phiên</span><b>→</b></button><div className={styles.securityNote}><strong>◈ &nbsp;Kiểm soát an toàn</strong><p>Thao tác mở và đóng ca được ghi nhật ký. Số liệu kiểm đếm có thể bị ẩn theo vai trò.</p></div></section></aside>; }

function LoadingState() { return <div className={styles.loadingGrid} role="status" aria-label="Đang tải dữ liệu">{[1, 2, 3].map((value) => <div className={styles.skeletonCard} key={value}></div>)}</div>; }

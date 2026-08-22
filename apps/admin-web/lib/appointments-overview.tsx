/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Icon } from "@nailsoft/ui-web";
import {
  ACTIVE_BRANCH_CHANGED_EVENT,
  authorizedFetch,
  getAuthorizedBranchContext,
  setActiveBranchId,
} from "./auth";

type State = "loading" | "ready" | "empty" | "error" | "forbidden";
type ViewMode = "list" | "day" | "week";
type Branch = { id: string; name: string; timezone: string; status: string };
type Staff = { id: string; displayName: string; avatarMediaId?: string | null };
type Service = { id: string; code?: string; name?: Record<string, string> | string };
type AppointmentItem = {
  id: string;
  serviceId: string;
  serviceName: string;
  startAt: string;
  endAt: string;
  durationMin: number;
  status: string;
  staffId?: string | null;
  staffName?: string | null;
};
type Appointment = {
  id: string;
  bookingReference: string;
  branch: { id: string; name: string; timezone: string };
  customer: { id?: string | null; displayName: string; phone?: string | null };
  status: string;
  startAt: string;
  endAt: string;
  createdAt?: string;
  version: number;
  customerNote?: string | null;
  items: AppointmentItem[];
};
type Overview = {
  timezone: string | null;
  summary: {
    total: number;
    pendingConfirmation: number;
    inService: number;
    completed: number;
    noShow: number;
    eligibleNoShow: number;
    noShowRate: number | null;
  };
  items: Appointment[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
};
type BusinessHour = { dayOfWeek: number; openTime?: string | null; closeTime?: string | null; isClosed?: boolean };

const statusLabels: Record<string, string> = {
  DRAFT: "Nháp",
  SLOT_HELD: "Đang giữ chỗ",
  PENDING_CONFIRMATION: "Chờ xác nhận",
  PENDING_DEPOSIT: "Chờ cọc",
  CONFIRMED: "Đã xác nhận",
  CHECKED_IN: "Đã check-in",
  IN_SERVICE: "Đang phục vụ",
  PARTIALLY_COMPLETED: "Đang phục vụ",
  COMPLETED: "Hoàn thành",
  CHECKED_OUT: "Đã thanh toán",
  PAID: "Đã thanh toán",
  NO_SHOW: "No-show",
  EXPIRED: "Hết hạn",
  CANCELLED_BY_CUSTOMER: "Đã hủy",
  CANCELLED_BY_SALON: "Đã hủy",
  RESCHEDULED: "Đã dời lịch",
};

function displayName(value: Record<string, string> | string | undefined, fallback = "—") {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  return value["vi-VN"] ?? value["en-US"] ?? Object.values(value)[0] ?? fallback;
}

function dateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { year: get("year"), month: get("month"), day: get("day") };
}

function localDate(date: Date, timeZone: string) {
  const parts = dateParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function zoneOffset(date: Date, timeZone: string) {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(date)
      .find((item) => item.type === "timeZoneName")?.value ?? "GMT";
    if (part === "GMT") return "+00:00";
    const match = part.match(/GMT([+-])(\d{2}):?(\d{2})?/);
    return match ? `${match[1]}${match[2]}:${match[3] ?? "00"}` : "+00:00";
  } catch {
    return "+00:00";
  }
}

function rangeForDate(value: string, timeZone: string, days = 1) {
  const noon = new Date(`${value}T12:00:00Z`);
  const next = shiftDate(value, days);
  return {
    from: new Date(`${value}T00:00:00${zoneOffset(noon, timeZone)}`).toISOString(),
    to: new Date(`${next}T00:00:00${zoneOffset(new Date(`${next}T12:00:00Z`), timeZone)}`).toISOString(),
  };
}

function formatDate(value: string, timeZone: string, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat("vi-VN", { timeZone, ...options }).format(new Date(value));
}

function formatTime(value: string, timeZone: string) {
  return formatDate(value, timeZone, { hour: "2-digit", minute: "2-digit", hour12: false });
}

function minuteOfDay(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date(value));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(-2).map((part) => part[0]).join("").toUpperCase() || "?";
}

function unwrap(body: any) {
  return body?.data ?? body;
}

async function readJson(path: string) {
  const response = await authorizedFetch(path);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    const error = new Error("Permission denied");
    (error as any).forbidden = true;
    throw error;
  }
  if (!response.ok) throw new Error(body?.error?.message ?? "Không thể tải dữ liệu.");
  return unwrap(body);
}

function permission(context: any, code: string) {
  return Boolean(context?.authorization?.permissions?.includes(code));
}

export default function AppointmentsOverview() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const overviewPath = pathname.startsWith("/admin/calendar") ? "/admin/calendar" : "/admin/appointments";
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [context, setContext] = useState<any>();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [timeZone, setTimeZone] = useState("Asia/Ho_Chi_Minh");
  const [date, setDate] = useState(() => localDate(new Date(), "Asia/Ho_Chi_Minh"));
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [staffId, setStaffId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [page, setPage] = useState(1);
  const [overview, setOverview] = useState<Overview>();
  const [hours, setHours] = useState<BusinessHour[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedDetail, setSelectedDetail] = useState<any>();
  const [detailState, setDetailState] = useState<State>("empty");
  const [saving, setSaving] = useState(false);
  const confirmIntentKey = useRef<string | undefined>(undefined);
  const exportIntentKey = useRef<string | undefined>(undefined);

  const branch = branches.find((item) => item.id === branchId);
  const canCreate = permission(context, "appointment.create");
  const canExport = permission(context, "analytics.export");
  const canConfirm = permission(context, "appointment.confirm");
  const canReschedule = permission(context, "appointment.reschedule");
  const items = overview?.items ?? [];
  const selected = selectedDetail ?? items.find((item) => item.id === selectedId);

  const loadWorkspace = useCallback(async () => {
    try {
      const result = await getAuthorizedBranchContext();
      setContext(result.context);
      setBranches(result.branches as Branch[]);
      const nextBranchId = result.branchId ?? result.branches[0]?.id ?? "";
      setBranchId(nextBranchId);
      const nextBranch = result.branches.find((item) => item.id === nextBranchId) as Branch | undefined;
      if (nextBranch?.timezone) {
        setTimeZone(nextBranch.timezone);
        setDate((current) => current || localDate(new Date(), nextBranch.timezone));
      }
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể tải workspace.");
      setState(cause?.forbidden ? "forbidden" : "error");
    }
  }, []);

  useEffect(() => {
    void loadWorkspace();
    const onBranchChange = (event: Event) => {
      const next = (event as CustomEvent<string | undefined>).detail;
      if (next) {
        setActiveBranchId(next);
        setBranchId(next);
        setPage(1);
      }
    };
    window.addEventListener(ACTIVE_BRANCH_CHANGED_EVENT, onBranchChange);
    return () => window.removeEventListener(ACTIVE_BRANCH_CHANGED_EVENT, onBranchChange);
  }, [loadWorkspace]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async () => {
    if (!branchId) return;
    setState("loading");
    setError("");
    const range = rangeForDate(date, timeZone, viewMode === "week" ? 7 : 1);
    const params = new URLSearchParams({
      branchId,
      from: range.from,
      to: range.to,
      page: String(page),
      pageSize: "50",
    });
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    if (staffId) params.set("staffId", staffId);
    if (serviceId) params.set("serviceId", serviceId);
    try {
      const [overviewValue, hoursValue, staffValue, servicesValue] = await Promise.all([
        readJson(`/v1/appointments/overview?${params.toString()}`),
        readJson(`/v1/branches/${branchId}/business-hours`),
        readJson(`/v1/staff?status=ACTIVE&branchId=${encodeURIComponent(branchId)}`),
        readJson("/v1/services?status=ACTIVE&pageSize=100"),
      ]);
      if (overviewValue.timezone) setTimeZone(overviewValue.timezone);
      setOverview(overviewValue as Overview);
      setHours(Array.isArray(hoursValue) ? hoursValue : []);
      setStaff(Array.isArray(staffValue) ? staffValue : []);
      setServices(Array.isArray(servicesValue) ? servicesValue : []);
      setSelectedId((current) => current && (overviewValue.items ?? []).some((item: Appointment) => item.id === current) ? current : overviewValue.items?.[0]?.id ?? "");
      setSelectedDetail(undefined);
      setState(overviewValue.items?.length ? "ready" : "empty");
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể tải lịch hẹn.");
      setState(cause?.forbidden ? "forbidden" : "error");
    }
  }, [branchId, date, page, search, serviceId, staffId, status, timeZone, viewMode]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!branch?.timezone || branch.timezone === timeZone) return;
    setTimeZone(branch.timezone);
    setDate(localDate(new Date(), branch.timezone));
  }, [branch, timeZone]);

  useEffect(() => {
    const requestedView = searchParams.get("view");
    if (requestedView === "list" || requestedView === "day" || requestedView === "week") {
      setViewMode(requestedView);
    }
    const requestedStatus = searchParams.get("status");
    if (requestedStatus) setStatus(requestedStatus);
  }, [searchParams]);

  async function loadDetail(id: string) {
    setSelectedId(id);
    setDetailState("loading");
    try {
      setSelectedDetail(await readJson(`/v1/appointments/${id}`));
      setDetailState("ready");
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể tải chi tiết lịch hẹn.");
      setDetailState(cause?.forbidden ? "forbidden" : "error");
    }
  }

  async function confirmSelected() {
    if (!selected || !canConfirm) return;
    setSaving(true);
    setNotice("");
    try {
      const response = await authorizedFetch(`/v1/appointments/${selected.id}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": confirmIntentKey.current ?? (confirmIntentKey.current = crypto.randomUUID()) },
        body: JSON.stringify({ version: selected.version }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message ?? "Không thể xác nhận lịch hẹn.");
      confirmIntentKey.current = undefined;
      setNotice("Đã xác nhận lịch hẹn.");
      await load();
      await loadDetail(selected.id);
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể xác nhận lịch hẹn.");
    } finally {
      setSaving(false);
    }
  }

  async function requestExport() {
    setNotice("");
    const range = rangeForDate(date, timeZone, viewMode === "week" ? 7 : 1);
    const response = await authorizedFetch("/v1/analytics/exports", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": exportIntentKey.current ?? (exportIntentKey.current = crypto.randomUUID()) },
      body: JSON.stringify({ exportType: "APPOINTMENTS", filters: { from: range.from, to: range.to, branchIds: [branchId] } }),
    });
    if (response.ok) exportIntentKey.current = undefined;
    setNotice(response.ok ? "Đã gửi yêu cầu xuất báo cáo." : "Không thể xuất báo cáo với quyền hiện tại.");
  }

  function changeView(next: ViewMode) {
    setViewMode(next);
    setPage(1);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("view", next);
    router.replace(`${overviewPath}?${nextParams.toString()}`);
  }

  function moveDate(days: number) {
    setDate((current) => shiftDate(current, days));
    setPage(1);
  }

  const titleDate = formatDate(`${date}T12:00:00Z`, timeZone, { day: "2-digit", month: "2-digit", year: "numeric" });
  const role = context?.authorization?.roles?.[0];

  return (
    <main className="ns-appointments-page">
      <header className="ns-appointments-heading">
        <div>
          <h1>Quản lý lịch hẹn</h1>
          <p><Icon name="calendar" /> Theo dõi, sắp xếp và quản lý toàn bộ lịch hẹn của khách hàng.</p>
        </div>
        <div className="ns-appointments-actions">
          {canExport ? <button className="ns-button ns-button--secondary" onClick={() => void requestExport()}><Icon name="download" /> Xuất báo cáo</button> : null}
          {canCreate ? <Link className="ns-button ns-button--primary" href="/admin/appointments/new"><Icon name="plus" /> Tạo lịch hẹn mới</Link> : null}
        </div>
      </header>
      {notice ? <p className="ns-appointments-notice" role="status">{notice}</p> : null}
      {state === "forbidden" ? <StatePanel title="Không có quyền xem lịch hẹn" detail="Quyền hoặc phạm vi chi nhánh của tài khoản hiện tại không cho phép truy cập." /> : null}
      {state === "error" ? <StatePanel title="Không thể tải lịch hẹn" detail={error} retry={() => void load()} /> : null}
      <KpiRow summary={overview?.summary} loading={state === "loading"} />
      <section className="ns-appointments-toolbar" aria-label="Bộ lọc lịch hẹn">
        <label className="ns-appointments-search"><Icon name="search" /><span className="sr-only">Tìm kiếm khách hàng</span><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Tìm theo tên khách hàng / SĐT" /></label>
        <label><span>Chi nhánh</span><select value={branchId} onChange={(event) => { setActiveBranchId(event.target.value); setBranchId(event.target.value); setPage(1); }}>{branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label><span>Kỹ thuật viên</span><select value={staffId} onChange={(event) => { setStaffId(event.target.value); setPage(1); }}><option value="">Tất cả</option>{staff.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
        <label><span>Dịch vụ</span><select value={serviceId} onChange={(event) => { setServiceId(event.target.value); setPage(1); }}><option value="">Tất cả</option>{services.map((item) => <option key={item.id} value={item.id}>{displayName(item.name, item.code)}</option>)}</select></label>
        <div className="ns-date-picker"><button aria-label="Ngày trước" onClick={() => moveDate(-1)}><Icon name="chevronLeft" /></button><span><Icon name="calendar" /> {titleDate}</span><button aria-label="Ngày sau" onClick={() => moveDate(1)}><Icon name="chevronRight" /></button></div>
        <div className="ns-view-switch" role="tablist" aria-label="Kiểu hiển thị"><button className={viewMode === "list" ? "is-active" : ""} onClick={() => changeView("list")} role="tab" aria-selected={viewMode === "list"}>Danh sách</button><button className={viewMode === "day" ? "is-active" : ""} onClick={() => changeView("day")} role="tab" aria-selected={viewMode === "day"}>Lịch ngày</button><button className={viewMode === "week" ? "is-active" : ""} onClick={() => changeView("week")} role="tab" aria-selected={viewMode === "week"}>Lịch tuần</button></div>
      </section>
      <div className="ns-status-filter" role="group" aria-label="Trạng thái lịch hẹn">
        <button className={!status ? "is-active" : ""} onClick={() => { setStatus(""); setPage(1); }}>Tất cả</button>
        {(["PENDING_CONFIRMATION", "CONFIRMED", "IN_SERVICE", "COMPLETED", "CANCELLED_BY_CUSTOMER", "NO_SHOW"] as const).map((value) => <button key={value} className={status === value ? "is-active" : ""} data-status={value} onClick={() => { setStatus((current) => current === value ? "" : value); setPage(1); }}>{statusLabels[value]}</button>)}
      </div>
      {state === "loading" ? <LoadingGrid /> : null}
      {state !== "loading" && state !== "forbidden" && state !== "error" ? (
        <>
          <div className="ns-appointments-main-grid">
            <section className="ns-appointments-schedule-panel">
              <div className="ns-panel-heading"><div><h2>{viewMode === "week" ? "Lịch hẹn trong tuần" : "Lịch hẹn trong ngày"}</h2><small>{branch?.name ?? "Chi nhánh hiện tại"} · {overview?.timezone ?? timeZone}</small></div><button className="ns-icon-button" onClick={() => void load()} aria-label="Làm mới lịch hẹn"><Icon name="refresh" /></button></div>
              {viewMode === "list" ? <AppointmentTable appointments={items} timeZone={timeZone} page={overview?.pagination} onSelect={loadDetail} /> : viewMode === "week" ? <WeekView appointments={items} timeZone={timeZone} onSelect={loadDetail} /> : <DayScheduler appointments={items} staff={staff} hours={hours} date={date} timeZone={timeZone} selectedId={selectedId} onSelect={loadDetail} />}
              {viewMode !== "list" ? <AppointmentTable appointments={items} timeZone={timeZone} page={overview?.pagination} onSelect={loadDetail} /> : null}
            </section>
            <aside className="ns-appointments-side-rail">
              <AppointmentDetail appointment={selected} state={detailState} timeZone={timeZone} canConfirm={canConfirm} canReschedule={canReschedule} saving={saving} onConfirm={() => void confirmSelected()} />
              <UpcomingCard appointments={items} timeZone={timeZone} onSelect={loadDetail} />
              <PendingCard appointments={items} timeZone={timeZone} overviewPath={overviewPath} onSelect={loadDetail} />
            </aside>
          </div>
          {viewMode !== "list" ? <Pagination page={overview?.pagination} onChange={setPage} /> : null}
        </>
      ) : null}
      {state === "empty" ? <StatePanel title="Không có lịch hẹn" detail="Không có lịch hẹn phù hợp với ngày và bộ lọc hiện tại." retry={() => void load()} /> : null}
      <span className="sr-only">{role ?? ""}</span>
    </main>
  );
}

function StatePanel({ title, detail, retry }: { title: string; detail: string; retry?: () => void }) {
  return <div className="ns-appointments-state" role="alert"><Icon name="calendar" /><div><strong>{title}</strong><p>{detail}</p>{retry ? <button className="ns-button ns-button--secondary" onClick={retry}>Thử lại</button> : null}</div></div>;
}

function KpiRow({ summary, loading }: { summary: Overview["summary"] | undefined; loading: boolean }) {
  const cards = [
    ["Lịch hẹn hôm nay", summary?.total, "calendar", "ns-kpi-rose"],
    ["Chờ xác nhận", summary?.pendingConfirmation, "clock", "ns-kpi-amber"],
    ["Đang phục vụ", summary?.inService, "people", "ns-kpi-purple"],
    ["Hoàn thành hôm nay", summary?.completed, "check", "ns-kpi-green"],
    ["Tỷ lệ no-show", summary?.noShowRate == null ? "—" : `${Math.round(summary.noShowRate * 100)}%`, "alert", "ns-kpi-red"],
  ] as const;
  return <section className="ns-appointments-kpis">{cards.map(([title, value, icon, tone]) => <article className={`ns-appointments-kpi ${tone}`} key={title}><span className="ns-kpi-icon"><Icon name={icon} /></span><div><small>{title}</small><strong>{loading ? "—" : value ?? "—"}</strong><em>{loading ? "Đang tải dữ liệu" : title === "Tỷ lệ no-show" && summary?.noShowRate == null ? "Chưa đủ dữ liệu so sánh" : "Theo dữ liệu lịch hẹn thật"}</em></div></article>)}</section>;
}

function LoadingGrid() {
  return <div className="ns-appointments-loading" aria-busy="true"><span /><span /><span /></div>;
}

function statusClass(status: string) {
  if (["CONFIRMED", "CHECKED_IN"].includes(status)) return "confirmed";
  if (["PENDING_CONFIRMATION", "PENDING_DEPOSIT"].includes(status)) return "pending";
  if (["IN_SERVICE", "PARTIALLY_COMPLETED"].includes(status)) return "in-service";
  if (["COMPLETED", "CHECKED_OUT", "PAID"].includes(status)) return "completed";
  if (status === "NO_SHOW") return "no-show";
  return "cancelled";
}

function itemFor(appointment: Appointment) {
  return appointment.items[0] ?? { id: appointment.id, serviceId: "", serviceName: "Chưa có dịch vụ", startAt: appointment.startAt, endAt: appointment.endAt, durationMin: Math.max(1, Math.round((new Date(appointment.endAt).getTime() - new Date(appointment.startAt).getTime()) / 60000)), status: appointment.status, staffId: null, staffName: null };
}

function DayScheduler({ appointments, staff, hours, date, timeZone, selectedId, onSelect }: { appointments: Appointment[]; staff: Staff[]; hours: BusinessHour[]; date: string; timeZone: string; selectedId: string; onSelect: (id: string) => void }) {
  const dayItems = appointments.filter((appointment) => localDate(new Date(appointment.startAt), timeZone) === date);
  const technicians = Array.from(new Map(dayItems.flatMap((appointment) => appointment.items).filter((item) => item.staffId).map((item) => [item.staffId, { id: item.staffId as string, displayName: item.staffName ?? "Kỹ thuật viên" }])).values());
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const configured = hours.find((item) => item.dayOfWeek === weekday && !item.isClosed);
  const fallbackStart = dayItems.length ? Math.min(...dayItems.map((item) => minuteOfDay(item.startAt, timeZone))) : 9 * 60;
  const fallbackEnd = dayItems.length ? Math.max(...dayItems.map((item) => minuteOfDay(item.endAt, timeZone))) : 18 * 60;
  const start = configured?.openTime ? parseMinutes(configured.openTime) : Math.floor(fallbackStart / 60) * 60;
  const end = configured?.closeTime ? parseMinutes(configured.closeTime) : Math.ceil(fallbackEnd / 60) * 60;
  const startMin = Math.min(start, fallbackStart);
  const endMin = Math.max(end, fallbackEnd, startMin + 60);
  const hoursCount = Math.max(1, Math.ceil((endMin - startMin) / 60));
  const columns = technicians.length ? technicians : staff.map((item) => ({ id: item.id, displayName: item.displayName }));
  const visibleColumns = columns.length ? columns : [{ id: "unassigned", displayName: "Chưa phân công" }];
  const blocks = visibleColumns.map((column) => ({ column, blocks: layoutOverlaps(dayItems.flatMap((appointment) => appointment.items.filter((item) => (item.staffId ?? "unassigned") === column.id).map((item) => ({ appointment, item })))) }));
  return <div className="ns-day-scheduler" style={{ "--ns-scheduler-height": `${hoursCount * 72}px`, "--ns-scheduler-columns": visibleColumns.length } as CSSProperties}>
    <div className="ns-scheduler-corner">Giờ</div>
    {visibleColumns.map((column) => <div className="ns-scheduler-technician" key={column.id}><span className="ns-avatar ns-avatar--small">{initials(column.displayName)}</span><strong>{column.displayName}</strong></div>)}
    <div className="ns-scheduler-hours">{Array.from({ length: hoursCount + 1 }, (_, index) => <span key={index} style={{ top: `${index * 72}px` }}>{String(Math.floor((startMin + index * 60) / 60)).padStart(2, "0")}:00</span>)}</div>
    {blocks.map(({ column, blocks: columnBlocks }) => <div className="ns-scheduler-column" key={column.id}>{Array.from({ length: hoursCount }, (_, index) => <i key={index} style={{ top: `${index * 72}px` }} />)}{columnBlocks.map(({ appointment, item, left, width }) => { const top = ((minuteOfDay(item.startAt, timeZone) - startMin) / 60) * 72; const height = Math.max(44, ((new Date(item.endAt).getTime() - new Date(item.startAt).getTime()) / 60000 / 60) * 72); return <button className={`ns-appointment-block ns-appointment-block--${statusClass(appointment.status)} ${selectedId === appointment.id ? "is-selected" : ""}`} key={`${appointment.id}-${item.id}`} style={{ top: `${top}px`, height: `${height}px`, left: `${left}%`, width: `${width}%` }} onClick={() => onSelect(appointment.id)}><strong>{appointment.customer.displayName}</strong><span>{item.serviceName}</span><small>{formatTime(item.startAt, timeZone)} – {formatTime(item.endAt, timeZone)} · {item.durationMin} phút</small></button>; })}</div>)}
    {!dayItems.length ? <div className="ns-scheduler-empty">Không có lịch hẹn trong ngày này.</div> : null}
  </div>;
}

function parseMinutes(value: string) { const parts = value.split(":").map(Number); return (parts[0] ?? 0) * 60 + (parts[1] ?? 0); }

function layoutOverlaps(entries: Array<{ appointment: Appointment; item: AppointmentItem }>) {
  const sorted = [...entries].sort((a, b) => new Date(a.item.startAt).getTime() - new Date(b.item.startAt).getTime());
  const columns: number[] = [];
  const placed = sorted.map((entry) => { const start = new Date(entry.item.startAt).getTime(); let column = columns.findIndex((end) => end <= start); if (column < 0) { column = columns.length; columns.push(0); } columns[column] = new Date(entry.item.endAt).getTime(); return { ...entry, column }; });
  const count = Math.max(1, columns.length);
  return placed.map((entry) => ({ ...entry, left: (entry.column / count) * 100 + 1, width: 100 / count - 2 }));
}

function WeekView({ appointments, timeZone, onSelect }: { appointments: Appointment[]; timeZone: string; onSelect: (id: string) => void }) {
  const days = Array.from(new Set(appointments.map((item) => localDate(new Date(item.startAt), timeZone)))).sort();
  if (!days.length) return <div className="ns-week-empty">Không có lịch hẹn trong tuần này.</div>;
  return <div className="ns-week-view">{days.map((day) => <section key={day}><header><strong>{formatDate(`${day}T12:00:00Z`, timeZone, { weekday: "short" })}</strong><small>{formatDate(`${day}T12:00:00Z`, timeZone, { day: "2-digit", month: "2-digit" })}</small></header>{appointments.filter((item) => localDate(new Date(item.startAt), timeZone) === day).map((appointment) => <button key={appointment.id} onClick={() => onSelect(appointment.id)}><time>{formatTime(appointment.startAt, timeZone)}</time><strong>{appointment.customer.displayName}</strong><span>{itemFor(appointment).serviceName}</span><em className={`ns-status ns-status--${statusClass(appointment.status)}`}>{statusLabels[appointment.status] ?? appointment.status}</em></button>)}</section>)}</div>;
}

function AppointmentTable({ appointments, timeZone, page, onSelect }: { appointments: Appointment[]; timeZone: string; page: Overview["pagination"] | undefined; onSelect: (id: string) => void }) {
  return <div className="ns-appointment-table-wrap"><div className="ns-panel-heading"><h2>Danh sách lịch hẹn</h2><small>{page ? `${page.totalItems} lịch hẹn` : ""}</small></div><div className="ns-appointment-table-scroll"><table className="ns-appointment-table"><thead><tr><th>Mã lịch hẹn</th><th>Giờ hẹn</th><th>Khách hàng</th><th>SĐT</th><th>Dịch vụ</th><th>Kỹ thuật viên</th><th>Chi nhánh</th><th>Trạng thái</th><th>Ghi chú</th><th /></tr></thead><tbody>{appointments.map((appointment) => { const item = itemFor(appointment); return <tr key={appointment.id}><td><strong>{appointment.bookingReference}</strong></td><td>{formatTime(appointment.startAt, timeZone)}</td><td><button className="ns-table-person" onClick={() => onSelect(appointment.id)}><span className="ns-avatar ns-avatar--tiny">{initials(appointment.customer.displayName)}</span>{appointment.customer.displayName}</button></td><td>{appointment.customer.phone ?? "—"}</td><td>{item.serviceName}</td><td>{item.staffName ?? "Chưa phân công"}</td><td>{appointment.branch.name}</td><td><span className={`ns-status ns-status--${statusClass(appointment.status)}`}>{statusLabels[appointment.status] ?? appointment.status}</span></td><td>{appointment.customerNote ?? "—"}</td><td><button className="ns-icon-button" aria-label={`Xem ${appointment.bookingReference}`} onClick={() => onSelect(appointment.id)}><Icon name="more" /></button></td></tr>; })}</tbody></table></div>{!appointments.length ? <div className="ns-table-empty">Không tìm thấy lịch hẹn phù hợp.</div> : null}</div>;
}

function AppointmentDetail({ appointment, state, timeZone, canConfirm, canReschedule, saving, onConfirm }: { appointment?: Appointment | any; state: State; timeZone: string; canConfirm: boolean; canReschedule: boolean; saving: boolean; onConfirm: () => void }) {
  if (state === "loading") return <section className="ns-detail-panel ns-detail-loading"><span /><span /><span /></section>;
  if (!appointment) return <section className="ns-detail-panel"><div className="ns-detail-empty"><Icon name="customer" /><strong>Chọn một lịch hẹn</strong><p>Chọn lịch trên scheduler hoặc danh sách để xem chi tiết.</p></div></section>;
  const detail = appointment as any;
  const items = Array.isArray(detail.items) ? detail.items : [itemFor(appointment)];
  const phone = detail.contact?.phone ?? detail.customer?.phone;
  return <section className="ns-detail-panel"><div className="ns-panel-heading"><h2>Chi tiết lịch hẹn</h2><span className={`ns-status ns-status--${statusClass(appointment.status)}`}>{statusLabels[appointment.status] ?? appointment.status}</span></div><div className="ns-customer-hero"><span className="ns-customer-avatar">{initials(appointment.customer?.displayName ?? detail.contact?.displayName ?? "Guest")}</span><div><strong>{appointment.customer?.displayName ?? detail.contact?.displayName}</strong><small>{phone ?? "Không có số điện thoại"}</small></div></div><dl className="ns-detail-list"><div><dt>Dịch vụ</dt><dd>{items.map((item: any) => item.serviceName ?? displayName(item.service?.name, item.service?.code)).join(", ")}</dd></div><div><dt>Thời gian</dt><dd>{formatTime(appointment.startAt, timeZone)} – {formatTime(appointment.endAt, timeZone)} ({Math.max(1, Math.round((new Date(appointment.endAt).getTime() - new Date(appointment.startAt).getTime()) / 60000))} phút)</dd></div><div><dt>Kỹ thuật viên</dt><dd>{items.map((item: any) => item.staffName ?? item.staff?.displayName ?? "Chưa phân công").join(", ")}</dd></div><div><dt>Chi nhánh</dt><dd>{appointment.branch?.name ?? "—"}</dd></div><div><dt>Ghi chú</dt><dd>{detail.customerNote ?? appointment.customerNote ?? "Không có ghi chú"}</dd></div><div><dt>Ngày tạo</dt><dd>{appointment.createdAt ? formatDate(appointment.createdAt, timeZone, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</dd></div></dl><div className="ns-detail-actions">{appointment.status === "PENDING_CONFIRMATION" && canConfirm ? <button className="ns-button ns-button--success" disabled={saving} onClick={onConfirm}><Icon name="check" /> {saving ? "Đang xác nhận" : "Xác nhận"}</button> : null}{canReschedule ? <Link className="ns-button ns-button--outline" href={`/admin/appointments/${appointment.id}/reschedule`}><Icon name="edit" /> Chỉnh sửa</Link> : null}{phone ? <a className="ns-button ns-button--outline" href={`tel:${phone}`}><Icon name="phone" /> Liên hệ</a> : null}</div></section>;
}

function UpcomingCard({ appointments, timeZone, onSelect }: { appointments: Appointment[]; timeZone: string; onSelect: (id: string) => void }) {
  const upcoming = appointments.filter((item) => new Date(item.startAt).getTime() > Date.now() && !["CANCELLED_BY_CUSTOMER", "CANCELLED_BY_SALON", "NO_SHOW", "EXPIRED"].includes(item.status)).sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()).slice(0, 4);
  return <section className="ns-side-card"><div className="ns-panel-heading"><h2>Khách sắp đến</h2><span>{upcoming.length ? "" : ""}</span></div>{upcoming.length ? upcoming.map((appointment) => { const minutes = Math.max(0, Math.round((new Date(appointment.startAt).getTime() - Date.now()) / 60000)); return <button className="ns-side-row" key={appointment.id} onClick={() => onSelect(appointment.id)}><time>{formatTime(appointment.startAt, timeZone)}</time><span className="ns-avatar ns-avatar--tiny">{initials(appointment.customer.displayName)}</span><strong>{appointment.customer.displayName}</strong><small>{itemFor(appointment).serviceName}</small><em>{minutes > 0 ? `Còn ${minutes} phút` : "Đang tới giờ"}</em></button>; }) : <p className="ns-side-empty">Không có khách sắp đến.</p>}</section>;
}

function PendingCard({ appointments, timeZone, overviewPath, onSelect }: { appointments: Appointment[]; timeZone: string; overviewPath: string; onSelect: (id: string) => void }) {
  const pending = appointments.filter((item) => ["PENDING_CONFIRMATION", "PENDING_DEPOSIT"].includes(item.status)).slice(0, 4);
  return <section className="ns-side-card"><div className="ns-panel-heading"><h2>Yêu cầu mới <span>{pending.length ? `(${pending.length})` : ""}</span></h2><Link href={`${overviewPath}?status=PENDING_CONFIRMATION`}>Xem tất cả</Link></div>{pending.length ? pending.map((appointment) => <button className="ns-side-row ns-side-row--pending" key={appointment.id} onClick={() => onSelect(appointment.id)}><time>{formatTime(appointment.startAt, timeZone)}</time><span className="ns-avatar ns-avatar--tiny">{initials(appointment.customer.displayName)}</span><strong>{appointment.customer.displayName}</strong><small>{itemFor(appointment).serviceName}</small></button>) : <p className="ns-side-empty">Không có yêu cầu mới.</p>}</section>;
}

function Pagination({ page, onChange }: { page: Overview["pagination"] | undefined; onChange: (page: number) => void }) {
  if (!page || page.totalPages <= 1) return null;
  return <nav className="ns-appointments-pagination" aria-label="Phân trang"><button disabled={page.page <= 1} onClick={() => onChange(page.page - 1)}><Icon name="chevronLeft" /></button><span>Trang {page.page} / {page.totalPages}</span><button disabled={page.page >= page.totalPages} onClick={() => onChange(page.page + 1)}><Icon name="chevronRight" /></button></nav>;
}

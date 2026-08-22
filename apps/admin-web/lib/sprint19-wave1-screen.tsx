/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useState } from "react";
import { ACTIVE_BRANCH_CHANGED_EVENT, authorizedFetch, getAuthorizedBranchContext, getActiveBranchId } from "./auth";

type LoadState = "loading" | "ready" | "empty" | "error" | "forbidden" | "offline";
const neverEmpty = () => false;
const emptyArray = (value: unknown) => !Array.isArray(value) || value.length === 0;
const emptyEvents = (value: any) => !(value?.events?.length);

function unwrap(body: any) {
  return body?.data ?? body;
}

async function request(path: string, init?: RequestInit) {
  const response = await authorizedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error(body?.error?.message ?? "Permission denied"), { forbidden: true });
  }
  if (!response.ok) {
    throw Object.assign(new Error(body?.error?.message ?? "Request failed"), { code: body?.error?.code, status: response.status });
  }
  return unwrap(body);
}

function useResource<T>(path: string | null, empty: (value: T) => boolean = neverEmpty) {
  const [state, setState] = useState<LoadState>(path ? "loading" : "empty");
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!path) return;
    setState("loading");
    setError("");
    try {
      const value = await request(path);
      setData(value);
      setState(empty(value) ? "empty" : "ready");
    } catch (cause: any) {
      setError(cause?.message ?? "Unable to load data");
      setState(cause?.forbidden ? "forbidden" : typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
    }
  }, [empty, path]);
  useEffect(() => { void load(); }, [load]);
  return { state, data, error, load };
}

function useWorkspace() {
  const [branchId, setBranchId] = useState(() => getActiveBranchId() ?? "");
  const [timezone, setTimezone] = useState("UTC");
  useEffect(() => {
    let cancelled = false;
    const load = () => void getAuthorizedBranchContext().then(({ branches, branchId: selected }) => {
      if (cancelled) return;
      const next = selected ?? "";
      setBranchId(next);
      setTimezone(branches.find((branch) => branch.id === next)?.timezone ?? "UTC");
    }).catch(() => undefined);
    load();
    const handleBranchChange = (event: Event) => {
      const next = (event as CustomEvent<string | undefined>).detail ?? "";
      setBranchId(next);
      void getAuthorizedBranchContext().then(({ branches }) => setTimezone(branches.find((branch) => branch.id === next)?.timezone ?? "UTC")).catch(() => undefined);
    };
    window.addEventListener(ACTIVE_BRANCH_CHANGED_EVENT, handleBranchChange);
    return () => { cancelled = true; window.removeEventListener(ACTIVE_BRANCH_CHANGED_EVENT, handleBranchChange); };
  }, []);
  return { branchId, timezone };
}

function formatDate(value: string | Date, timezone?: string) {
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeZone: timezone }).format(new Date(value));
}

function formatTime(value: string | Date, timezone?: string) {
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(value));
}

function localDateInZone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])) as Record<string, string>;
  return `${values.year}-${values.month}-${values.day}`;
}

function addLocalDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function zonedDateTimeToIso(localDate: string, localTime: string, timeZone: string) {
  const [year, month, day] = localDate.split("-").map(Number);
  const [hour = 0, minute = 0, second = 0] = localTime.split(":").map(Number);
  const desired = Date.UTC(year!, month! - 1, day, hour, minute, second);
  let guess = desired;
  for (let index = 0; index < 3; index += 1) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
    const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)])) as Record<string, number>;
    const localAsUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second));
    guess = desired - (localAsUtc - guess);
  }
  return new Date(guess).toISOString();
}

function StateView({ state, error, retry, label }: { state: LoadState; error?: string; retry: () => void; label: string }) {
  if (state === "loading") return <div className="wave1-state" role="status" aria-live="polite"><span className="wave1-spinner" />Đang tải {label}…</div>;
  if (state === "forbidden") return <div className="wave1-state wave1-state--danger" role="alert"><strong>Không có quyền truy cập</strong><span>Vai trò hoặc phạm vi chi nhánh hiện tại không cho phép xem khu vực này.</span></div>;
  if (state === "offline") return <div className="wave1-state" role="alert"><strong>Mất kết nối</strong><span>Hãy kiểm tra mạng rồi thử lại.</span><button className="ns-button ns-button--secondary" onClick={retry}>Thử lại</button></div>;
  if (state === "error") return <div className="wave1-state wave1-state--danger" role="alert"><strong>Không thể tải dữ liệu</strong><span>{error ?? "Có lỗi xảy ra."}</span><button className="ns-button ns-button--secondary" onClick={retry}>Thử lại</button></div>;
  if (state === "empty") return <div className="wave1-state" role="status"><strong>Chưa có dữ liệu</strong><span>Không có bản ghi phù hợp với bộ lọc hiện tại.</span><button className="ns-button ns-button--secondary" onClick={retry}>Làm mới</button></div>;
  return null;
}

function Page({ eyebrow, title, description, accessibilityTitle, actions, children }: { eyebrow: string; title: string; description: string; accessibilityTitle?: string; actions?: ReactNode; children: ReactNode }) {
  return <main className="wave1-page"><header className="wave1-page-header"><div><p className="ns-eyebrow">{eyebrow}</p><h1 aria-label={accessibilityTitle ? `${title} (${accessibilityTitle})` : undefined}>{title}</h1><p>{description}</p></div>{actions ? <div className="wave1-actions">{actions}</div> : null}</header>{children}</main>;
}

function Kpi({ label, value, tone = "navy", detail }: { label: string; value: string | number; tone?: string; detail?: string }) {
  return <article className={`wave1-kpi wave1-kpi--${tone}`}><span>{label}</span><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</article>;
}

function TodayDashboard() {
  const { branchId, timezone } = useWorkspace();
  const summary = useResource<any>(branchId ? `/v1/operations/summary?branchId=${branchId}` : null, neverEmpty);
  const board = useResource<any>(branchId ? `/v1/operations/board?branchId=${branchId}` : null, neverEmpty);
  const value = summary.data ?? {};
  const columns = value.columns ?? board.data?.columns ?? {};
  const upcoming = [...(columns.UPCOMING ?? []), ...(columns.ARRIVED ?? [])].slice(0, 5);
  return <Page eyebrow="Hôm nay" title="Trung tâm vận hành" description={`Theo dõi salon theo giờ địa phương · ${timezone}`} actions={<button className="ns-button ns-button--secondary" onClick={() => { void summary.load(); void board.load(); }}>Làm mới</button>}>
    <div className="wave1-date-strip"><span className="wave1-date-icon">◎</span><div><strong>{formatDate(new Date(), timezone)}</strong><span>Chi nhánh đang chọn · cập nhật realtime khi có thay đổi</span></div></div>
    <StateView state={summary.state} error={summary.error} retry={summary.load} label="tóm tắt vận hành" />
    {summary.state === "ready" ? <>
      <section className="wave1-kpi-grid" aria-label="Tóm tắt vận hành"><Kpi label="Lịch hôm nay" value={columns.UPCOMING?.length ?? value.todayCount ?? 0} detail="Đã đặt và sắp tới" /><Kpi label="Đang chờ" value={value.waitingCount ?? columns.WAITING?.length ?? 0} tone="teal" detail="Walk-in và khách đã đến" /><Kpi label="Đang thực hiện" value={value.inServiceCount ?? columns.IN_SERVICE?.length ?? 0} tone="amber" detail="Service session đang mở" /><Kpi label="Sẵn sàng thanh toán" value={value.readyCheckoutCount ?? columns.READY_FOR_CHECKOUT?.length ?? 0} tone="green" detail="Đã hoàn tất dịch vụ" /></section>
      <div className="wave1-two-column"><section className="wave1-panel"><div className="wave1-panel-heading"><div><p className="ns-eyebrow">Ưu tiên tiếp theo</p><h2>Khách sắp tới</h2></div><a className="ns-button ns-button--quiet" href="/admin/appointments">Xem lịch hẹn</a></div>{upcoming.length ? <div className="wave1-list">{upcoming.map((row: any, index: number) => <a className="wave1-list-item" key={row.id ?? `${row.bookingReference}-${index}`} href={row.id ? `/admin/appointments/${row.id}/overview` : "/admin/appointments"}><span className="wave1-list-time">{row.startAt ? formatTime(row.startAt, timezone) : "--:--"}</span><span><strong>{row.customer?.displayName ?? row.displayName ?? row.bookingReference ?? "Khách đặt lịch"}</strong><small>{row.services?.map((service: any) => service.name ?? service.serviceName).join(" · ") ?? row.status ?? "Đang chờ xác nhận"}</small></span><span className="ns-status ns-status--info">{row.status ?? "UPCOMING"}</span></a>)}</div> : <div className="wave1-empty-inline">Không có khách sắp tới trong khung giờ hiện tại.</div>}</section><section className="wave1-panel"><div className="wave1-panel-heading"><div><p className="ns-eyebrow">Cần xử lý</p><h2>Điểm cần chú ý</h2></div></div><div className="wave1-alert-list"><div><span className="wave1-alert-dot wave1-alert-dot--amber" /><span><strong>{value.currentDelayCount ?? 0} lịch bị trễ</strong><small>Kiểm tra và chủ động liên hệ khách.</small></span></div><div><span className="wave1-alert-dot wave1-alert-dot--teal" /><span><strong>{value.staffUtilization?.activeStaffIds?.length ?? 0} nhân sự đang làm việc</strong><small>Phân bổ theo chi nhánh hiện tại.</small></span></div><div><span className="wave1-alert-dot wave1-alert-dot--navy" /><span><strong>Realtime đang bật</strong><small>Dữ liệu được tải lại khi có sự kiện vận hành.</small></span></div></div></section></div>
    </> : null}
  </Page>;
}

function CalendarView({ pathname }: { pathname: string }) {
  const { branchId, timezone } = useWorkspace();
  const week = pathname.includes("week");
  const [date, setDate] = useState("");
  const [eventType, setEventType] = useState("ALL");
  const localDate = date || localDateInZone(new Date(), timezone);
  const endDate = addLocalDays(localDate, week ? 6 : 0);
  const from = zonedDateTimeToIso(localDate, "00:00:00", timezone);
  const to = zonedDateTimeToIso(endDate, "23:59:59", timezone);
  const eventTypes = eventType === "ALL" ? "APPOINTMENT,SHIFT,BUSY_BLOCK,LEAVE" : eventType;
  const events = useResource<any>(branchId ? `/v1/calendar/events?branchId=${encodeURIComponent(branchId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&eventTypes=${encodeURIComponent(eventTypes)}` : null, emptyEvents);
  const rows = events.data?.events ?? [];
  return <Page eyebrow="Lịch hẹn" title={week ? "Lịch tuần" : "Lịch hôm nay"} accessibilityTitle={week ? "Calendar week" : "Calendar day"} description={`Múi giờ chi nhánh · ${timezone}`} actions={<><a className="ns-button ns-button--primary" aria-label="Create appointment" href="/admin/appointments/new">+ Tạo lịch hẹn</a><a className="ns-button ns-button--secondary" href={week ? "/admin/calendar/day" : "/admin/calendar/week"}>{week ? "Xem ngày" : "Xem tuần"}</a></>}> 
    <section className="wave1-filter-bar"><label><span>Ngày xem · {timezone}</span><input type="date" value={localDate} onChange={(event) => setDate(event.target.value)} /></label><label><span>Hiển thị</span><select value={eventType} onChange={(event) => setEventType(event.target.value)}><option value="ALL">Tất cả lịch</option><option value="APPOINTMENT">Lịch hẹn</option><option value="SHIFT">Ca làm</option><option value="BUSY_BLOCK">Busy block</option><option value="LEAVE">Nghỉ phép</option></select></label><button className="ns-button ns-button--secondary" onClick={events.load}>Làm mới</button></section>
    <StateView state={events.state} error={events.error} retry={events.load} label="lịch hẹn" />
    {events.state === "ready" ? <section className="wave1-calendar" aria-label="Lịch hẹn"><div className="wave1-calendar-head"><span>Thời gian</span><span>Nội dung vận hành</span></div>{rows.map((event: any) => <article className={`wave1-calendar-event wave1-calendar-event--${String(event.eventType ?? "appointment").toLowerCase()}`} key={event.id}><time>{formatTime(event.startAt, timezone)}<small>{formatTime(event.endAt, timezone)}</small></time><div><strong>{event.title ?? "Lịch hẹn"}</strong><span>{event.eventType} · {event.status ?? "ACTIVE"}</span>{event.sourceEntityId && event.eventType === "APPOINTMENT" ? <a href={`/admin/appointments/${event.sourceEntityId}/overview`}>Mở chi tiết →</a> : null}</div><span className="wave1-calendar-meta">{event.localStart ? formatDate(event.startAt, timezone) : ""}</span></article>)}</section> : null}
  </Page>;
}

function BookingList() {
  const { branchId, timezone } = useWorkspace();
  const [filters, setFilters] = useState({ search: "", status: "", from: "", to: "" });
  const query = new URLSearchParams({ limit: "50" });
  if (branchId) query.set("branchId", branchId);
  Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
  const list = useResource<any[]>(`/v1/appointments?${query.toString()}`, emptyArray);
  const rows = Array.isArray(list.data) ? list.data : [];
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); setFilters({ search: String(form.get("search") ?? ""), status: String(form.get("status") ?? ""), from: String(form.get("from") ?? ""), to: String(form.get("to") ?? "") }); }
  return <Page eyebrow="Booking" title="Lịch hẹn" accessibilityTitle="Appointments" description="Tìm kiếm và theo dõi lịch hẹn theo chi nhánh, nhân sự và trạng thái." actions={<a className="ns-button ns-button--primary" aria-label="Create appointment" href="/admin/appointments/new">+ Tạo lịch hẹn</a>}> 
    <form className="wave1-filter-bar wave1-filter-bar--wide" onSubmit={submit}><label className="wave1-filter-search"><span>Tìm khách hoặc mã booking</span><input name="search" placeholder="VD: NS-2026 hoặc Nguyễn An" defaultValue={filters.search} /></label><label><span>Từ ngày</span><input type="date" name="from" defaultValue={filters.from} /></label><label><span>Đến ngày</span><input type="date" name="to" defaultValue={filters.to} /></label><label><span>Trạng thái</span><select name="status" defaultValue={filters.status}><option value="">Tất cả</option><option value="CONFIRMED">Đã xác nhận</option><option value="CHECKED_IN">Đã check-in</option><option value="IN_SERVICE">Đang làm</option><option value="COMPLETED">Hoàn tất</option><option value="CANCELLED_BY_CUSTOMER">Khách hủy</option></select></label><button className="ns-button ns-button--primary">Lọc</button></form>
    <StateView state={list.state} error={list.error} retry={list.load} label="lịch hẹn" />
    {list.state === "ready" ? <section className="wave1-table-panel"><div className="wave1-table-summary"><strong>{rows.length} lịch hẹn</strong><button className="ns-button ns-button--quiet" onClick={list.load}>↻ Làm mới</button></div><div className="wave1-table-scroll"><table className="wave1-table"><thead><tr><th>Thời gian</th><th>Khách hàng</th><th>Dịch vụ</th><th>Nhân sự</th><th>Trạng thái</th><th /></tr></thead><tbody>{rows.map((row: any) => <tr key={row.id}><td><strong>{row.startAt ? formatTime(row.startAt, timezone) : "--:--"}</strong><small>{row.startAt ? formatDate(row.startAt, timezone) : ""}</small></td><td><strong>{row.customer?.displayName ?? row.contactSnapshot?.displayName ?? row.bookingReference ?? "Khách"}</strong><small>{row.bookingReference}</small></td><td>{row.items?.map((item: any) => item.service?.name ?? item.serviceSnapshot?.name ?? item.serviceName).filter(Boolean).join(" · ") || "Dịch vụ đã chọn"}</td><td>{row.items?.map((item: any) => item.staff?.displayName ?? item.staffName).filter(Boolean).join(" · ") || "Any staff"}</td><td><span className={`ns-status ns-status--${String(row.status ?? "").includes("CANCEL") ? "danger" : row.status === "COMPLETED" ? "success" : "info"}`}><span className="ns-status__dot" />{row.status}</span></td><td><a className="wave1-inline-link" href={`/admin/appointments/${row.id}/overview`}>Mở →</a></td></tr>)}</tbody></table></div></section> : null}
  </Page>;
}

function AvailabilityView() {
  const { branchId, timezone } = useWorkspace();
  const [form, setForm] = useState({ serviceId: "", date: "", staffId: "" });
  const date = form.date || localDateInZone(new Date(), timezone);
  const services = useResource<any[]>(branchId ? "/v1/services?status=ACTIVE&pageSize=100" : null, emptyArray);
  const staff = useResource<any[]>(branchId ? `/v1/staff?status=ACTIVE&branchId=${encodeURIComponent(branchId)}` : null, emptyArray);
  const [search, setSearch] = useState<{ state: LoadState; data?: any; error?: string }>({ state: "empty" });
  useEffect(() => { if (!form.serviceId && services.data?.[0]?.id) setForm((current) => ({ ...current, serviceId: services.data?.[0]?.id ?? "" })); }, [form.serviceId, services.data]);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSearch({ state: "loading" }); const params = new URLSearchParams({ branchId, serviceId: form.serviceId, dateFrom: date, dateTo: date, slotIntervalMin: "15" }); if (form.staffId) params.set("staffId", form.staffId); try { const data = await request(`/v1/availability?${params.toString()}`); setSearch({ state: data?.days?.some((day: any) => day.slots?.length) ? "ready" : "empty", data }); } catch (cause: any) { setSearch({ state: cause?.forbidden ? "forbidden" : "error", error: cause?.message }); } }
  const slots = search.data?.days?.flatMap((day: any) => day.slots ?? []) ?? [];
  return <Page eyebrow="Availability" title="Tìm khung giờ trống" accessibilityTitle="Availability search" description={`Slot hợp lệ theo availability engine · ${timezone}`}><form className="wave1-availability-form" onSubmit={submit}><label><span>Ngày · {timezone}</span><input type="date" value={date} onChange={(event) => setForm({ ...form, date: event.target.value })} required /></label><label><span>Dịch vụ</span><select value={form.serviceId} onChange={(event) => setForm({ ...form, serviceId: event.target.value })} required><option value="">Chọn dịch vụ</option>{(services.data ?? []).map((item: any) => <option key={item.id} value={item.id}>{item.name?.["vi-VN"] ?? item.name?.["en-US"] ?? item.name ?? item.code}</option>)}</select></label><label><span>Nhân sự ưu tiên</span><select value={form.staffId} onChange={(event) => setForm({ ...form, staffId: event.target.value })}><option value="">Không chọn · Any staff</option>{(staff.data ?? []).map((item: any) => <option key={item.id} value={item.id}>{item.displayName ?? item.name ?? item.id}</option>)}</select></label><button className="ns-button ns-button--primary" aria-label="Calculate" disabled={search.state === "loading" || services.state === "loading"}>{search.state === "loading" ? "Đang tính…" : "Tìm slot"}</button></form><StateView state={search.state} error={search.error ?? ""} retry={() => undefined} label="availability" />{search.state === "ready" ? <section className="wave1-slot-grid"><div className="wave1-panel-heading"><div><p className="ns-eyebrow">Kết quả</p><h2>{slots.length} slot khả dụng</h2></div><span className="ns-status ns-status--success">Đã kiểm tra realtime</span></div>{slots.map((slot: any) => <article className="wave1-slot-card" key={slot.fingerprint}><strong>{formatTime(slot.startAt, timezone)} – {formatTime(slot.endAt, timezone)}</strong><span>{slot.staffCandidates?.map((staff: any) => staff.displayName).join(", ") || "Nhân sự phù hợp"}</span><small>{slot.priceReference?.amount ?? "—"} {slot.priceReference?.currency ?? "VND"} · duration {slot.durationMin ?? "—"} phút</small><button className="ns-button ns-button--secondary" type="button">Chọn slot</button></article>)}</section> : null}<p className="wave1-disclaimer">Slot chỉ là kết quả tính toán hiện tại, không giữ chỗ cho đến khi Booking Engine tạo hold thành công.</p></Page>;
}

export default function Sprint19Wave1Screen({ pathname }: { pathname: string }) {
  if (pathname === "/admin/dashboard") return <TodayDashboard />;
  if (pathname.startsWith("/admin/calendar")) return <CalendarView pathname={pathname} />;
  if (pathname === "/admin/appointments" || pathname === "/admin/appointments/") return <BookingList />;
  if (pathname.startsWith("/admin/availability")) return <AvailabilityView />;
  return null;
}

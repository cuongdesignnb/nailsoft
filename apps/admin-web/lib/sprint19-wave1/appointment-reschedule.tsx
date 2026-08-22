/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { authorizedFetch } from "../auth";
import styles from "./appointment-reschedule.module.css";

type ViewState = "loading" | "ready" | "error" | "forbidden" | "offline";
type AvailabilityState = "idle" | "loading" | "ready" | "empty" | "error" | "forbidden" | "offline";
type StaffMode = "CURRENT" | "ANY" | string;

const STATUS_LABELS: Record<string, string> = {
  PENDING_CONFIRMATION: "Chờ xác nhận",
  CONFIRMED: "Đã xác nhận",
  ARRIVED: "Khách đã đến",
  CHECKED_IN: "Đã check-in",
  IN_SERVICE: "Đang phục vụ",
  COMPLETED: "Hoàn thành",
  PAID: "Đã thanh toán",
  CANCELLED_BY_CUSTOMER: "Khách đã hủy",
  CANCELLED_BY_SALON: "Salon đã hủy",
  NO_SHOW: "Không đến",
};

const REASON_OPTIONS = [
  { value: "CUSTOMER_REQUEST", label: "Khách hàng yêu cầu" },
  { value: "SALON_UNAVAILABLE", label: "Salon không thể phục vụ" },
  { value: "STAFF_UNAVAILABLE", label: "Kỹ thuật viên không khả dụng" },
  { value: "OTHER", label: "Lý do khác" },
];

function list(value: any): any[] {
  const data = value?.data ?? value;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return data ? [data] : [];
}

async function read(path: string) {
  const response = await authorizedFetch(path);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error("Bạn không có quyền xem dữ liệu này."), { forbidden: true });
  }
  if (!response.ok) {
    throw Object.assign(new Error(body?.error?.message ?? "Không thể tải dữ liệu."), {
      code: body?.error?.code,
      status: response.status,
    });
  }
  return body?.data ?? body;
}

async function command(path: string, payload?: unknown, idempotencyKey = crypto.randomUUID()) {
  const headers: HeadersInit = {
    "idempotency-key": idempotencyKey,
  };
  if (payload !== undefined) headers["content-type"] = "application/json";
  const init: RequestInit = { method: "POST", headers };
  if (payload !== undefined) init.body = JSON.stringify(payload);
  const response = await authorizedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error("Bạn không có quyền thực hiện thao tác này."), { forbidden: true });
  }
  if (!response.ok) {
    throw Object.assign(new Error(body?.error?.message ?? "Không thể hoàn tất thao tác."), {
      code: body?.error?.code,
      status: response.status,
    });
  }
  return body?.data ?? body;
}

function text(value: unknown, fallback = "—") {
  return value == null || value === "" ? fallback : String(value);
}

function serviceName(service: any) {
  return service?.name?.["vi-VN"] ?? service?.name?.["en-US"] ?? service?.name ?? service?.code ?? "Dịch vụ";
}

function parts(value: string | Date, timezone: string) {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  return Object.fromEntries(formatted.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function dateInput(value: string | undefined, timezone: string) {
  if (!value) return "";
  const date = parts(value, timezone);
  return `${date.year}-${date.month}-${date.day}`;
}

function timeLabel(value: string | Date, timezone: string) {
  const date = parts(value, timezone);
  return `${date.hour}:${date.minute}`;
}

function dateLabel(value: string | Date, timezone: string, withTime = true) {
  const date = parts(value, timezone);
  const result = `${date.day}/${date.month}/${date.year}`;
  return withTime ? `${result} · ${date.hour}:${date.minute}` : result;
}

function dateOnly(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function monthBounds(month: string) {
  const [yearText = "1970", monthText = "1"] = month.split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  const first = new Date(year, monthNumber - 1, 1);
  const last = new Date(year, monthNumber, 0);
  return { from: dateOnly(first), to: dateOnly(last) };
}

function monthTitle(month: string) {
  const [yearText = "1970", monthText = "1"] = month.split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  return new Intl.DateTimeFormat("vi-VN", { month: "long", year: "numeric" }).format(new Date(year, monthNumber - 1, 1));
}

function calendarDays(month: string) {
  const [yearText = "1970", monthText = "1"] = month.split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  const first = new Date(year, monthNumber - 1, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, monthNumber - 1, 1 - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { value: dateOnly(date), day: date.getDate(), inMonth: date.getMonth() === monthNumber - 1 };
  });
}

function appointmentDuration(row: any) {
  const itemDuration = (row?.items ?? []).reduce((total: number, item: any) => total + Number(item?.service?.defaultDurationMin ?? item?.durationMin ?? 0), 0);
  if (itemDuration > 0) return itemDuration;
  if (row?.startAt && row?.endAt) return Math.max(0, Math.round((new Date(row.endAt).getTime() - new Date(row.startAt).getTime()) / 60000));
  return 0;
}

function errorMessage(cause: any, fallback: string) {
  switch (cause?.code) {
    case "VERSION_CONFLICT":
    case "BOOKING_VERSION_CONFLICT":
      return "Lịch hẹn vừa thay đổi. Đã tải lại dữ liệu, bạn hãy kiểm tra và chọn lại khung giờ.";
    case "AVAILABILITY_CHANGED":
      return "Khả dụng đã thay đổi. Hãy làm mới khung giờ trước khi thử lại.";
    case "SLOT_HOLD_EXPIRED":
    case "HOLD_EXPIRED":
      return "Khung giờ đã hết thời gian giữ. Hãy chọn lại khung giờ mới.";
    case "BOOKING_SERVICE_MISMATCH":
      return "Khung giờ mới không đáp ứng đủ toàn bộ dịch vụ trong lịch hẹn.";
    default:
      return cause?.message ?? fallback;
  }
}

function StateBox({ state, error, onRetry, label }: { state: string; error?: string; onRetry: () => void; label: string }) {
  if (state === "loading") return <div className={`${styles.stateBox} ${styles.loading}`} role="status"><span className={styles.spinner} />Đang tải {label}…</div>;
  if (state === "forbidden") return <div className={`${styles.stateBox} ${styles.danger}`} role="alert"><strong>Không có quyền truy cập</strong><span>{error ?? "Vai trò hoặc phạm vi chi nhánh hiện tại không cho phép xem dữ liệu này."}</span><button type="button" onClick={onRetry}>Thử lại</button></div>;
  if (state === "offline") return <div className={styles.stateBox} role="alert"><strong>Mất kết nối</strong><span>Không thể xác nhận thay đổi khi đang offline.</span><button type="button" onClick={onRetry}>Thử lại</button></div>;
  if (state === "error") return <div className={`${styles.stateBox} ${styles.danger}`} role="alert"><strong>Không thể tải {label}</strong><span>{error ?? "Có lỗi xảy ra."}</span><button type="button" onClick={onRetry}>Thử lại</button></div>;
  if (state === "empty") return <div className={styles.emptyBox} role="status"><strong>Chưa có khung giờ phù hợp</strong><span>Availability Engine không tìm thấy khung giờ đáp ứng bộ lọc hiện tại.</span><button type="button" onClick={onRetry}>Làm mới</button></div>;
  return null;
}

function IconBadge({ children, tone = "rose" }: { children: ReactNode; tone?: "rose" | "green" | "blue" | "purple" }) {
  return <span className={`${styles.iconBadge} ${styles[tone]}`}>{children}</span>;
}

export default function AppointmentReschedulePage({ appointmentId }: { appointmentId: string }) {
  const [appointment, setAppointment] = useState<any>();
  const [pageState, setPageState] = useState<ViewState>("loading");
  const [pageError, setPageError] = useState("");
  const [branches, setBranches] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [calendarMonth, setCalendarMonth] = useState("");
  const [staffMode, setStaffMode] = useState<StaffMode>("CURRENT");
  const [fullDuration, setFullDuration] = useState(true);
  const [availability, setAvailability] = useState<any[]>([]);
  const [availabilityVersion, setAvailabilityVersion] = useState<number>();
  const [availabilityState, setAvailabilityState] = useState<AvailabilityState>("idle");
  const [availabilityError, setAvailabilityError] = useState("");
  const [selectedSlot, setSelectedSlot] = useState<any>();
  const [hold, setHold] = useState<any>();
  const holdRef = useRef<any>(undefined);
  const requestRef = useRef(0);
  const [saving, setSaving] = useState(false);
  const [reasonCode, setReasonCode] = useState("CUSTOMER_REQUEST");
  const [note, setNote] = useState("");
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [emailReminder, setEmailReminder] = useState(false);
  const [actionError, setActionError] = useState("");
  const intentKeys = useRef<Record<string, string>>({});
  const intentKeyFor = (name: string) => intentKeys.current[name] ?? (intentKeys.current[name] = crypto.randomUUID());

  const loadAppointment = useCallback(async () => {
    setPageState("loading");
    setPageError("");
    try {
      const data = await read(`/v1/appointments/${appointmentId}`);
      setAppointment(data);
      setPageState("ready");
    } catch (cause: any) {
      setPageError(cause?.message ?? "Không thể tải lịch hẹn.");
      setPageState(cause?.forbidden ? "forbidden" : typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
    }
  }, [appointmentId]);

  useEffect(() => { void loadAppointment(); }, [loadAppointment]);

  useEffect(() => {
    let active = true;
    Promise.allSettled([read("/v1/branches"), read("/v1/staff?status=ACTIVE")]).then(([branchResult, staffResult]) => {
      if (!active) return;
      if (branchResult.status === "fulfilled") setBranches(list(branchResult.value));
      if (staffResult.status === "fulfilled") setStaff(list(staffResult.value));
    });
    return () => { active = false; };
  }, []);

  const row = appointment;
  const branch = useMemo(() => branches.find((item) => item.id === row?.branchId) ?? row?.branch ?? {}, [branches, row]);
  const timezone = branch?.timezone ?? "Asia/Ho_Chi_Minh";
  const currentStaffId = row?.items?.[0]?.staff?.id ?? row?.items?.[0]?.staffId ?? row?.staff?.id;
  const currentStaffName = row?.items?.[0]?.staff?.displayName ?? row?.staff?.displayName ?? "Chưa phân công";
  const currentServices = row?.items ?? [];
  const duration = appointmentDuration(row);
  const availabilityDay = availability.find((day) => day.localDate === selectedDate);
  const slots = availabilityDay?.slots ?? [];
  const monthDays = useMemo(() => calendarDays(calendarMonth || selectedDate.slice(0, 7) + "-01"), [calendarMonth, selectedDate]);
  const availabilityByDate = useMemo(() => new Map(availability.map((day) => [day.localDate, day])), [availability]);
  const selectedStaffId = staffMode === "CURRENT" ? currentStaffId : staffMode === "ANY" ? undefined : staffMode;
  const selectedStaffName = selectedSlot?.staffCandidates?.[0]?.displayName ?? (staffMode === "ANY" ? "Nhân sự phù hợp" : staff.find((item) => item.id === selectedStaffId)?.displayName ?? currentStaffName);

  useEffect(() => {
    if (!row) return;
    const nextDate = dateInput(row.startAt, timezone);
    setSelectedDate((value) => value || nextDate);
    setCalendarMonth((value) => value || `${nextDate.slice(0, 7)}-01`);
    setStaffMode((value) => value === "CURRENT" && !currentStaffId ? "ANY" : value);
  }, [currentStaffId, row, timezone]);

  const releaseHold = useCallback(async (holdId: string | undefined) => {
    if (!holdId) return;
    try {
      await command(`/v1/slot-holds/${holdId}/release`, undefined, intentKeyFor(`release:${holdId}`));
      delete intentKeys.current[`release:${holdId}`];
    } catch { /* The API will expire an abandoned hold if it is already gone. */ }
  }, []);

  const resetSelection = useCallback(async () => {
    const existing = holdRef.current;
    holdRef.current = undefined;
    setHold(undefined);
    setSelectedSlot(undefined);
    if (existing?.holdId) await releaseHold(existing.holdId);
  }, [releaseHold]);

  const loadAvailability = useCallback(async () => {
    if (!row || !selectedDate || !calendarMonth) return;
    const requestId = ++requestRef.current;
    await resetSelection();
    setAvailabilityState("loading");
    setAvailabilityError("");
    try {
      const range = monthBounds(calendarMonth);
      const firstItem = currentServices[0];
      const serviceId = firstItem?.service?.serviceId ?? firstItem?.serviceId;
      if (!row.branchId || !serviceId) throw new Error("Lịch hẹn chưa có đủ thông tin chi nhánh hoặc dịch vụ.");
      const params = new URLSearchParams({ branchId: row.branchId, serviceId, dateFrom: range.from, dateTo: range.to, slotIntervalMin: "15", excludeAppointmentId: appointmentId });
      if (selectedStaffId) params.set("staffId", selectedStaffId);
      const data = await read(`/v1/availability?${params.toString()}`);
      if (requestId !== requestRef.current) return;
      const days = data?.days ?? [];
      setAvailability(days);
      setAvailabilityVersion(data?.dataVersion);
      const target = days.find((day: any) => day.localDate === selectedDate);
      setAvailabilityState(target?.slots?.length ? "ready" : "empty");
    } catch (cause: any) {
      if (requestId !== requestRef.current) return;
      setAvailabilityError(cause?.message ?? "Không thể tải khung giờ.");
      setAvailabilityState(cause?.forbidden ? "forbidden" : typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
    }
  }, [appointmentId, calendarMonth, currentServices, resetSelection, row, selectedDate, selectedStaffId]);

  useEffect(() => {
    if (pageState === "ready" && selectedDate && calendarMonth) void loadAvailability();
  }, [calendarMonth, loadAvailability, pageState, selectedDate]);

  const chooseDate = (value: string) => {
    setSelectedDate(value);
    setCalendarMonth(`${value.slice(0, 7)}-01`);
    setActionError("");
  };

  const moveMonth = (delta: number) => {
    const [yearText = "1970", monthText = "1"] = (calendarMonth || selectedDate.slice(0, 7) + "-01").split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const next = new Date(year, month - 1 + delta, 1);
    const value = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;
    setCalendarMonth(value);
    if (!selectedDate.startsWith(value.slice(0, 7))) setSelectedDate(value);
  };

  const chooseSlot = async (slot: any) => {
    if (saving || !row || !fullDuration) return;
    setSaving(true);
    setActionError("");
    await resetSelection();
    delete intentKeys.current["reschedule-hold"];
    setSelectedSlot(slot);
    try {
      const data = await command(`/v1/appointments/${appointmentId}/reschedule-hold`, {
        branchId: row.branchId,
        desiredStartAt: slot.startAt,
        availabilityDataVersion: availabilityVersion,
        source: "RECEPTION",
        clientKey: intentKeyFor("reschedule-hold"),
        items: currentServices.map((item: any) => ({
          serviceId: item?.service?.serviceId ?? item?.serviceId,
          staffPreference: staffMode === "ANY" ? { type: "ANY" } : staffMode !== "CURRENT" ? { type: "SPECIFIC", staffId: staffMode } : item?.staff?.id ? { type: "SPECIFIC", staffId: item.staff.id } : { type: "ANY" },
          // The calendar query spans a full month while the server planner
          // validates the selected day. Its range-scoped fingerprint would
          // therefore be incomparable; the server still re-plans the slot
          // and enforces the current availability data version.
        })),
      });
      holdRef.current = data;
      setHold(data);
    } catch (cause: any) {
      setSelectedSlot(undefined);
      setActionError(errorMessage(cause, "Không thể giữ khung giờ này."));
    } finally {
      setSaving(false);
    }
  };

  const confirm = async () => {
    if (!row || !hold || !selectedSlot || saving || !confirmChecked || !reasonCode) return;
    setSaving(true);
    setActionError("");
    try {
      await command(`/v1/appointments/${appointmentId}/reschedule`, {
        version: row.version,
        replacementHoldId: hold.holdId,
        replacementHoldToken: hold.holdToken,
        reasonCode,
        note: note.trim() || undefined,
        actorType: "USER",
      }, intentKeyFor("reschedule"));
      holdRef.current = undefined;
      delete intentKeys.current.reschedule;
      window.location.assign(`/admin/appointments/${appointmentId}/overview?rescheduled=1`);
    } catch (cause: any) {
      setActionError(errorMessage(cause, "Không thể xác nhận đổi lịch."));
      if (["VERSION_CONFLICT", "BOOKING_VERSION_CONFLICT"].includes(cause?.code)) await loadAppointment();
    } finally {
      setSaving(false);
    }
  };

  const holdExpiresAt = hold?.expiresAt ? dateLabel(hold.expiresAt, timezone) : "";
  const staffRows = staff.length ? staff : currentStaffId ? [{ id: currentStaffId, displayName: currentStaffName }] : [];
  const canConfirm = Boolean(hold && selectedSlot && confirmChecked && fullDuration && !saving);

  if (pageState !== "ready") {
    return <div className={styles.page}><StateBox state={pageState} error={pageError} onRetry={() => void loadAppointment()} label="lịch hẹn" /></div>;
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <div className={styles.breadcrumb}><a href="/admin/appointments">Lịch hẹn</a><span>/</span><a href={`/admin/appointments/${appointmentId}/overview`}>#{text(row.bookingReference, appointmentId.slice(0, 8))}</a><span>/</span><strong>Đổi lịch</strong></div>
          <p className={styles.kicker}>LỊCH HẸN</p>
          <h1>Đổi lịch hẹn</h1>
          <p className={styles.pageDescription}>Chọn ngày và khung giờ mới phù hợp mà không làm mất thông tin lịch hẹn hiện tại.</p>
        </div>
        <div className={styles.headerActions}>
          <a className={styles.buttonSecondary} href={`/admin/appointments/${appointmentId}/overview`}>Hủy thay đổi</a>
          <button type="button" className={styles.buttonPrimary} onClick={() => void confirm()} disabled={!canConfirm}>{saving ? "Đang xử lý…" : "✓  Xác nhận đổi lịch"}</button>
        </div>
      </div>

      <div className={styles.safetyBanner}><span>♢</span><p><strong>Lịch hẹn hiện tại vẫn được giữ nguyên</strong> cho đến khi bạn xác nhận khung giờ mới. Slot mới chỉ được giữ tạm thời sau khi bạn bấm chọn.</p></div>

      {actionError ? <div className={styles.alert} role="alert"><strong>Chưa thể hoàn tất</strong><span>{actionError}</span><button type="button" onClick={() => setActionError("")}>Đóng</button></div> : null}

      <div className={styles.layout}>
        <main className={styles.mainColumn}>
          <section className={`${styles.card} ${styles.currentCard}`}>
            <div className={styles.cardTitle}><div><p className={styles.kicker}>LỊCH HẸN HIỆN TẠI</p><h2>#{text(row.bookingReference, appointmentId.slice(0, 8))}</h2></div><span className={styles.status}>{STATUS_LABELS[row.status] ?? text(row.status)}</span></div>
            <div className={styles.currentGrid}>
              <div className={styles.customerBlock}><IconBadge>♙</IconBadge><div><strong>{text(row.contact?.displayName, "Khách hàng")}</strong><span>{text(row.contact?.phone ?? row.contact?.phoneNumber)}</span><small>{text(row.contact?.email)}</small></div></div>
              <div><span className={styles.label}>Thời gian</span><strong>{row.startAt ? dateLabel(row.startAt, timezone) : "—"}</strong><small>{duration} phút</small></div>
              <div><span className={styles.label}>Dịch vụ</span><strong>{currentServices.map((item: any) => serviceName(item.service)).join(" · ") || "—"}</strong><small>{currentServices.length} dịch vụ</small></div>
              <div><span className={styles.label}>Kỹ thuật viên</span><strong>{currentStaffName}</strong><small>{text(branch?.name, "Chi nhánh hiện tại")}</small></div>
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.sectionHeading}><div><h2>Chọn ngày mới</h2><p>Availability Engine kiểm tra theo múi giờ {timezone}.</p></div><label className={styles.durationCheck}><input type="checkbox" checked={fullDuration} onChange={(event) => setFullDuration(event.target.checked)} /><span>Đủ thời gian cho toàn bộ dịch vụ</span></label></div>
            <div className={styles.dateWorkspace}>
              <div className={styles.calendarPanel}>
                <div className={styles.calendarHeader}><button type="button" aria-label="Tháng trước" onClick={() => moveMonth(-1)}>‹</button><strong>{monthTitle(calendarMonth || selectedDate.slice(0, 7) + "-01")}</strong><button type="button" aria-label="Tháng sau" onClick={() => moveMonth(1)}>›</button></div>
                <div className={styles.weekLabels}>{["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((day) => <span key={day}>{day}</span>)}</div>
                <div className={styles.calendarGrid}>{monthDays.map((day) => { const summary = availabilityByDate.get(day.value); const count = summary?.slots?.length ?? 0; return <button type="button" key={day.value} className={`${styles.calendarDay} ${day.inMonth ? "" : styles.mutedDay} ${selectedDate === day.value ? styles.selectedDay : ""}`} onClick={() => chooseDate(day.value)} aria-pressed={selectedDate === day.value}><span>{day.day}</span>{count > 0 ? <i className={styles.availableDot} title={`${count} khung giờ`} /> : summary?.unavailableReasons?.length ? <i className={styles.unavailableDot} /> : null}</button>; })}</div>
                <div className={styles.calendarLegend}><span><i className={styles.availableDot} /> Có khung giờ</span><span><i className={styles.unavailableDot} /> Không khả dụng</span><span><i className={styles.selectedLegend} /> Đang chọn</span></div>
              </div>
              <div className={styles.availabilityPanel}>
                <div className={styles.availabilityTop}><div><h3>Khả dụng ngày {selectedDate ? dateLabel(`${selectedDate}T12:00:00`, timezone, false) : "—"}</h3><p>{slots.length} khung giờ · {staffMode === "ANY" ? "nhân sự phù hợp" : selectedStaffName}</p></div><button type="button" className={styles.iconButton} aria-label="Làm mới khung giờ" onClick={() => void loadAvailability()} disabled={availabilityState === "loading"}>↻</button></div>
                <div className={styles.staffChoices}><span className={styles.label}>Kỹ thuật viên</span><div className={styles.choiceRow}><button type="button" className={`${styles.choiceChip} ${staffMode === "CURRENT" ? styles.choiceActive : ""}`} onClick={() => setStaffMode("CURRENT")} disabled={!currentStaffId}>Giữ {currentStaffName}</button><button type="button" className={`${styles.choiceChip} ${staffMode === "ANY" ? styles.choiceActive : ""}`} onClick={() => setStaffMode("ANY")}>Bất kỳ</button>{staffRows.filter((item) => item.id !== currentStaffId).slice(0, 3).map((item) => <button type="button" key={item.id} className={`${styles.choiceChip} ${staffMode === item.id ? styles.choiceActive : ""}`} onClick={() => setStaffMode(item.id)}>{item.displayName}</button>)}</div></div>
                <div className={styles.availabilityLive} aria-live="polite"><span className={availabilityState === "loading" ? styles.pulse : styles.liveDot} />{availabilityState === "loading" ? "Đang kiểm tra thời gian thực…" : availabilityState === "ready" ? `Đã kiểm tra lúc ${new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(new Date())}` : "Chọn ngày để kiểm tra khung giờ"}</div>
                <StateBox state={availabilityState} error={availabilityError} onRetry={() => void loadAvailability()} label="khung giờ" />
                {availabilityState === "ready" ? <div className={styles.slotGroups}>{(["Buổi sáng", "Buổi chiều", "Buổi tối"] as const).map((group) => { const groupSlots = slots.filter((slot: any) => { const hour = Number(timeLabel(slot.localStart ?? slot.startAt, timezone).slice(0, 2)); return group === "Buổi sáng" ? hour < 12 : group === "Buổi chiều" ? hour < 17 : hour >= 17; }); return <div className={styles.slotGroup} key={group}><h4>{group}</h4><div className={styles.slotGrid}>{groupSlots.map((slot: any) => { const selected = selectedSlot?.fingerprint === slot.fingerprint; return <button type="button" key={slot.fingerprint} className={`${styles.slot} ${selected ? styles.slotSelected : ""}`} onClick={() => void chooseSlot(slot)} disabled={saving || !fullDuration} aria-pressed={selected}><strong>{timeLabel(slot.localStart ?? slot.startAt, timezone)}</strong><span>{timeLabel(slot.localEnd ?? slot.endAt, timezone)} · {duration} phút</span><small>{slot.staffCandidates?.[0]?.displayName ?? "Nhân sự phù hợp"}</small></button>; })}</div>{!groupSlots.length ? <p className={styles.noSlots}>Không có khung giờ.</p> : null}</div>; })}</div> : null}
              </div>
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.sectionHeading}><div><h2>Lịch trong ngày của {selectedStaffName}</h2><p>Khung thời gian được hiển thị theo múi giờ chi nhánh.</p></div></div>
            <div className={styles.timeline}><div className={styles.timelineHours}>{["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"].map((hour) => <span key={hour}>{hour}</span>)}</div><div className={styles.timelineTrack}>{slots.slice(0, 8).map((slot: any) => <div className={`${styles.timelineSlot} ${selectedSlot?.fingerprint === slot.fingerprint ? styles.timelineSelected : ""}`} key={slot.fingerprint} style={{ left: `${Math.min(96, Math.max(0, (Number(timeLabel(slot.localStart ?? slot.startAt, timezone).slice(0, 2)) - 9) * 11))}%`, width: "10%" }} title={`${timeLabel(slot.startAt, timezone)} · ${slot.staffCandidates?.[0]?.displayName ?? "Nhân sự phù hợp"}`} />)}</div></div>
          </section>
        </main>

        <aside className={styles.sideColumn}>
          <section className={`${styles.card} ${styles.summaryCard}`}><div className={styles.sectionHeading}><h2>Tóm tắt thay đổi</h2><span className={styles.lockHint}>Giữ lịch cũ</span></div><div className={styles.beforeAfter}><div><small>Trước</small><strong>{row.startAt ? dateLabel(row.startAt, timezone, false) : "—"}</strong><span>{row.startAt ? `${timeLabel(row.startAt, timezone)} – ${timeLabel(row.endAt, timezone)}` : "—"}</span><em>{currentStaffName}</em></div><b>→</b><div className={styles.after}><small>Sau</small><strong>{selectedSlot?.startAt ? dateLabel(selectedSlot.startAt, timezone, false) : "Chưa chọn"}</strong><span>{selectedSlot ? `${timeLabel(selectedSlot.startAt, timezone)} – ${timeLabel(selectedSlot.endAt, timezone)}` : "Chọn khung giờ"}</span><em>{selectedStaffName}</em></div></div><div className={styles.summaryMeta}><span>◷ <b>{duration} phút</b></span><span>♧ <b>{currentServices.length} dịch vụ</b></span><span>⌂ <b>{text(branch?.name, "Chi nhánh")}</b></span></div></section>

          <section className={styles.card}><div className={styles.sectionHeading}><h2>Kỹ thuật viên</h2><span className={styles.availableTag}>● Khả dụng</span></div><div className={styles.staffProfile}><IconBadge tone="blue">♙</IconBadge><div><strong>{selectedStaffName}</strong><span>{currentServices.map((item: any) => serviceName(item.service)).join(", ")}</span></div></div><div className={styles.staffTimeline}><span>Lịch trước</span><span className={styles.currentMarker}>Lịch của bạn<br /><b>{selectedSlot ? `${timeLabel(selectedSlot.startAt, timezone)} – ${timeLabel(selectedSlot.endAt, timezone)}` : "Chưa chọn"}</b></span><span>Lịch tiếp theo</span></div><div className={styles.miniTrack}><i /><i className={styles.booked} /><i className={styles.selectedTrack} /><i className={styles.booked} /><i /></div></section>

          <section className={styles.card}><div className={styles.sectionHeading}><h2>Ảnh hưởng của thay đổi</h2></div><ul className={styles.impactList}><li><span>▣ Dịch vụ</span><b>Không thay đổi</b></li><li><span>♙ Kỹ thuật viên</span><b>Không thay đổi</b></li><li><span>◷ Giờ dịch vụ</span><b>Không thay đổi</b></li><li><span>◷ Thời lượng</span><b>Không thay đổi</b></li><li className={styles.impactNote}><span>◫ Nhắc hẹn</span><b>Cập nhật theo thời gian mới</b></li><li className={styles.impactNote}><span>✉ Khách sẽ nhận email xác nhận lịch mới</span></li></ul></section>

          <section className={styles.card}><div className={styles.sectionHeading}><h2>Lý do đổi lịch</h2></div><label className={styles.field}><span>Lý do</span><select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>{REASON_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className={styles.field}><span>Ghi chú nội bộ</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} rows={3} placeholder="Nhập ghi chú cho lịch sử đổi lịch…" /><small>{note.length}/2000</small></label><label className={styles.confirmLine}><input type="checkbox" checked={confirmChecked} onChange={(event) => setConfirmChecked(event.target.checked)} /><span>Tôi đã kiểm tra thời gian mới với khách hàng</span></label><label className={`${styles.toggleLine} ${styles.disabledLine}`}><input type="checkbox" checked={emailReminder} onChange={(event) => setEmailReminder(event.target.checked)} disabled /><span>Gửi email xác nhận lịch mới <small>Chưa bật trong DEV</small></span></label>{hold ? <p className={styles.holdNotice}>Slot đang được giữ đến {holdExpiresAt}. Lịch cũ chưa bị thay đổi.</p> : null}</section>
        </aside>
      </div>

      <footer className={styles.stickyFooter}><a className={styles.buttonSecondary} href={`/admin/appointments/${appointmentId}/overview`}>← Quay lại chi tiết lịch hẹn</a><div><button type="button" className={styles.buttonSecondary} onClick={() => void resetSelection()} disabled={!hold && !selectedSlot}>Hủy chọn slot</button><button type="button" className={styles.buttonPrimary} onClick={() => void confirm()} disabled={!canConfirm}>{saving ? "Đang xử lý…" : "✓  Xác nhận đổi lịch"}</button></div></footer>
    </div>
  );
}

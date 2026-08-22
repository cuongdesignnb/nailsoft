/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { currencyMinorUnit } from "@nailsoft/domain-types";
import { authorizedFetch } from "../auth";
import styles from "./appointment-cancel.module.css";

type ViewState = "loading" | "ready" | "error" | "forbidden" | "offline";
type ReasonCode = "CUSTOMER_REQUEST" | "SALON_UNAVAILABLE" | "STAFF_UNAVAILABLE" | "DUPLICATE" | "OTHER";
type RebookIntent = "UNDECIDED" | "REBOOK_NOW" | "NO";

const CANCELABLE_STATUSES = new Set([
  "DRAFT",
  "PENDING_CONFIRMATION",
  "PENDING_DEPOSIT",
  "CONFIRMED",
  "CHECKED_IN",
  "IN_SERVICE",
  "PARTIALLY_COMPLETED",
]);

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Bản nháp",
  PENDING_CONFIRMATION: "Chờ xác nhận",
  PENDING_DEPOSIT: "Chờ đặt cọc",
  CONFIRMED: "Đã xác nhận",
  CHECKED_IN: "Đã check-in",
  IN_SERVICE: "Đang phục vụ",
  PARTIALLY_COMPLETED: "Đã làm một phần",
  COMPLETED: "Hoàn thành",
  CHECKED_OUT: "Đã checkout",
  PAID: "Đã thanh toán",
  CANCELLED_BY_CUSTOMER: "Khách đã hủy",
  CANCELLED_BY_SALON: "Salon đã hủy",
  NO_SHOW: "Không đến",
  EXPIRED: "Đã hết hạn",
};

const REASON_OPTIONS: Array<{ value: ReasonCode; label: string; description: string }> = [
  { value: "CUSTOMER_REQUEST", label: "Khách hàng yêu cầu", description: "Khách chủ động liên hệ và muốn hủy lịch." },
  { value: "SALON_UNAVAILABLE", label: "Salon không thể phục vụ", description: "Salon hoặc chi nhánh không thể đáp ứng lịch đã đặt." },
  { value: "STAFF_UNAVAILABLE", label: "Kỹ thuật viên không khả dụng", description: "Nhân sự được chỉ định không thể thực hiện lịch hẹn." },
  { value: "DUPLICATE", label: "Trùng lịch", description: "Booking được tạo trùng hoặc không còn cần thiết." },
  { value: "OTHER", label: "Khác", description: "Nhập lý do cụ thể ở phần ghi chú bên dưới." },
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
    throw Object.assign(new Error("Bạn không có quyền truy cập dữ liệu này."), { forbidden: true, code: body?.error?.code });
  }
  if (!response.ok) {
    throw Object.assign(new Error(body?.error?.message ?? "Không thể tải dữ liệu."), {
      code: body?.error?.code,
      status: response.status,
    });
  }
  return body?.data ?? body;
}

async function post(path: string, payload: unknown, idempotencyKey: string) {
  const response = await authorizedFetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error("Bạn không có quyền hủy lịch hẹn."), { forbidden: true, code: body?.error?.code });
  }
  if (!response.ok) {
    throw Object.assign(new Error(body?.error?.message ?? "Không thể hủy lịch hẹn."), {
      code: body?.error?.code,
      status: response.status,
    });
  }
  return body?.data ?? body;
}

function text(value: unknown, fallback = "—") {
  return value == null || value === "" ? fallback : String(value);
}

function dateTimeLabel(value: string | undefined, timezone: string, withWeekday = false) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: timezone || undefined,
    weekday: withWeekday ? "long" : undefined,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function dateLabel(value: string | undefined, timezone: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", { timeZone: timezone || undefined, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

function timeLabel(value: string | undefined, timezone: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", { timeZone: timezone || undefined, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function durationMinutes(appointment: any) {
  if (!appointment?.startAt || !appointment?.endAt) return 0;
  return Math.max(0, Math.round((new Date(appointment.endAt).getTime() - new Date(appointment.startAt).getTime()) / 60_000));
}

function formatMoneyMinor(value: unknown, currency = "VND") {
  if (value === null || value === undefined || value === "") return "—";
  const minor = currencyMinorUnit(currency);
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: minor }).format(Number(value) / 10 ** minor);
}

function initials(value: unknown) {
  return String(value ?? "?").trim().split(/\s+/).slice(-2).map((part) => part.slice(0, 1)).join("").toUpperCase() || "?";
}

function errorText(cause: any, fallback: string) {
  switch (cause?.code) {
    case "BOOKING_VERSION_CONFLICT":
    case "VERSION_CONFLICT":
      return "Lịch hẹn vừa thay đổi. Đã tải lại dữ liệu; bạn cần kiểm tra và xác nhận lại.";
    case "BOOKING_STATUS_INVALID":
      return "Trạng thái lịch hẹn đã thay đổi nên không thể hủy từ màn này.";
    case "APPOINTMENT_CANCEL_NOT_ALLOWED":
      return "Lịch hẹn không còn được phép hủy.";
    default:
      return cause?.message ?? fallback;
  }
}

function StateBox({ state, error, retry, label }: { state: ViewState; error?: string; retry: () => void; label: string }) {
  if (state === "loading") return <div className={`${styles.stateBox} ${styles.loading}`} role="status" aria-busy="true"><span className={styles.spinner} />Đang tải {label}…</div>;
  if (state === "forbidden") return <div className={`${styles.stateBox} ${styles.danger}`} role="alert"><strong>Không có quyền truy cập</strong><span>{error ?? "Tài khoản hiện tại không được phép xem dữ liệu này."}</span><button type="button" onClick={retry}>Thử lại</button></div>;
  if (state === "offline") return <div className={`${styles.stateBox} ${styles.danger}`} role="alert"><strong>Mất kết nối</strong><span>Không thể tải dữ liệu từ máy chủ API.</span><button type="button" onClick={retry}>Thử lại</button></div>;
  if (state === "error") return <div className={`${styles.stateBox} ${styles.danger}`} role="alert"><strong>Không thể tải {label}</strong><span>{error ?? "Có lỗi xảy ra khi gọi API."}</span><button type="button" onClick={retry}>Thử lại</button></div>;
  return null;
}

function Card({ title, eyebrow, children, className = "", action }: { title: string; eyebrow?: string | undefined; children: ReactNode; className?: string | undefined; action?: ReactNode | undefined }) {
  return <section className={`${styles.card} ${className}`}><div className={styles.cardHeading}><div>{eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}<h2>{title}</h2></div>{action}</div>{children}</section>;
}

function DataRow({ label, value, valueClass = "" }: { label: string; value: ReactNode; valueClass?: string }) {
  return <div className={styles.dataRow}><dt>{label}</dt><dd className={valueClass}>{value}</dd></div>;
}

export default function AppointmentCancelPage({ appointmentId }: { appointmentId: string }) {
  const [appointment, setAppointment] = useState<any>();
  const [pageState, setPageState] = useState<ViewState>("loading");
  const [pageError, setPageError] = useState("");
  const [branch, setBranch] = useState<any>();
  const [customer, setCustomer] = useState<any>();
  const [customerError, setCustomerError] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [reasonCode, setReasonCode] = useState<ReasonCode>("CUSTOMER_REQUEST");
  const [note, setNote] = useState("");
  const [rebookIntent, setRebookIntent] = useState<RebookIntent>("UNDECIDED");
  const [confirmBooking, setConfirmBooking] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [sendCancellationEmail, setSendCancellationEmail] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const intentKey = useRef<string | undefined>(undefined);
  const confirmTrigger = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const loadAppointment = useCallback(async () => {
    setPageState("loading");
    setPageError("");
    try {
      const data = await read(`/v1/appointments/${encodeURIComponent(appointmentId)}`);
      setAppointment(data);
      setPageState("ready");
      setSendCancellationEmail(Boolean(data?.contact?.email));
      const optional = await Promise.allSettled([
        read(`/v1/branches/${encodeURIComponent(data.branchId)}`),
        read(`/v1/customers/${encodeURIComponent(data.customerId)}`),
        read(`/v1/appointments/${encodeURIComponent(appointmentId)}/history`),
      ]);
      const [branchResult, customerResult, historyResult] = optional;
      if (branchResult.status === "fulfilled") setBranch(branchResult.value);
      if (customerResult.status === "fulfilled") { setCustomer(customerResult.value); setCustomerError(""); } else setCustomerError("Thông tin khách hàng bị giới hạn hoặc chưa tải được.");
      if (historyResult.status === "fulfilled") { setHistory(list(historyResult.value)); setHistoryError(""); } else setHistoryError("Không thể tải lịch sử hoạt động.");
    } catch (cause: any) {
      setPageError(cause?.message ?? "Không thể tải lịch hẹn.");
      setPageState(cause?.forbidden ? "forbidden" : typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
    }
  }, [appointmentId]);

  useEffect(() => { void loadAppointment(); }, [loadAppointment]);

  useEffect(() => {
    if (!modalOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(modalRef.current?.querySelectorAll<HTMLElement>("button, input, textarea, [tabindex]:not([tabindex='-1'])") ?? []).filter((element) => !element.hasAttribute("disabled"));
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) { setModalOpen(false); return; }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    window.setTimeout(() => focusable()[0]?.focus(), 0);
    return () => { document.removeEventListener("keydown", handleKeyDown); previous?.focus(); };
  }, [modalOpen, saving]);

  const timezone = branch?.timezone ?? appointment?.timezone ?? "Asia/Ho_Chi_Minh";
  const customerContact = appointment?.contact ?? {};
  const customerProfile = customer?.profile ?? customer;
  const customerContactDetail = customer?.contact ?? {};
  const displayName = customerProfile?.displayName ?? customerContact.displayName ?? "Khách hàng";
  const phone = customerContactDetail.phone ?? customerContact.phone;
  const email = customerContactDetail.email ?? customerContact.email;
  const status = String(appointment?.status ?? "");
  const cancelable = CANCELABLE_STATUSES.has(status);
  const duration = durationMinutes(appointment);
  const currency = appointment?.pricingSummary?.currency ?? "VND";
  const totalMinor = appointment?.pricingSummary?.amountMinor;
  const depositRequired = Number(appointment?.depositRequiredMinor ?? 0);
  const financialOutcome = useMemo(() => {
    if (appointment?.cancellationOutcome) return appointment.cancellationOutcome;
    const cancelWindowHours = Number(appointment?.policy?.cancellation?.cancelWindowHours ?? 24);
    if (!Number.isFinite(cancelWindowHours) || !appointment?.startAt) return "MANUAL_REVIEW";
    const hours = (new Date(appointment.startAt).getTime() - Date.now()) / 3_600_000;
    if (hours >= cancelWindowHours) return "NO_FINANCIAL_ACTION";
    return depositRequired > 0 ? "DEPOSIT_FORFEIT_RECOMMENDED" : "MANUAL_REVIEW";
  }, [appointment, depositRequired]);
  const financialReady = Boolean(appointment?.startAt);
  const noteValid = reasonCode !== "OTHER" || note.trim().length >= 3;
  const canConfirm = cancelable && financialReady && Boolean(reasonCode) && noteValid && confirmBooking && confirmRelease && !saving;
  const services = appointment?.items ?? [];
  const primaryStaff = services[0]?.staff?.displayName;
  const branchName = branch?.name ?? appointment?.branchName ?? appointment?.branchId ?? "Chi nhánh";
  const serviceIds = services.map((item: any) => item.service?.id ?? item.serviceId ?? item.service?.code).filter(Boolean);

  const resetIntent = () => { intentKey.current = undefined; setActionError(""); };

  const confirmCancel = async () => {
    if (!appointment || !canConfirm) return;
    setSaving(true);
    setActionError("");
    const key = intentKey.current ?? crypto.randomUUID();
    intentKey.current = key;
    try {
      await post(`/v1/appointments/${encodeURIComponent(appointmentId)}/cancel`, {
        version: appointment.version,
        reasonCode,
        ...(note.trim() ? { note: note.trim() } : {}),
        actorType: "USER",
        sendCancellationEmail,
      }, key);
      setModalOpen(false);
      setNotice("Đã hủy lịch hẹn và lưu toàn bộ lịch sử xử lý.");
      intentKey.current = undefined;
      const nextPath = rebookIntent === "REBOOK_NOW"
        ? `/admin/appointments/new?${new URLSearchParams({ customerId: appointment.customerId, branchId: appointment.branchId, ...(serviceIds.length ? { serviceIds: serviceIds.join(",") } : {}), ...(services.length === 1 && services[0]?.staff?.id ? { staffId: services[0].staff.id } : {}) }).toString()}`
        : `/admin/appointments/${encodeURIComponent(appointmentId)}/overview?cancelled=1`;
      window.setTimeout(() => { window.location.assign(nextPath); }, 450);
    } catch (cause: any) {
      if (cause?.code === "BOOKING_VERSION_CONFLICT" || cause?.code === "VERSION_CONFLICT") {
        intentKey.current = undefined;
        setModalOpen(false);
        setActionError(errorText(cause, "Lịch hẹn vừa thay đổi."));
        await loadAppointment();
      } else if (cause?.code === "BOOKING_STATUS_INVALID" || cause?.code === "APPOINTMENT_CANCEL_NOT_ALLOWED") {
        setModalOpen(false);
        setActionError(errorText(cause, "Lịch hẹn không còn được phép hủy."));
        await loadAppointment();
      } else {
        setActionError(errorText(cause, "Không thể hủy lịch hẹn. Bạn có thể thử lại sau khi kiểm tra dữ liệu."));
      }
    } finally {
      setSaving(false);
    }
  };

  if (pageState !== "ready") return <div className={styles.page}><StateBox state={pageState} error={pageError} retry={loadAppointment} label="lịch hẹn" /></div>;

  return <div className={styles.page}>
    <header className={styles.pageHeader}>
      <div>
        <nav className={styles.breadcrumb} aria-label="Đường dẫn"><a href="/admin/appointments">Lịch hẹn</a><span>/</span><span>#{text(appointment.bookingReference)}</span><span>/</span><span>Hủy lịch</span></nav>
        <p className={styles.kicker}>Lịch hẹn</p>
        <h1>Hủy lịch hẹn</h1>
        <p className={styles.description}>Kiểm tra thông tin và ảnh hưởng trước khi xác nhận hủy lịch hẹn.</p>
      </div>
      <a className={styles.secondaryButton} href={`/admin/appointments/${encodeURIComponent(appointmentId)}/overview`}><span aria-hidden="true">←</span> Quay lại chi tiết</a>
    </header>

    <div className={styles.safetyBanner}><span className={styles.bannerIcon} aria-hidden="true">!</span><p><strong>Hủy lịch không xóa dữ liệu.</strong> Lịch hẹn sẽ được chuyển sang trạng thái đã hủy và toàn bộ lịch sử vẫn được lưu lại.</p></div>
    {notice ? <div className={styles.successNotice} role="status"><span aria-hidden="true">✓</span>{notice}</div> : null}
    {actionError ? <div className={styles.errorNotice} role="alert"><strong>Chưa thể hủy lịch</strong><span>{actionError}</span></div> : null}

    {!cancelable ? <div className={styles.readOnlyBanner} role="status"><strong>Lịch hẹn không còn ở trạng thái có thể hủy.</strong><span>Trạng thái hiện tại: {STATUS_LABELS[status] ?? text(status)}. Không có thao tác hủy đang hoạt động.</span></div> : null}

    <div className={styles.layout}>
      <main className={styles.mainColumn}>
        <Card title="Lịch hẹn sẽ hủy" className={styles.appointmentCard} action={<span className={`${styles.statusPill} ${cancelable ? styles.statusConfirmed : styles.statusMuted}`}>{STATUS_LABELS[status] ?? text(status)}</span>}>
          <div className={styles.appointmentSummary}>
            <div className={styles.customerIdentity}><span className={styles.avatar}>{initials(displayName)}</span><div><strong>{displayName}</strong><span>{text(phone)}</span><div className={styles.identityTags}><span className={styles.vipTag}>Khách đặt lịch</span>{status === "CONFIRMED" ? <span className={styles.returningTag}>Đã xác nhận</span> : null}</div></div></div>
            <div className={styles.summaryCell}><span className={styles.cellLabel}>Mã lịch hẹn</span><strong>#{text(appointment.bookingReference)}</strong><small>{text(appointment.source, "Nguồn chưa xác định")}</small></div>
            <div className={styles.summaryCell}><span className={styles.cellLabel}>Ngày & giờ</span><strong>{dateLabel(appointment.startAt, timezone)}</strong><strong>{timeLabel(appointment.startAt, timezone)} – {timeLabel(appointment.endAt, timezone)}</strong><small>{duration || "—"} phút</small></div>
            <div className={styles.summaryCell}><span className={styles.cellLabel}>Chi nhánh</span><strong>{branchName}</strong><small>{timezone}</small></div>
            <div className={styles.summaryCell}><span className={styles.cellLabel}>Kỹ thuật viên</span><strong>{text(primaryStaff)}</strong><small>{services.length} dịch vụ</small></div>
          </div>
        </Card>

        <div className={styles.formGrid}>
          <Card title="Lý do hủy lịch" className={styles.reasonCard}>
            <fieldset className={styles.radioList}><legend className={styles.srOnly}>Chọn lý do hủy lịch</legend>{REASON_OPTIONS.map((option) => <label className={`${styles.radioCard} ${reasonCode === option.value ? styles.radioSelected : ""}`} key={option.value}><input type="radio" name="cancel-reason" value={option.value} checked={reasonCode === option.value} onChange={() => { setReasonCode(option.value); resetIntent(); }} /><span className={styles.radioDot} /><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}</fieldset>
          </Card>
          <Card title="Ghi chú nội bộ" className={styles.noteCard} action={<span className={styles.counter}>{note.length}/500</span>}>
            <textarea aria-label="Ghi chú nội bộ" value={note} maxLength={500} onChange={(event) => { setNote(event.target.value); resetIntent(); }} placeholder="Nhập thông tin giúp nhân viên hiểu lý do hủy…" />
            <p className={styles.helper}>Ghi chú chỉ hiển thị cho nhân viên salon và được lưu trong lịch sử.</p>
            {reasonCode === "OTHER" && note.trim().length < 3 ? <p className={styles.validation}>Vui lòng nhập ít nhất 3 ký tự cho lý do khác.</p> : null}
          </Card>
        </div>

        <Card title="Khách có muốn đặt lại lịch không?" className={styles.rebookCard}>
          <div className={styles.inlineOptions}>{(["UNDECIDED", "REBOOK_NOW", "NO"] as RebookIntent[]).map((value) => <label className={`${styles.inlineOption} ${rebookIntent === value ? styles.inlineSelected : ""}`} key={value}><input type="radio" name="rebook-intent" value={value} checked={rebookIntent === value} onChange={() => { setRebookIntent(value); resetIntent(); }} /><span className={styles.radioDot} /><span>{value === "UNDECIDED" ? "Chưa xác định" : value === "REBOOK_NOW" ? "Có, đặt lịch mới ngay" : "Không"}</span></label>)}</div>
          {rebookIntent === "REBOOK_NOW" ? <p className={styles.rebookHint}>Sau khi hủy thành công, màn tạo lịch mới sẽ mở với khách hàng, chi nhánh, dịch vụ và kỹ thuật viên hợp lệ. Ngày và giờ cũ không được tự động dùng lại.</p> : null}
        </Card>

        <Card title="Ảnh hưởng khi hủy lịch" className={styles.impactCard}>
          <ul className={styles.impactList}>
            <li><span className={styles.impactIcon}>◷</span><span><strong>Khung giờ</strong><small>Được giải phóng sau khi command hủy thành công.</small></span><b>Được cập nhật</b></li>
            <li><span className={styles.impactIcon}>♙</span><span><strong>Kỹ thuật viên</strong><small>Reservation đang hoạt động sẽ được release theo appointment.</small></span><b>Được cập nhật</b></li>
            <li><span className={styles.impactIcon}>□</span><span><strong>Dịch vụ / session</strong><small>Không xóa dữ liệu session hoặc lịch sử đã có.</small></span><b>Giữ lịch sử</b></li>
            <li><span className={styles.impactIcon}>⌁</span><span><strong>Nhắc hẹn</strong><small>Reminder đang chờ sẽ được worker hủy theo event.</small></span><b>Được xử lý</b></li>
            <li><span className={styles.impactIcon}>◌</span><span><strong>Lịch sử & báo cáo</strong><small>Lưu lý do, ghi chú và trạng thái hủy để tra cứu.</small></span><b>Được lưu</b></li>
          </ul>
        </Card>

        <Card title="Xác nhận hủy lịch" className={styles.confirmCard}>
          <label className={styles.checkLine}><input type="checkbox" checked={confirmBooking} onChange={(event) => { setConfirmBooking(event.target.checked); resetIntent(); }} /><span className={styles.checkBox} aria-hidden="true" /><span>Tôi đã kiểm tra đúng khách hàng và lịch hẹn cần hủy.</span></label>
          <label className={styles.checkLine}><input type="checkbox" checked={confirmRelease} onChange={(event) => { setConfirmRelease(event.target.checked); resetIntent(); }} /><span className={styles.checkBox} aria-hidden="true" /><span>Tôi hiểu thao tác này sẽ giải phóng khung giờ hiện tại.</span></label>
          {!financialReady ? <p className={styles.blockingHint}>Chưa tải được chính sách hủy tài chính. Không thể xác nhận cho đến khi dữ liệu được xác định đầy đủ.</p> : null}
        </Card>
      </main>

      <aside className={styles.sideColumn}>
        <Card title="Khách hàng" className={styles.sideCard}>
          <div className={styles.sideIdentity}><span className={styles.largeAvatar}>{initials(displayName)}</span><div><strong>{displayName}</strong><span>{text(phone)}</span></div></div>
          {customerError ? <p className={styles.sideMuted}>{customerError}</p> : null}
          <dl className={styles.dataList}><DataRow label="Email" value={text(email)} /><DataRow label="Trạng thái" value={text(customerProfile?.status, "Đang hoạt động")} /><DataRow label="Số lịch hẹn" value={customer?.activitySummary?.appointmentCount ?? "—"} /><DataRow label="Đã hoàn tất" value={customer?.activitySummary?.completedVisitCount ?? "—"} /></dl>
        </Card>

        <Card title="Tóm tắt lịch hẹn" className={styles.sideCard}>
          <dl className={styles.dataList}><DataRow label="Ngày" value={dateLabel(appointment.startAt, timezone)} /><DataRow label="Thời gian" value={`${timeLabel(appointment.startAt, timezone)} – ${timeLabel(appointment.endAt, timezone)}`} /><DataRow label="Kỹ thuật viên" value={text(primaryStaff)} /><DataRow label="Dịch vụ" value={`${services.length} dịch vụ`} /><DataRow label="Thời lượng" value={`${duration || "—"} phút`} /><DataRow label="Chi nhánh" value={branchName} /></dl>
          <span className={`${styles.statusPill} ${styles.statusConfirmed}`}>{STATUS_LABELS[status] ?? text(status)}</span>
        </Card>

        <Card title="Thanh toán & đặt cọc" className={styles.sideCard}>
          <dl className={styles.dataList}><DataRow label="Tổng dịch vụ" value={formatMoneyMinor(totalMinor, currency)} /><DataRow label="Tiền cọc yêu cầu" value={formatMoneyMinor(depositRequired, currency)} /><DataRow label="Đã thanh toán" value="—" /><DataRow label="Trạng thái cọc" value={appointment.depositStatus === "NOT_REQUIRED" ? "Không yêu cầu" : text(appointment.depositStatus)} /></dl>
          <div className={`${styles.outcomeBox} ${financialOutcome === "DEPOSIT_FORFEIT_RECOMMENDED" ? styles.warningBox : financialOutcome === "MANUAL_REVIEW" ? styles.reviewBox : ""}`}><strong>{financialOutcome === "NO_FINANCIAL_ACTION" ? "Không cần xử lý tài chính" : financialOutcome === "DEPOSIT_FORFEIT_RECOMMENDED" ? "Cần xem xét tiền cọc" : "Cần kiểm tra thủ công"}</strong><span>{financialOutcome === "NO_FINANCIAL_ACTION" ? "Theo chính sách hiện tại, hủy lịch không phát sinh xử lý tài chính." : financialOutcome === "DEPOSIT_FORFEIT_RECOMMENDED" ? "Khoản cọc có thể bị giữ theo chính sách; cần đối chiếu trước khi xử lý." : "Dữ liệu tài chính chưa đủ để kết luận tự động."}</span></div>
        </Card>

        <Card title="Thông báo khách hàng" className={styles.sideCard}>
          <label className={`${styles.toggleLine} ${email ? "" : styles.disabledLine}`}><input type="checkbox" checked={sendCancellationEmail} disabled={!email} onChange={(event) => { setSendCancellationEmail(event.target.checked); resetIntent(); }} /><span className={styles.toggleTrack}><span /></span><strong>Gửi email thông báo hủy lịch</strong></label>
          <p className={styles.emailValue}>{email ? email : "Không có email hợp lệ để gửi thông báo."}</p>
          <p className={styles.sideMuted}>Thông báo chỉ được tạo khi bật lựa chọn và có communication rule đang hoạt động.</p>
        </Card>

        <Card title="Lịch sử lịch hẹn" className={styles.sideCard}>
          {historyError ? <p className={styles.sideMuted}>{historyError}</p> : null}
          {history.length ? <ol className={styles.historyList}>{history.slice(-5).reverse().map((item: any, index: number) => <li key={item.id ?? `${item.created_at}-${index}`}><span className={styles.historyDot} /><div><strong>{dateTimeLabel(item.created_at, timezone)}</strong><span>{STATUS_LABELS[item.to_status] ?? text(item.to_status, "Cập nhật trạng thái")}</span>{item.reason_code ? <small>{item.reason_code}</small> : null}</div></li>)}</ol> : !historyError ? <p className={styles.sideMuted}>Chưa có bản ghi lịch sử.</p> : null}
        </Card>
      </aside>
    </div>

    <footer className={styles.stickyFooter}><a className={styles.secondaryButton} href={`/admin/appointments/${encodeURIComponent(appointmentId)}/overview`}>← Quay lại chi tiết lịch hẹn</a><div><a className={styles.secondaryButton} href={`/admin/appointments/${encodeURIComponent(appointmentId)}/overview`}>Giữ lịch hẹn</a><button ref={confirmTrigger} type="button" className={styles.dangerButton} disabled={!canConfirm} onClick={() => { setActionError(""); setModalOpen(true); }}>Xác nhận hủy lịch</button></div></footer>

    {modalOpen ? <div className={styles.modalOverlay} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !saving) setModalOpen(false); }}><div ref={modalRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="cancel-dialog-title"><div className={styles.modalHeader}><div><p className={styles.eyebrow}>Xác nhận thao tác</p><h2 id="cancel-dialog-title">Xác nhận hủy lịch?</h2></div><button type="button" className={styles.closeButton} aria-label="Đóng hộp thoại" onClick={() => setModalOpen(false)} disabled={saving}>×</button></div><p className={styles.modalLead}>Lịch hẹn sẽ chuyển sang trạng thái <strong>đã hủy</strong>. Dữ liệu và lịch sử không bị xóa.</p><dl className={styles.modalSummary}><DataRow label="Mã lịch" value={`#${text(appointment.bookingReference)}`} /><DataRow label="Khách hàng" value={displayName} /><DataRow label="Thời gian" value={`${dateLabel(appointment.startAt, timezone)} · ${timeLabel(appointment.startAt, timezone)} – ${timeLabel(appointment.endAt, timezone)}`} /><DataRow label="Lý do" value={REASON_OPTIONS.find((item) => item.value === reasonCode)?.label ?? reasonCode} /></dl>{actionError ? <div className={styles.errorNotice} role="alert">{actionError}</div> : null}<div className={styles.modalActions}><button type="button" className={styles.secondaryButton} onClick={() => setModalOpen(false)} disabled={saving}>Quay lại</button><button type="button" className={styles.dangerButton} onClick={() => void confirmCancel()} disabled={saving}>{saving ? "Đang xử lý…" : "Hủy lịch hẹn"}</button></div></div></div> : null}
  </div>;
}

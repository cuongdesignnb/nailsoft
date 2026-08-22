/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "@nailsoft/ui-web";
import { authorizedFetch } from "../auth";
import styles from "./appointment-detail.module.css";

type LoadState = "loading" | "ready" | "error" | "forbidden" | "offline";

type AppointmentData = {
  id: string;
  bookingReference?: string;
  branchId?: string;
  customerId?: string;
  status?: string;
  source?: string;
  startAt?: string;
  endAt?: string;
  createdAt?: string;
  version?: number;
  depositStatus?: string;
  depositRequiredMinor?: number;
  pricingSummary?: Record<string, unknown>;
  checkoutReady?: boolean;
  contact?: Record<string, unknown>;
  customerNote?: string | null;
  items?: Array<Record<string, any>>;
};

const STATUS_LABELS: Record<string, string> = {
  PENDING_CONFIRMATION: "Chờ xác nhận",
  PENDING_DEPOSIT: "Chờ đặt cọc",
  CONFIRMED: "Đã xác nhận",
  ARRIVED: "Khách đã đến",
  CHECKED_IN: "Đã check-in",
  IN_SERVICE: "Đang phục vụ",
  PARTIALLY_COMPLETED: "Đang hoàn thiện",
  COMPLETED: "Hoàn thành",
  CHECKED_OUT: "Đã thanh toán",
  PAID: "Đã thanh toán",
  CANCELLED_BY_CUSTOMER: "Khách đã hủy",
  CANCELLED_BY_SALON: "Salon đã hủy",
  NO_SHOW: "Khách không đến",
  EXPIRED: "Đã hết hạn",
};

const SOURCE_LABELS: Record<string, string> = {
  IMPORT: "Nhập dữ liệu",
  RECEPTION: "Lễ tân",
  ONLINE: "Đặt online",
  PUBLIC: "Đặt online",
  WALK_IN: "Khách vãng lai",
  PHONE: "Điện thoại",
  FACEBOOK: "Facebook",
};

const HISTORY_REASON_LABELS: Record<string, string> = {
  DETERMINISTIC_SEED: "Khởi tạo dữ liệu",
  CONFIRMED: "Xác nhận lịch hẹn",
  CUSTOMER_REQUEST: "Theo yêu cầu khách hàng",
  SALON_UNAVAILABLE: "Salon không thể phục vụ",
  CUSTOMER_ARRIVED: "Khách đã đến",
  SERVICE_STARTED: "Bắt đầu phục vụ",
  SERVICE_COMPLETED: "Hoàn tất dịch vụ",
};

const STATUS_STEPS = [
  { key: "BOOKED", label: "Đặt lịch" },
  { key: "CONFIRMED", label: "Đã xác nhận" },
  { key: "CHECK_IN", label: "Check-in" },
  { key: "IN_SERVICE", label: "Đang phục vụ" },
  { key: "COMPLETED", label: "Hoàn thành" },
  { key: "PAID", label: "Thanh toán" },
] as const;

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
    throw new Error(body?.error?.message ?? "Không thể tải dữ liệu.");
  }
  return body?.data ?? body;
}

function text(value: unknown, fallback = "—") {
  return value == null || value === "" ? fallback : String(value);
}

function serviceName(service: any) {
  return service?.name?.["vi-VN"] ?? service?.name?.["en-US"] ?? service?.name ?? service?.code ?? "Dịch vụ";
}

function dateParts(value: string | undefined, timezone: string | undefined) {
  if (!value) return { date: "—", time: "—", full: "—" };
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return { date: "—", time: "—", full: "—" };
  const options = timezone ? { timeZone: timezone } : undefined;
  return {
    date: new Intl.DateTimeFormat("vi-VN", { ...options, weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" }).format(date),
    time: new Intl.DateTimeFormat("vi-VN", { ...options, hour: "2-digit", minute: "2-digit" }).format(date),
    full: new Intl.DateTimeFormat("vi-VN", { ...options, dateStyle: "medium", timeStyle: "short" }).format(date),
  };
}

function formatMoney(value: unknown, currency = "VND") {
  if (value == null || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  if (currency === "VND") return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(amount)} đ`;
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
}

function durationMinutes(start?: string, end?: string, items?: Array<Record<string, any>>) {
  if (start && end) {
    const minutes = Math.round((new Date(end).valueOf() - new Date(start).valueOf()) / 60000);
    if (minutes > 0) return minutes;
  }
  return (items ?? []).reduce((total, item) => total + Number(item.service?.durationMin ?? item.durationMin ?? 0), 0) || null;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(-2).map((part) => part[0]).join("").toUpperCase() || "KH";
}

function statusLabel(value: unknown) {
  return STATUS_LABELS[String(value)] ?? "Đang cập nhật";
}

function statusTone(value: string | undefined): "success" | "warning" | "danger" | "info" | "neutral" {
  if (value === "COMPLETED" || value === "CHECKED_OUT" || value === "PAID") return "success";
  if (value?.startsWith("CANCEL") || value === "NO_SHOW" || value === "EXPIRED") return "danger";
  if (value === "PENDING_CONFIRMATION" || value === "PENDING_DEPOSIT") return "warning";
  if (value === "IN_SERVICE" || value === "ARRIVED" || value === "CHECKED_IN") return "info";
  return "neutral";
}

function badgeClass(tone: ReturnType<typeof statusTone>) {
  const capitalized = tone.charAt(0).toUpperCase() + tone.slice(1);
  return `${styles.badge} ${styles[`badge${capitalized}`]}`;
}

function isTerminal(status: string | undefined) {
  return Boolean(status?.startsWith("CANCEL") || ["NO_SHOW", "EXPIRED", "COMPLETED", "CHECKED_OUT", "PAID"].includes(status ?? ""));
}

function stepIndex(status: string | undefined, paid: boolean) {
  if (paid) return 5;
  if (status === "COMPLETED" || status === "CHECKED_OUT") return 4;
  if (status === "IN_SERVICE" || status === "PARTIALLY_COMPLETED") return 3;
  if (["ARRIVED", "CHECKED_IN"].includes(status ?? "")) return 2;
  if (["CONFIRMED", "PENDING_DEPOSIT"].includes(status ?? "")) return 1;
  return 0;
}

function customerValue(customer: any, appointment: Partial<AppointmentData>, key: string) {
  return customer?.contact?.[key] ?? appointment.contact?.[key];
}

function ActionLink({ href, icon, children, variant = "secondary", disabled = false }: { href: string; icon: "calendar" | "edit" | "close" | "customer" | "plus"; children: ReactNode; variant?: "secondary" | "primary" | "danger"; disabled?: boolean }) {
  const capitalized = variant.charAt(0).toUpperCase() + variant.slice(1);
  if (disabled) return <button type="button" className={`${styles.action} ${styles[`action${capitalized}`]} ${styles.actionDisabled}`} disabled aria-disabled="true"><Icon name={icon} />{children}</button>;
  return <a className={`${styles.action} ${styles[`action${capitalized}`]}`} href={href}><Icon name={icon} />{children}</a>;
}

function Card({ title, icon, action, children, className = "" }: { title: string; icon: "calendar" | "customer" | "staff" | "file" | "payment" | "activity"; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`${styles.card} ${className}`}><header className={styles.cardHeader}><div className={styles.cardTitle}><span className={styles.cardIcon}><Icon name={icon} /></span><h2>{title}</h2></div>{action}</header>{children}</section>;
}

function StateMessage({ state, error, retry, label }: { state: LoadState; error?: string; retry: () => void; label: string }) {
  if (state === "loading") return <div className={`${styles.state} ${styles.skeletonState}`} role="status" aria-busy="true"><span className={styles.spinner} />Đang tải {label}…</div>;
  if (state === "forbidden") return <div className={`${styles.state} ${styles.stateDanger}`} role="alert"><strong>Không có quyền truy cập</strong><span>{error ?? "Vai trò hoặc phạm vi chi nhánh hiện tại không cho phép xem dữ liệu này."}</span><button type="button" className={styles.retry} onClick={retry}>Thử lại</button></div>;
  if (state === "offline") return <div className={styles.state} role="alert"><strong>Cần kết nối Internet</strong><span>Không thể tải dữ liệu lịch hẹn khi đang offline.</span><button type="button" className={styles.retry} onClick={retry}>Thử lại</button></div>;
  if (state === "error") return <div className={`${styles.state} ${styles.stateDanger}`} role="alert"><strong>Không thể tải dữ liệu</strong><span>{error ?? `Không thể tải ${label}.`}</span><button type="button" className={styles.retry} onClick={retry}>Thử lại</button></div>;
  return null;
}

function useAppointmentData(id: string) {
  const [state, setState] = useState<LoadState>("loading");
  const [appointment, setAppointment] = useState<AppointmentData>();
  const [history, setHistory] = useState<any[]>([]);
  const [customer, setCustomer] = useState<any>();
  const [branches, setBranches] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [secondaryError, setSecondaryError] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    setSecondaryError("");
    try {
      const [detailResult, historyResult, branchesResult] = await Promise.allSettled([
        read(`/v1/appointments/${id}`),
        read(`/v1/appointments/${id}/history`),
        read("/v1/branches"),
      ]);
      if (detailResult.status === "rejected") throw detailResult.reason;
      const detail = detailResult.value as AppointmentData;
      setAppointment(detail);
      setHistory(historyResult.status === "fulfilled" ? list(historyResult.value) : []);
      setBranches(branchesResult.status === "fulfilled" ? list(branchesResult.value) : []);
      const extraErrors = [historyResult, branchesResult].filter((result) => result.status === "rejected").map((result) => result.reason?.message).filter(Boolean);
      if (extraErrors.length) setSecondaryError("Một phần thông tin phụ chưa tải được. Bạn có thể thử lại.");
      if (detail.customerId) {
        try {
          setCustomer(await read(`/v1/customers/${detail.customerId}`));
        } catch {
          setSecondaryError("Thông tin hồ sơ khách hàng chưa tải được. Bạn có thể thử lại.");
        }
      }
      setState("ready");
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể tải chi tiết lịch hẹn.");
      setState(cause?.forbidden ? "forbidden" : typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  return { state, appointment, history, customer, branches, error, secondaryError, load };
}

function Progress({ status, checkoutReady, depositStatus }: { status: string | undefined; checkoutReady: boolean | undefined; depositStatus: string | undefined }) {
  const paid = Boolean(checkoutReady || ["PAID", "SETTLED", "COMPLETED"].includes(depositStatus ?? ""));
  const current = stepIndex(status, paid);
  const cancelled = Boolean(status?.startsWith("CANCEL") || status === "NO_SHOW" || status === "EXPIRED");
  return <ol className={styles.progress} aria-label="Tiến trình lịch hẹn">
    {STATUS_STEPS.map((step, index) => {
      const completed = !cancelled && index < current;
      const active = !cancelled && index === current;
      return <li className={`${completed ? styles.progressDone : ""} ${active ? styles.progressActive : ""} ${cancelled ? styles.progressMuted : ""}`} key={step.key}><span className={styles.progressNode}>{completed ? <Icon name="check" /> : index + 1}</span><strong>{step.label}</strong><small>{active ? statusLabel(status) : completed ? "Đã hoàn tất" : "Chưa thực hiện"}</small></li>;
    })}
  </ol>;
}

function ActivityTimeline({ history }: { history: any[] }) {
  if (!history.length) return <div className={styles.empty}>Chưa có sự kiện trong lịch sử xử lý.</div>;
  return <ol className={styles.timeline}>{history.map((entry) => {
    const targetStatus = entry.to_status ?? entry.toStatus;
    const reason = entry.reason_code ?? entry.reasonCode;
    const title = targetStatus ? `Lịch hẹn ${statusLabel(targetStatus).toLowerCase()}` : "Cập nhật lịch hẹn";
    const actor = entry.actor_type === "SYSTEM" ? "Hệ thống" : entry.actor_type === "CUSTOMER" ? "Khách hàng" : entry.actor_type === "USER" ? "Nhân viên" : "Nguồn nghiệp vụ";
    const timestamp = entry.created_at ?? entry.createdAt;
    return <li key={entry.id ?? `${timestamp}-${targetStatus}`}><span className={styles.timelineDot}><Icon name={targetStatus === "COMPLETED" ? "check" : "activity"} /></span><div><strong>{title}</strong><p>{HISTORY_REASON_LABELS[reason] ?? "Có thay đổi được ghi nhận"} · {actor}</p><time>{dateParts(timestamp, undefined).full}</time></div></li>;
  })}</ol>;
}

function ServiceHistory({ customer, timezone }: { customer: any; timezone?: string }) {
  const rows = customer?.recentAppointments ?? [];
  if (!rows.length) return <div className={styles.empty}>Chưa có lịch sử dịch vụ được cung cấp từ hồ sơ khách hàng.</div>;
  return <div className={styles.historyList}>{rows.slice(0, 5).map((row: any) => <div className={styles.historyRow} key={row.id}><span><strong>{text(row.bookingReference, "Lịch hẹn")}</strong><small>{dateParts(row.scheduledStartAt, timezone).full}</small></span><span className={badgeClass(statusTone(row.status))}>{statusLabel(row.status)}</span></div>)}</div>;
}

export default function AppointmentDetailPage({ id, tab = "overview" }: { id: string; tab?: string }) {
  const data = useAppointmentData(id);
  const appointment = data.appointment;
  const branch = useMemo(() => data.branches.find((item) => item.id === appointment?.branchId), [appointment?.branchId, data.branches]);
  const timezone = branch?.timezone;
  const contactName = text(data.customer?.profile?.displayName ?? appointment?.contact?.displayName, "Khách hàng");
  const phone = customerValue(data.customer, appointment ?? {}, "phone");
  const email = customerValue(data.customer, appointment ?? {}, "email");
  const items = appointment?.items ?? [];
  const primaryStaff = items[0]?.staff;
  const duration = durationMinutes(appointment?.startAt, appointment?.endAt, items);
  const currency = String(appointment?.pricingSummary?.currency ?? "VND");
  const amount = appointment?.pricingSummary?.amountMinor;
  const source = SOURCE_LABELS[String(appointment?.source)] ?? "Đặt lịch";
  const detailDate = dateParts(appointment?.startAt, timezone);
  const terminal = isTerminal(appointment?.status);
  const canCheckIn = ["PENDING_CONFIRMATION", "PENDING_DEPOSIT", "CONFIRMED", "ARRIVED"].includes(appointment?.status ?? "");
  const canCancel = !terminal;
  const canReschedule = !terminal;

  if (data.state !== "ready" || !appointment) {
    return <main className={styles.page}><StateMessage state={data.state} error={data.error} retry={data.load} label="chi tiết lịch hẹn" /></main>;
  }

  const pricing = appointment.pricingSummary ?? {};
  const discount = pricing.discountMinor ?? pricing.discountAmountMinor;
  const tax = pricing.taxMinor ?? pricing.taxAmountMinor;
  const deposit = appointment.depositRequiredMinor;
  const paidDeposit = ["PAID", "WAIVED"].includes(appointment.depositStatus ?? "");

  return <main className={styles.page}>
    <header className={styles.pageHeader}>
      <div className={styles.breadcrumb}><a href="/admin/appointments">Lịch hẹn</a><span>/</span><strong>Chi tiết lịch hẹn</strong></div>
      <div className={styles.headingRow}><div><h1>Chi tiết lịch hẹn</h1><p>Theo dõi thông tin khách hàng, dịch vụ và toàn bộ quá trình xử lý lịch hẹn.</p></div><div className={styles.headingActions}><ActionLink href={`/admin/appointments/${id}/reschedule`} icon="calendar" disabled={!canReschedule}>Đổi lịch</ActionLink><ActionLink href="#edit" icon="edit" disabled>Chỉnh sửa</ActionLink><ActionLink href={`/admin/appointments/${id}/cancel`} icon="close" variant="danger" disabled={!canCancel}>Hủy lịch</ActionLink><ActionLink href={`/admin/appointments/${id}/check-in`} icon="customer" variant="primary" disabled={!canCheckIn}>Check-in khách</ActionLink></div></div>
      <div className={styles.referenceRow}><strong>#{text(appointment.bookingReference, id.slice(0, 8))}</strong><span className={badgeClass(statusTone(appointment.status))}><span className={styles.badgeDot} />{statusLabel(appointment.status)}</span><span className={styles.referenceMeta}>Nguồn: {source} · Phiên bản {text(appointment.version)}</span></div>
    </header>

    {data.secondaryError ? <div className={styles.partialNotice} role="status"><Icon name="alert" />{data.secondaryError}</div> : null}

    <section className={styles.heroCard} aria-label="Thông tin lịch hẹn">
      <div className={styles.heroCustomer}><span className={styles.avatarLarge}>{initials(contactName)}</span><div><span className={styles.label}>Khách hàng</span><h2>{contactName}</h2><p>{text(phone)}{email ? ` · ${email}` : ""}</p><div className={styles.miniBadges}>{data.customer?.profile?.status === "ACTIVE" ? <span>Đang hoạt động</span> : null}{data.customer?.profile?.isGuest ? <span>Khách vãng lai</span> : null}</div></div></div>
      <div className={styles.heroFact}><span className={styles.factIcon}><Icon name="calendar" /></span><div><span className={styles.label}>Thời gian</span><strong>{detailDate.date}</strong><b>{detailDate.time} – {dateParts(appointment.endAt, timezone).time}</b><small>{duration ? `${duration} phút` : "Chưa có thời lượng"}</small></div></div>
      <div className={styles.heroFact}><span className={styles.factIcon}><Icon name="store" /></span><div><span className={styles.label}>Chi nhánh</span><strong>{text(branch?.name, "Đang tải chi nhánh…")}</strong><small>{text(timezone, "Theo múi giờ chi nhánh")}</small></div></div>
      <div className={styles.heroFact}><span className={styles.factIcon}><Icon name="staff" /></span><div><span className={styles.label}>Kỹ thuật viên chính</span><strong>{text(primaryStaff?.displayName, "Chưa phân công")}</strong><small>{items.length ? `${items.length} dịch vụ trong lịch` : "Chưa có dịch vụ"}</small></div></div>
      <div className={styles.heroFooter}><span><Icon name="clock" />Tạo lúc {dateParts(appointment.createdAt, timezone).full}</span><span className={badgeClass(statusTone(appointment.status))}><span className={styles.badgeDot} />{statusLabel(appointment.status)}</span></div>
    </section>

    <section className={styles.progressCard}><Progress status={appointment.status} checkoutReady={appointment.checkoutReady} depositStatus={appointment.depositStatus} />{appointment.status?.startsWith("CANCEL") || ["NO_SHOW", "EXPIRED"].includes(appointment.status ?? "") ? <p className={styles.exceptionNote}>Lịch hẹn này đã kết thúc theo trạng thái “{statusLabel(appointment.status)}”; các bước sau không được đánh dấu hoàn thành.</p> : null}</section>

    <div className={styles.workspace}>
      <div className={styles.mainColumn}>
        <Card title="Dịch vụ trong lịch hẹn" icon="file" action={<ActionLink href={`/admin/appointments/${id}/add-service`} icon="plus" disabled={terminal}>Thêm dịch vụ</ActionLink>}>
          {items.length ? <div className={styles.serviceList}>{items.map((item) => { const service = item.service ?? {}; const price = item.price?.amountMinor ?? item.price?.amount ?? item.priceMinor; const itemDuration = item.service?.durationMin ?? durationMinutes(item.serviceStartAt, item.serviceEndAt); return <article className={styles.serviceRow} key={item.id}><span className={styles.serviceIcon}><Icon name="gift" /></span><div className={styles.serviceMain}><strong>{serviceName(service)}</strong><small>{text(service.description?.["vi-VN"] ?? service.description?.["en-US"] ?? service.description, "Theo snapshot dịch vụ")}</small><span><Icon name="clock" />{itemDuration ? `${itemDuration} phút` : "Chưa có thời lượng"} · {text(item.staff?.displayName, "Chưa phân công")}</span></div><div className={styles.servicePrice}><strong>{formatMoney(price, currency)}</strong><span className={badgeClass(statusTone(item.status))}>{statusLabel(item.status)}</span></div></article>; })}</div> : <div className={styles.empty}>Lịch hẹn chưa có dịch vụ snapshot.</div>}
          <footer className={styles.totalBar}><span>{items.length} dịch vụ</span><span>{duration ? `${duration} phút` : "—"}</span><strong>{formatMoney(amount, currency)}</strong></footer>
        </Card>

        <Card title="Ghi chú khách hàng" icon="file" action={<button type="button" className={styles.textAction} disabled>Chỉnh sửa ghi chú</button>}>
          <div className={styles.noteBox}>{appointment.customerNote ? <p>{appointment.customerNote}</p> : <p className={styles.muted}>Khách hàng chưa để lại ghi chú.</p>}</div><footer className={styles.cardFooter}><span>Dữ liệu snapshot từ lịch hẹn</span><span>{appointment.customerNote ? "Đã có ghi chú" : "Chưa có dữ liệu"}</span></footer>
        </Card>

        <Card title="Lịch sử hoạt động" icon="activity" action={<a className={styles.textAction} href={`/admin/appointments/${id}/history`}>{tab === "history" ? "Đang xem" : "Xem toàn bộ lịch sử"}</a>}>
          <ActivityTimeline history={data.history} />
        </Card>

        <Card title="Lịch sử dịch vụ của khách" icon="file" action={data.customer?.profile?.id ? <a className={styles.textAction} href={`/admin/customers/${data.customer.profile.id}`}>Xem hồ sơ khách</a> : undefined}>
          <ServiceHistory customer={data.customer} timezone={timezone} />
        </Card>
      </div>

      <aside className={styles.sideColumn}>
        <Card title="Khách hàng" icon="customer">
          <div className={styles.profileTop}><span className={styles.avatar}>{initials(contactName)}</span><div><strong>{contactName}</strong><div className={styles.miniBadges}>{data.customer?.profile?.isGuest ? <span>Khách vãng lai</span> : null}{data.customer?.profile?.status === "ACTIVE" ? <span>Đang hoạt động</span> : null}</div></div></div>
          <dl className={styles.definitionList}><div><dt>SĐT</dt><dd>{text(phone)}</dd></div><div><dt>Email</dt><dd>{text(email)}</dd></div><div><dt>Tổng chi tiêu</dt><dd>{formatMoney(data.customer?.activitySummary?.totalSpentMinor, currency)}</dd></div><div><dt>Lần ghé gần nhất</dt><dd>{data.customer?.activitySummary?.lastVisitAt ? dateParts(data.customer.activitySummary.lastVisitAt, timezone).date : "—"}</dd></div></dl>
          <div className={styles.inlineActions}>{data.customer?.profile?.id ? <a href={`/admin/customers/${data.customer.profile.id}`}><Icon name="customer" />Xem hồ sơ</a> : null}{phone ? <a href={`tel:${phone}`}><Icon name="phone" />Liên hệ</a> : email ? <a href={`mailto:${email}`}><Icon name="phone" />Email</a> : null}</div>
        </Card>

        <Card title="Tóm tắt thanh toán" icon="payment">
          <dl className={styles.paymentList}><div><dt>Dịch vụ</dt><dd>{formatMoney(amount, currency)}</dd></div><div><dt>Giảm giá</dt><dd>{formatMoney(discount, currency)}</dd></div><div><dt>Thuế</dt><dd>{formatMoney(tax, currency)}</dd></div><div><dt>Đặt cọc</dt><dd>{deposit != null ? formatMoney(deposit, currency) : "—"}</dd></div><div className={styles.paymentTotal}><dt>Tổng cộng</dt><dd>{formatMoney(amount, currency)}</dd></div></dl><span className={`${styles.paymentStatus} ${paidDeposit ? styles.paymentStatusPaid : ""}`}>{paidDeposit ? "Đã xử lý đặt cọc" : appointment.depositStatus === "NOT_REQUIRED" ? "Không yêu cầu đặt cọc" : "Chưa thanh toán"}</span><button type="button" className={styles.outlineButton} disabled aria-disabled="true"><Icon name="payment" />Xem thanh toán</button></Card>

        <Card title="Kỹ thuật viên" icon="staff">
          <div className={styles.profileTop}><span className={styles.avatar}>{initials(text(primaryStaff?.displayName, "KT"))}</span><div><strong>{text(primaryStaff?.displayName, "Chưa phân công")}</strong><small className={styles.muted}>Thông tin chuyên môn chưa có trong API chi tiết</small></div></div><span className={styles.available}><span />Theo lịch hẹn</span><div className={styles.staffTimeline}><div className={styles.staffTimes}><span>{dateParts(appointment.startAt, timezone).time}</span><span>{dateParts(appointment.endAt, timezone).time}</span></div><div className={styles.staffTrack}><span /></div><small>Phân đoạn của lịch hẹn hiện tại</small></div><button type="button" className={styles.outlineButton} disabled aria-disabled="true"><Icon name="staff" />Xem lịch kỹ thuật viên</button>
        </Card>

        <Card title="Nhắc hẹn & liên lạc" icon="activity">
          <div className={styles.emptyCompact}><Icon name="notification" /><strong>Chưa có dữ liệu gửi email</strong><span>API hiện chưa cung cấp nhật ký nhắc hẹn cho lịch này.</span></div><button type="button" className={styles.outlineButton} disabled aria-disabled="true">Gửi lại xác nhận</button>
        </Card>

        <Card title="Thao tác nhanh" icon="activity"><div className={styles.quickActions}><ActionLink href={`/admin/appointments/${id}/check-in`} icon="customer" variant="primary" disabled={!canCheckIn}>Check-in khách</ActionLink><ActionLink href={`/admin/appointments/${id}/reschedule`} icon="calendar" disabled={!canReschedule}>Đổi lịch</ActionLink><ActionLink href={`/admin/appointments/${id}/add-service`} icon="plus" disabled={terminal}>Thêm dịch vụ</ActionLink><ActionLink href="#edit" icon="edit" disabled>Chỉnh sửa lịch</ActionLink><ActionLink href={`/admin/appointments/${id}/cancel`} icon="close" variant="danger" disabled={!canCancel}>Hủy lịch</ActionLink></div></Card>
      </aside>
    </div>

    <footer className={styles.stickyFooter}><a href="/admin/appointments" className={styles.backLink}><Icon name="arrowLeft" />Quay lại danh sách</a><div><ActionLink href={`/admin/appointments/${id}/reschedule`} icon="calendar" disabled={!canReschedule}>Đổi lịch</ActionLink><ActionLink href="#edit" icon="edit" disabled>Chỉnh sửa</ActionLink><ActionLink href={`/admin/appointments/${id}/check-in`} icon="customer" variant="primary" disabled={!canCheckIn}>Check-in khách</ActionLink></div></footer>
  </main>;
}

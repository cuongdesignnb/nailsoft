/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { currencyMinorUnit } from "@nailsoft/domain-types";
import { authorizedFetch } from "../auth";
import styles from "./appointment-check-in.module.css";

type ViewState = "loading" | "ready" | "error" | "forbidden" | "offline";
type WorkspaceState =
  | "LOADING"
  | "AWAITING_ARRIVAL"
  | "ARRIVED"
  | "READY_TO_CHECK_IN"
  | "CHECKING_IN"
  | "CHECKED_IN"
  | "FORBIDDEN"
  | "CONFLICT"
  | "ERROR";

const CHECK_IN_ELIGIBLE = new Set(["CONFIRMED"]);

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

function list(value: any): any[] {
  const data = value?.data ?? value;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return data ? [data] : [];
}

async function read(path: string, optional = false) {
  const response = await authorizedFetch(path);
  const body = await response.json().catch(() => ({}));
  if (optional && response.status === 404) return null;
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error("Bạn không có quyền truy cập dữ liệu này."), {
      forbidden: true,
      code: body?.error?.code,
    });
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
    throw Object.assign(new Error("Bạn không có quyền thực hiện Check-in."), {
      forbidden: true,
      code: body?.error?.code,
    });
  }
  if (!response.ok) {
    throw Object.assign(new Error(body?.error?.message ?? "Không thể thực hiện thao tác."), {
      code: body?.error?.code,
      status: response.status,
    });
  }
  return body?.data ?? body;
}

function text(value: unknown, fallback = "—") {
  return value == null || value === "" ? fallback : String(value);
}

function serviceLabel(service: any) {
  if (!service) return "Dịch vụ";
  if (typeof service === "string") return service;
  const name = service.name;
  if (typeof name === "string") return name;
  if (name && typeof name === "object") return name["vi-VN"] ?? name.vi ?? name.en ?? Object.values(name)[0] ?? service.code ?? "Dịch vụ";
  return service.displayName ?? service.code ?? "Dịch vụ";
}

function initials(value: unknown) {
  return String(value ?? "?").trim().split(/\s+/).slice(-2).map((part) => part.slice(0, 1)).join("").toUpperCase() || "?";
}

function currency(value: unknown, code = "VND") {
  if (value === null || value === undefined || value === "") return "—";
  const minor = currencyMinorUnit(code);
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: code, maximumFractionDigits: minor }).format(Number(value) / 10 ** minor);
}

function timeLabel(value: string | undefined, timezone: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", { timeZone: timezone || "UTC", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function dateLabel(value: string | undefined, timezone: string, weekday = false) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: timezone || "UTC",
    weekday: weekday ? "long" : undefined,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function localDateKey(value: string | undefined, timezone: string) {
  if (!value) return undefined;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function durationMinutes(start: string | undefined, end: string | undefined) {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000));
}

function arrivalDelta(start: string | undefined, arrived: string | undefined) {
  if (!start || !arrived) return null;
  return Math.round((new Date(arrived).getTime() - new Date(start).getTime()) / 60_000);
}

function deltaLabel(delta: number | null) {
  if (delta === null) return "Chưa ghi nhận";
  if (delta < 0) return `Đến sớm ${Math.abs(delta)} phút`;
  if (delta === 0) return "Đúng giờ";
  return `Trễ ${delta} phút`;
}

function deltaTone(delta: number | null) {
  if (delta === null || delta <= 0) return "success";
  return delta <= 10 ? "warning" : "late";
}

function sourceLabel(source: unknown) {
  const labels: Record<string, string> = { RECEPTION: "Lễ tân", FACEBOOK: "Facebook", WEBSITE: "Website", PHONE: "Điện thoại", WALK_IN: "Walk-in", MOBILE: "Ứng dụng" };
  return labels[String(source)] ?? text(source);
}

function statusLabel(status: unknown) {
  return STATUS_LABELS[String(status)] ?? text(status);
}

function errorText(cause: any) {
  switch (cause?.code) {
    case "APPOINTMENT_VERSION_CONFLICT":
    case "BOOKING_VERSION_CONFLICT":
    case "VERSION_CONFLICT":
      return "Lịch hẹn vừa được cập nhật bởi người khác. Dữ liệu mới nhất đã được tải lại; vui lòng kiểm tra trước khi tiếp tục Check-in.";
    case "APPOINTMENT_ALREADY_ARRIVED":
      return "Khách đã được ghi nhận đến trước đó. Dữ liệu arrival mới nhất đã được tải lại.";
    case "APPOINTMENT_ALREADY_CHECKED_IN":
      return "Lịch hẹn đã Check-in trước đó. Dữ liệu mới nhất đã được tải lại.";
    case "APPOINTMENT_CHECK_IN_NOT_ALLOWED":
      return "Trạng thái lịch hẹn hiện tại không cho phép thao tác này.";
    case "APPOINTMENT_DEPOSIT_BLOCKS_CHECK_IN":
      return "Lịch hẹn còn khoản đặt cọc bắt buộc nên chưa thể Check-in.";
    case "APPOINTMENT_LATE_OVERRIDE_REQUIRED":
      return "Khách đến trễ quá chính sách. Cần lý do override của quản lý để tiếp tục.";
    default:
      return cause?.message ?? "Không thể hoàn tất thao tác.";
  }
}

function Card({ title, children, className = "", action }: { title: string; children: ReactNode; className?: string | undefined; action?: ReactNode | undefined }) {
  return <section className={`${styles.card} ${className}`}><div className={styles.cardHeading}><h2>{title}</h2>{action}</div>{children}</section>;
}

function StateBox({ state, error, retry }: { state: ViewState; error?: string; retry: () => void }) {
  if (state === "loading") return <div className={`${styles.stateBox} ${styles.loading}`} role="status" aria-busy="true"><span className={styles.spinner} />Đang tải dữ liệu Check-in…</div>;
  if (state === "forbidden") return <div className={`${styles.stateBox} ${styles.danger}`} role="alert"><strong>Bạn không có quyền Check-in lịch hẹn này.</strong><button type="button" onClick={retry}>Thử lại</button></div>;
  if (state === "offline") return <div className={`${styles.stateBox} ${styles.danger}`} role="alert"><strong>Cần kết nối Internet để Check-in khách.</strong><button type="button" onClick={retry}>Thử lại</button></div>;
  if (state === "error") return <div className={`${styles.stateBox} ${styles.danger}`} role="alert"><strong>Không thể tải lịch hẹn.</strong><span>{error ?? "Có lỗi xảy ra khi gọi API."}</span><button type="button" onClick={retry}>Thử lại</button></div>;
  return null;
}

function Avatar({ name, size = "normal" }: { name: unknown; size?: "normal" | "small" }) {
  return <span className={`${styles.avatar} ${size === "small" ? styles.avatarSmall : ""}`} aria-hidden="true">{initials(name)}</span>;
}

function InfoCell({ label, value, tone = "" }: { label: string; value: ReactNode; tone?: string }) {
  return <div className={styles.infoCell}><span>{label}</span><strong className={tone ? styles[tone as keyof typeof styles] : undefined}>{value}</strong></div>;
}

function AppointmentSummary({ appointment, branch, timezone }: { appointment: any; branch: any; timezone: string }) {
  const customerName = appointment.contact?.displayName;
  const staff = appointment.items?.[0]?.staff?.displayName;
  const duration = durationMinutes(appointment.startAt, appointment.endAt);
  return <Card title="Thông tin lịch hẹn" className={styles.summaryCard} action={<span className={`${styles.badge} ${styles.badgeStatus}`}>{statusLabel(appointment.status)}</span>}>
    <div className={styles.summaryTop}><Avatar name={customerName} /><div className={styles.customerHero}><h3>{text(customerName, "Khách hàng")}</h3><p>{text(appointment.contact?.phone)}</p><div className={styles.tagRow}>{appointment.contact?.tags?.map((tag: any) => <span className={styles.tag} key={String(tag.id ?? tag.name ?? tag)}>{text(tag.name ?? tag)}</span>)}</div></div><div className={styles.reference}><span>Mã lịch hẹn</span><strong>#{text(appointment.bookingReference)}</strong></div></div>
    <div className={styles.infoGrid}><InfoCell label="Ngày" value={dateLabel(appointment.startAt, timezone, true)} /><InfoCell label="Thời gian" value={`${timeLabel(appointment.startAt, timezone)} – ${timeLabel(appointment.endAt, timezone)}`} /><InfoCell label="Thời lượng" value={`${duration} phút`} /><InfoCell label="Chi nhánh" value={text(branch?.name, appointment.branchId)} /><InfoCell label="Kỹ thuật viên" value={text(staff, "Chưa phân công")} /><InfoCell label="Nguồn đặt" value={sourceLabel(appointment.source)} /></div>
  </Card>;
}

function ArrivalStatusBanner({ appointment, arrival, timezone }: { appointment: any; arrival: any; timezone: string }) {
  const delta = arrivalDelta(appointment.startAt, arrival?.arrivedAt);
  return <div className={`${styles.arrivalBanner} ${styles[`arrival${deltaTone(delta)}`]}`} role="status" aria-live="polite"><span className={styles.statusIcon}>✓</span><div><strong>Khách đã đến salon</strong><span>Lịch hẹn lúc {timeLabel(appointment.startAt, timezone)} · Khách đến lúc {timeLabel(arrival?.arrivedAt, timezone)}</span></div><span className={styles.arrivalPill}>{deltaLabel(delta)}</span></div>;
}

function AwaitingArrivalBanner({ appointment, timezone }: { appointment: any; timezone: string }) {
  return <div className={`${styles.arrivalBanner} ${styles.arrivalPending}`} role="status" aria-live="polite"><span className={styles.statusIcon}>○</span><div><strong>Chưa ghi nhận khách đến</strong><span>Lịch hẹn lúc {timeLabel(appointment.startAt, timezone)} · Chỉ Check-in sau khi lễ tân xác nhận khách đã đến.</span></div></div>;
}

function ArrivalConfirmationCard({ appointment, arrival, timezone, note, setNote, saving, onArrive }: { appointment: any; arrival: any; timezone: string; note: string; setNote: (value: string) => void; saving: boolean; onArrive: () => void }) {
  const hasArrival = Boolean(arrival?.arrivedAt);
  return <Card title="Xác nhận khách đến" className={styles.arrivalCard}>
    <div className={styles.timePair}><div><span>Giờ hẹn</span><strong>{timeLabel(appointment.startAt, timezone)}</strong></div><div><span>Giờ khách đến</span><strong>{hasArrival ? timeLabel(arrival.arrivedAt, timezone) : "Chưa ghi nhận"}</strong></div></div>
    <div className={styles.segmented} role="group" aria-label="Trạng thái khách đến"><button type="button" className={hasArrival ? styles.segmentActive : ""} disabled={saving || hasArrival || appointment.status !== "CONFIRMED"} onClick={onArrive}>✓ Đã đến</button><button type="button" className={styles.segmentWaiting} disabled title="Hệ thống chưa có transition chờ riêng">○ Khách đang chờ</button></div>
    {!hasArrival ? <label className={styles.noteField}><span>Ghi chú khi khách đến <em>(tuỳ chọn)</em></span><textarea value={note} maxLength={500} rows={3} placeholder="Nhập ghi chú phát sinh khi khách đến salon..." onChange={(event) => setNote(event.target.value)} /><small>{note.length}/500 · Ghi chú sẽ được lưu cùng arrival.</small></label> : <p className={styles.helperText}>Arrival timestamp do máy chủ ghi nhận và hiển thị theo múi giờ chi nhánh. {arrival.note ? `Ghi chú: ${arrival.note}` : "Chưa có ghi chú arrival."}</p>}
    {!hasArrival ? <button type="button" className={`${styles.button} ${styles.primaryButton}`} disabled={saving || appointment.status !== "CONFIRMED"} onClick={onArrive}>{saving ? "Đang ghi nhận…" : "Ghi nhận khách đã đến"}</button> : null}
  </Card>;
}

function CustomerIdentityCard({ appointment, confirmed, setConfirmed }: { appointment: any; confirmed: boolean; setConfirmed: (value: boolean) => void }) {
  const name = appointment.contact?.displayName;
  return <Card title="Xác nhận khách hàng" className={styles.identityCard}><div className={styles.identityRow}><Avatar name={name} /><div><h3>{text(name, "Khách hàng")}</h3><p>{text(appointment.contact?.phone)}</p></div></div><label className={styles.checkboxRow}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>Đã xác nhận đúng khách hàng</span></label><div className={styles.cardActions}><a className={styles.outlineButton} href={appointment.customerId ? `/admin/customers/${appointment.customerId}` : undefined} aria-disabled={!appointment.customerId}>Xem hồ sơ khách</a><span className={styles.mutedAction}>Khách đến thay người? <small>Chưa hỗ trợ</small></span></div></Card>;
}

function itemDuration(item: any, appointment: any) {
  return durationMinutes(item.serviceStartAt, item.serviceEndAt) || durationMinutes(appointment.startAt, appointment.endAt);
}

function TodayServicesCard({ appointment }: { appointment: any }) {
  const items = appointment.items ?? [];
  const total = items.reduce((sum: number, item: any) => sum + Number(item.price?.amountMinor ?? 0), 0);
  const currencyCode = items.find((item: any) => item.price?.currency)?.price?.currency ?? appointment.pricingSummary?.currency ?? "VND";
  return <Card title="Dịch vụ hôm nay" className={styles.servicesCard} action={<a className={styles.linkAction} href={`/admin/appointments/${appointment.id}/add-service`}>+ Thêm dịch vụ</a>}><div className={styles.serviceList}>{items.length ? items.map((item: any) => <div className={styles.serviceRow} key={item.id}><span className={`${styles.serviceDot} ${item.sequenceNo % 2 ? styles.dotRose : styles.dotLilac}`}>•</span><div className={styles.serviceMain}><strong>{serviceLabel(item.service)}</strong><small>{text(item.service?.description, "Theo snapshot dịch vụ của lịch hẹn")}</small></div><span>{itemDuration(item, appointment)} phút</span><strong>{item.price ? currency(item.price.amountMinor, item.price.currency ?? currencyCode) : "—"}</strong><span className={`${styles.badge} ${styles.badgeNeutral}`}>{statusLabel(item.status)}</span></div>) : <p className={styles.emptyText}>Lịch hẹn chưa có dịch vụ.</p>}</div><div className={styles.totalLine}><strong>{items.length} dịch vụ</strong><span>{items.reduce((sum: number, item: any) => sum + itemDuration(item, appointment), 0)} phút</span><strong>{items.length ? currency(total, currencyCode) : "—"}</strong></div></Card>;
}

function TechnicianReadinessCard({ appointment }: { appointment: any }) {
  const staff = appointment.items?.[0]?.staff;
  return <Card title="Kỹ thuật viên phụ trách" className={styles.staffCard}><div className={styles.staffHero}><Avatar name={staff?.displayName} size="small" /><div><strong>{text(staff?.displayName, "Chưa phân công")}</strong><span>{appointment.items?.length ? "Theo phân công trong lịch hẹn" : "Chưa có dữ liệu phân công"}</span></div><span className={`${styles.badge} ${styles.badgeNeutral}`}>Chưa xác định</span></div><div className={styles.staffFacts}><InfoCell label="Ca làm hôm nay" value="Chưa có dữ liệu" /><InfoCell label="Lịch hiện tại" value={`${timeLabel(appointment.startAt, "UTC")} – ${timeLabel(appointment.endAt, "UTC")}`} /><InfoCell label="Trạng thái" value="Chưa xác định" /></div><p className={styles.helperText}>Chưa có read model ca làm/chấm công đủ để kết luận kỹ thuật viên đang sẵn sàng. Check-in vẫn do backend quyết định.</p></Card>;
}

function ServiceReadinessCard({ appointment, arrival }: { appointment: any; arrival: any }) {
  const items = appointment.items ?? [];
  const rows = [
    { label: "Khách đã đến", state: arrival?.arrivedAt ? "READY" : "WAIT" },
    { label: "Kỹ thuật viên", state: "UNKNOWN" },
    { label: "Ghế / khu vực", state: items.some((item: any) => (item.resources ?? []).length) ? "ALLOCATED" : "NONE" },
    { label: "Dịch vụ đã xác nhận", state: items.length && items.every((item: any) => item.status !== "CANCELLED") ? "READY" : "UNKNOWN" },
  ];
  return <Card title="Tình trạng phục vụ" className={styles.readinessCard}><div className={styles.readinessList}>{rows.map((row) => <div className={styles.readinessRow} key={row.label}><span className={`${styles.readinessIcon} ${styles[`readiness${row.state}`]}`}>{row.state === "READY" || row.state === "ALLOCATED" ? "✓" : row.state === "WAIT" ? "!" : "–"}</span><span>{row.label}</span><strong>{row.state === "READY" ? "Sẵn sàng" : row.state === "ALLOCATED" ? "Đã phân bổ" : row.state === "NONE" ? "Không yêu cầu khu vực riêng" : row.state === "WAIT" ? "Đang chờ" : "Chưa xác định"}</strong></div>)}</div></Card>;
}

function CustomerRequestsCard({ appointment }: { appointment: any }) {
  const note = appointment.customerNote;
  return <Card title="Yêu cầu của khách" className={styles.requestCard}>{note ? <p className={styles.noteQuote}>{note}</p> : <p className={styles.emptyText}>Chưa có yêu cầu hoặc ghi chú khách hàng trong dữ liệu lịch hẹn.</p>}</Card>;
}

function CustomerSideCard({ appointment, customer, customerError }: { appointment: any; customer: any; customerError: string }) {
  const profile = customer?.profile;
  const contact = customer?.contact;
  const activity = customer?.activitySummary;
  const name = profile?.displayName ?? appointment.contact?.displayName;
  return <Card title="Khách hàng" className={styles.sideCard}><div className={styles.identityRow}><Avatar name={name} size="small" /><div><h3>{text(name)}</h3><span className={styles.tagRow}><span className={styles.tag}>Khách đặt lịch</span></span></div></div>{customerError ? <p className={styles.sideError}>{customerError}</p> : <dl className={styles.sideList}><div><dt>SĐT</dt><dd>{text(contact?.phone ?? appointment.contact?.phone)}</dd></div><div><dt>Email</dt><dd>{text(contact?.email ?? appointment.contact?.email)}</dd></div><div><dt>Số lịch hẹn</dt><dd>{activity?.appointmentCount ?? "—"}</dd></div><div><dt>Lần ghé gần nhất</dt><dd>{activity?.lastVisitAt ? dateLabel(activity.lastVisitAt, "UTC") : "—"}</dd></div></dl>}<div className={styles.cardActions}><a className={styles.outlineButton} href={appointment.customerId ? `/admin/customers/${appointment.customerId}` : undefined} aria-disabled={!appointment.customerId}>Xem hồ sơ</a><a className={styles.outlineButton} href={`tel:${appointment.contact?.phone ?? ""}`}>Liên hệ</a></div></Card>;
}

function ServiceSummaryCard({ appointment, arrival, timezone }: { appointment: any; arrival: any; timezone: string }) {
  const items = appointment.items ?? [];
  return <Card title="Tóm tắt phục vụ" className={styles.sideCard}><dl className={styles.sideList}><div><dt>Dịch vụ</dt><dd>{items.length || "—"} dịch vụ</dd></div><div><dt>Thời lượng</dt><dd>{durationMinutes(appointment.startAt, appointment.endAt)} phút</dd></div><div><dt>Kỹ thuật viên</dt><dd>{text(items[0]?.staff?.displayName, "Chưa phân công")}</dd></div><div><dt>Bắt đầu dự kiến</dt><dd>{timeLabel(appointment.startAt, timezone)}</dd></div><div><dt>Kết thúc dự kiến</dt><dd>{timeLabel(appointment.endAt, timezone)}</dd></div></dl>{arrival?.arrivedAt ? <div className={styles.sideSuccess}>Khách đã đến <strong>{timeLabel(arrival.arrivedAt, timezone)}</strong></div> : null}</Card>;
}

function QueueCard({ board, appointmentId, timezone }: { board: any; appointmentId: string; timezone: string }) {
  const columns = board?.columns ?? {};
  const entries = Object.values(columns).flatMap((value: any) => Array.isArray(value) ? value : []) as any[];
  const current = entries.find((item) => item.id === appointmentId);
  const rows = entries.filter((item) => item.id !== appointmentId).sort((a, b) => new Date(a.startAt ?? 0).getTime() - new Date(b.startAt ?? 0).getTime()).slice(0, 2);
  const waitingCount = (columns.WAITING?.length ?? 0) + (board?.walkIns?.length ?? 0);
  const inServiceCount = columns.IN_SERVICE?.length ?? 0;
  return <Card title="Hàng đợi hiện tại" className={styles.sideCard} action={<a className={styles.linkAction} href="/admin/operations/board">Xem bảng vận hành</a>}><div className={styles.queueKpis}><div><strong>{waitingCount}</strong><span>khách đang chờ</span></div><div><strong>{inServiceCount}</strong><span>khách đang phục vụ</span></div></div><div className={styles.queueList}>{rows.map((item) => <div className={styles.queueRow} key={item.id}><span>{timeLabel(item.startAt, timezone)}</span><strong>{text(item.customerDisplayName)}</strong><small>{statusLabel(item.status)}</small></div>)}{current ? <div className={`${styles.queueRow} ${styles.queueCurrent}`}><span>{current.arrivedAt ? timeLabel(current.arrivedAt, timezone) : timeLabel(current.startAt, timezone)}</span><strong>{text(current.customerDisplayName)}</strong><small>{current.status === "CHECKED_IN" ? "Đã check-in" : "Đã đến"}</small></div> : null}{!rows.length && !current ? <p className={styles.emptyText}>Chưa tải được dữ liệu hàng đợi.</p> : null}</div></Card>;
}

function PaymentCard({ checkout, appointment }: { checkout: any; appointment: any }) {
  const summary = appointment.pricingSummary;
  const currencyCode = checkout?.pricingPreview?.currency ?? summary?.currency ?? "VND";
  const subtotal = checkout?.pricingPreview?.subtotalMinor ?? summary?.subtotalMinor ?? summary?.amountMinor;
  return <Card title="Thanh toán" className={styles.sideCard}><dl className={styles.sideList}><div><dt>Tạm tính</dt><dd>{subtotal == null ? "—" : currency(subtotal, currencyCode)}</dd></div><div><dt>Đặt cọc</dt><dd>{appointment.depositRequiredMinor == null ? "—" : currency(appointment.depositRequiredMinor, currencyCode)}</dd></div><div><dt>Còn lại</dt><dd>{subtotal == null ? "—" : currency(Math.max(0, Number(subtotal) - Number(appointment.depositRequiredMinor ?? 0)), currencyCode)}</dd></div></dl><span className={styles.paymentNote}>Check-in không thu tiền. Payment chỉ hiển thị thông tin.</span></Card>;
}

function CommunicationCard({ history, historyError }: { history: any[]; historyError: string }) {
  return <Card title="Thông báo lịch hẹn" className={styles.sideCard}>{historyError ? <p className={styles.sideError}>{historyError}</p> : <div className={styles.timeline}>{history.slice(-4).reverse().map((item: any, index: number) => <div className={styles.timelineRow} key={item.id ?? `${item.createdAt}-${index}`}><span className={styles.timelineDot} /><div><strong>{item.toStatus ? `Lịch hẹn: ${statusLabel(item.toStatus)}` : text(item.action, "Hoạt động lịch hẹn")}</strong><span>{item.createdAt ? dateLabel(item.createdAt, "UTC") : "—"}</span></div></div>)}{!history.length ? <p className={styles.emptyText}>Chưa có lịch sử thông báo.</p> : null}</div>}</Card>;
}

function CheckInConfirmationCard({ identityConfirmed, serviceConfirmed, setIdentityConfirmed, setServiceConfirmed, canConfirm, saving, error, onConfirm }: { identityConfirmed: boolean; serviceConfirmed: boolean; setIdentityConfirmed: (value: boolean) => void; setServiceConfirmed: (value: boolean) => void; canConfirm: boolean; saving: boolean; error: string; onConfirm: () => void }) {
  return <Card title="Xác nhận Check-in" className={styles.confirmCard}><label className={styles.checkboxRow}><input type="checkbox" checked={identityConfirmed} onChange={(event) => setIdentityConfirmed(event.target.checked)} /><span>Tôi đã xác nhận đúng khách hàng và lịch hẹn.</span></label><label className={styles.checkboxRow}><input type="checkbox" checked={serviceConfirmed} onChange={(event) => setServiceConfirmed(event.target.checked)} /><span>Thông tin dịch vụ và kỹ thuật viên đã chính xác.</span></label>{error ? <div className={styles.inlineError} role="alert">{error}</div> : null}<button type="button" className={`${styles.button} ${styles.primaryButton}`} disabled={!canConfirm || saving} onClick={onConfirm}>{saving ? "Đang Check-in…" : "Xác nhận Check-in khách"}</button></Card>;
}

function SuccessCard({ appointment, sessions }: { appointment: any; sessions: any[] }) {
  const firstPending = sessions.find((session) => session.status === "PENDING");
  return <Card title="Check-in thành công" className={styles.successCard}><span className={styles.successMark}>✓</span><p><strong>{text(appointment.contact?.displayName, "Khách hàng")}</strong> đã được đưa vào quy trình phục vụ.</p><p className={styles.helperText}>Service session đã được backend tạo theo từng dịch vụ; chưa tự động bắt đầu dịch vụ.</p><div className={styles.successActions}><a className={styles.buttonSecondary} href="/admin/operations/board">Mở bảng vận hành</a>{firstPending ? <a className={styles.button} href={`/admin/service-sessions/${firstPending.id}`}>Bắt đầu dịch vụ</a> : <span className={styles.disabledLink}>Chưa có session chờ</span>}</div></Card>;
}

function StickyFooter({ appointment, checkedIn, canConfirm, saving, onConfirm }: { appointment: any; checkedIn: boolean; canConfirm: boolean; saving: boolean; onConfirm: () => void }) {
  return <div className={styles.stickyFooter}><a className={styles.buttonSecondary} href={`/admin/appointments/${appointment.id}/overview`}>← Quay lại chi tiết lịch hẹn</a><div className={styles.footerActions}>{checkedIn ? <a className={styles.buttonSecondary} href="/admin/operations/board">Mở bảng vận hành</a> : <a className={styles.buttonSecondary} href={`/admin/appointments/${appointment.id}/overview`}>Khách chưa đến</a>}{!checkedIn ? <button type="button" className={`${styles.button} ${styles.primaryButton}`} disabled={!canConfirm || saving} onClick={onConfirm}>{saving ? "Đang Check-in…" : "Xác nhận Check-in"}</button> : null}</div></div>;
}

export default function AppointmentCheckInPage({ appointmentId }: { appointmentId: string }) {
  const [appointment, setAppointment] = useState<any>();
  const [arrival, setArrival] = useState<any>();
  const [branch, setBranch] = useState<any>();
  const [customer, setCustomer] = useState<any>();
  const [board, setBoard] = useState<any>();
  const [checkout, setCheckout] = useState<any>();
  const [sessions, setSessions] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [pageState, setPageState] = useState<ViewState>("loading");
  const [pageError, setPageError] = useState("");
  const [customerError, setCustomerError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [note, setNote] = useState("");
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [serviceConfirmed, setServiceConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const arrivalIntentKey = useRef<string | undefined>(undefined);
  const checkInIntentKey = useRef<string | undefined>(undefined);

  const load = useCallback(async () => {
    setPageState("loading");
    setPageError("");
    setCustomerError("");
    setHistoryError("");
    try {
      const detail = await read(`/v1/appointments/${encodeURIComponent(appointmentId)}`);
      setAppointment(detail);
      const optional = await Promise.allSettled([
        read(`/v1/appointments/${encodeURIComponent(appointmentId)}/arrival`, true),
        read(`/v1/branches/${encodeURIComponent(detail.branchId)}`),
        detail.customerId ? read(`/v1/customers/${encodeURIComponent(detail.customerId)}`) : Promise.resolve(null),
        read(`/v1/appointments/${encodeURIComponent(appointmentId)}/history`),
        read(`/v1/service-sessions?appointmentId=${encodeURIComponent(appointmentId)}`),
        read(`/v1/appointments/${encodeURIComponent(appointmentId)}/checkout-summary`),
      ]);
      const [arrivalResult, branchResult, customerResult, historyResult, sessionResult, checkoutResult] = optional;
      if (arrivalResult.status === "fulfilled") { setArrival(arrivalResult.value); if (arrivalResult.value?.note) setNote(arrivalResult.value.note); }
      if (branchResult.status === "fulfilled") setBranch(branchResult.value);
      if (customerResult.status === "fulfilled") setCustomer(customerResult.value); else if (detail.customerId) setCustomerError("Thông tin khách hàng bị giới hạn hoặc chưa tải được.");
      if (historyResult.status === "fulfilled") setHistory(list(historyResult.value)); else setHistoryError("Không thể tải lịch sử hoạt động.");
      if (sessionResult.status === "fulfilled") setSessions(list(sessionResult.value));
      if (checkoutResult.status === "fulfilled") setCheckout(checkoutResult.value);
      const resolvedBranch = branchResult.status === "fulfilled" ? branchResult.value : undefined;
      const timezone = resolvedBranch?.timezone ?? "UTC";
      const date = localDateKey(detail.startAt, timezone);
      if (detail.branchId && date) {
        const boardResult = await Promise.allSettled([read(`/v1/operations/board?branchId=${encodeURIComponent(detail.branchId)}&date=${encodeURIComponent(date)}`)]);
        if (boardResult[0]?.status === "fulfilled") setBoard(boardResult[0].value);
      }
      setPageState("ready");
    } catch (cause: any) {
      setPageError(cause?.message ?? "Không thể tải lịch hẹn.");
      setPageState(cause?.forbidden ? "forbidden" : typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
    }
  }, [appointmentId]);

  useEffect(() => { void load(); }, [load]);

  const timezone = branch?.timezone ?? "UTC";
  const checkedIn = appointment?.status === "CHECKED_IN";
  const arrivalRecorded = Boolean(arrival?.arrivedAt);
  const workspaceState: WorkspaceState = pageState === "loading" ? "LOADING" : checkedIn ? "CHECKED_IN" : arrivalRecorded && identityConfirmed && serviceConfirmed ? "READY_TO_CHECK_IN" : arrivalRecorded ? "ARRIVED" : "AWAITING_ARRIVAL";
  const canArrive = appointment?.status === "CONFIRMED" && !arrivalRecorded;
  const canConfirm = Boolean(appointment && arrivalRecorded && identityConfirmed && serviceConfirmed && CHECK_IN_ELIGIBLE.has(appointment.status) && !saving);

  const arrive = async () => {
    if (!appointment || !canArrive || saving) return;
    setSaving(true);
    setActionError("");
    const key = arrivalIntentKey.current ?? crypto.randomUUID();
    arrivalIntentKey.current = key;
    try {
      await post(`/v1/appointments/${encodeURIComponent(appointmentId)}/arrive`, { arrivalMethod: "RECEPTION", partySize: 1, ...(note.trim() ? { note: note.trim() } : {}) }, key);
      arrivalIntentKey.current = undefined;
      setNotice("Đã ghi nhận khách đến salon. Bạn có thể kiểm tra thông tin trước khi Check-in.");
      await load();
    } catch (cause: any) {
      if (cause?.code === "APPOINTMENT_ALREADY_ARRIVED") { setNotice(errorText(cause)); await load(); } else setActionError(errorText(cause));
    } finally { setSaving(false); }
  };

  const checkIn = async () => {
    if (!appointment || !canConfirm || saving) return;
    setSaving(true);
    setActionError("");
    const key = checkInIntentKey.current ?? crypto.randomUUID();
    checkInIntentKey.current = key;
    try {
      await post(`/v1/appointments/${encodeURIComponent(appointmentId)}/check-in`, { version: appointment.version }, key);
      checkInIntentKey.current = undefined;
      setNotice("Check-in thành công. Service session đã được tạo theo dữ liệu lịch hẹn.");
      await load();
    } catch (cause: any) {
      if (["APPOINTMENT_VERSION_CONFLICT", "BOOKING_VERSION_CONFLICT", "VERSION_CONFLICT"].includes(cause?.code)) { setActionError(errorText(cause)); await load(); } else if (cause?.code === "APPOINTMENT_ALREADY_CHECKED_IN") { setNotice(errorText(cause)); await load(); } else setActionError(errorText(cause));
    } finally { setSaving(false); }
  };

  if (pageState !== "ready") return <div className={styles.page}><div className={styles.pageInner}><div className={styles.skeletonHeader}><span /><span /><span /></div><StateBox state={pageState} error={pageError} retry={() => void load()} /></div></div>;
  if (!appointment) return null;

  return <div className={styles.page} data-testid="appointment-check-in-page">
    <div className={styles.pageInner}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb"><a href="/admin/appointments">Lịch hẹn</a><span>/</span><strong>#{text(appointment.bookingReference)} / Check-in</strong></nav>
      <header className={styles.pageHeader}><div><h1>Check-in khách</h1><p>Xác nhận khách đã đến salon và chuẩn bị chuyển lịch hẹn sang quy trình phục vụ.</p></div><div className={styles.headerActions}><a className={styles.buttonSecondary} href={`/admin/appointments/${appointmentId}/overview`}>← Quay lại chi tiết</a>{!checkedIn ? <button type="button" className={`${styles.button} ${styles.primaryButton}`} disabled={!canConfirm} onClick={checkIn}>Xác nhận Check-in</button> : null}</div></header>
      {actionError ? <div className={styles.actionError} role="alert">{actionError}</div> : null}
      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
      {arrivalRecorded ? <ArrivalStatusBanner appointment={appointment} arrival={arrival} timezone={timezone} /> : <AwaitingArrivalBanner appointment={appointment} timezone={timezone} />}
      <div className={styles.layout} data-workspace-state={workspaceState}>
        <main className={styles.mainColumn}>
          <AppointmentSummary appointment={appointment} branch={branch} timezone={timezone} />
          {!checkedIn ? <div className={styles.twoColumn}><ArrivalConfirmationCard appointment={appointment} arrival={arrival} timezone={timezone} note={note} setNote={setNote} saving={saving} onArrive={() => void arrive()} /><CustomerIdentityCard appointment={appointment} confirmed={identityConfirmed} setConfirmed={setIdentityConfirmed} /></div> : null}
          <TodayServicesCard appointment={appointment} />
          <div className={styles.twoColumn}><TechnicianReadinessCard appointment={appointment} /><ServiceReadinessCard appointment={appointment} arrival={arrival} /></div>
          <div className={styles.twoColumn}><CustomerRequestsCard appointment={appointment} /><Card title="Ghi chú khi khách đến" className={styles.notePreview}>{arrival?.note ? <p className={styles.noteQuote}>{arrival.note}</p> : <p className={styles.emptyText}>Chưa có ghi chú arrival.</p>}<small>Ghi chú này được lưu cùng arrival và có thể được dùng khi điều phối phục vụ.</small></Card></div>
          {!checkedIn ? <CheckInConfirmationCard identityConfirmed={identityConfirmed} serviceConfirmed={serviceConfirmed} setIdentityConfirmed={setIdentityConfirmed} setServiceConfirmed={setServiceConfirmed} canConfirm={canConfirm} saving={saving} error={actionError} onConfirm={() => void checkIn()} /> : <SuccessCard appointment={appointment} sessions={sessions} />}
        </main>
        <aside className={styles.sideColumn}>
          <CustomerSideCard appointment={appointment} customer={customer} customerError={customerError} />
          <ServiceSummaryCard appointment={appointment} arrival={arrival} timezone={timezone} />
          <QueueCard board={board} appointmentId={appointmentId} timezone={timezone} />
          <PaymentCard checkout={checkout} appointment={appointment} />
          <CommunicationCard history={history} historyError={historyError} />
          {checkedIn ? <SuccessCard appointment={appointment} sessions={sessions} /> : null}
        </aside>
      </div>
      <StickyFooter appointment={appointment} checkedIn={checkedIn} canConfirm={canConfirm} saving={saving} onConfirm={() => void checkIn()} />
    </div>
  </div>;
}

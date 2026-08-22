/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { currencyMinorUnit } from "@nailsoft/domain-types";
import { authorizedFetch } from "../auth";
import styles from "./service-session-page.module.css";

type LoadState = "loading" | "ready" | "error" | "forbidden" | "offline";
type Modal = "pause" | "transfer" | "complete" | null;

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Chờ thực hiện",
  IN_PROGRESS: "Đang thực hiện",
  PAUSED: "Tạm dừng",
  COMPLETED: "Hoàn thành",
  CANCELLED: "Đã hủy",
};

const STATUS_TONES: Record<string, string> = {
  PENDING: "neutral",
  IN_PROGRESS: "live",
  PAUSED: "warning",
  COMPLETED: "success",
  CANCELLED: "danger",
};

const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  CONFIRMED: "Đã xác nhận",
  CHECKED_IN: "Đã check-in",
  IN_SERVICE: "Đang phục vụ",
  PARTIALLY_COMPLETED: "Đang hoàn thiện",
  COMPLETED: "Hoàn thành",
  CHECKED_OUT: "Đã thanh toán",
  PAID: "Đã thanh toán",
  CANCELLED_BY_CUSTOMER: "Khách đã hủy",
  CANCELLED_BY_SALON: "Salon đã hủy",
  NO_SHOW: "Khách không đến",
};

const REASON_LABELS: Record<string, string> = {
  CUSTOMER_BREAK: "Khách cần nghỉ",
  TECHNICIAN_BREAK: "Kỹ thuật viên tạm rời",
  WAITING_MATERIAL: "Chờ vật tư",
  CUSTOMER_CONFIRMATION: "Chờ khách xác nhận",
  CUSTOMER_REQUEST: "Theo yêu cầu khách hàng",
  SHIFT_CHANGE: "Đổi ca",
  STAFF_UNAVAILABLE: "Kỹ thuật viên không khả dụng",
  REALLOCATION: "Điều phối lại",
  DETERMINISTIC_SEED: "Khởi tạo dữ liệu",
};

const PAUSE_REASONS = [
  ["CUSTOMER_BREAK", "Khách cần nghỉ"],
  ["TECHNICIAN_BREAK", "Kỹ thuật viên tạm rời"],
  ["WAITING_MATERIAL", "Chờ vật tư"],
  ["CUSTOMER_CONFIRMATION", "Chờ khách xác nhận"],
  ["OTHER", "Khác"],
] as const;

const TRANSFER_REASONS = [
  ["CUSTOMER_REQUEST", "Theo yêu cầu khách hàng"],
  ["SHIFT_CHANGE", "Đổi ca"],
  ["STAFF_UNAVAILABLE", "Kỹ thuật viên không khả dụng"],
  ["REALLOCATION", "Điều phối lại"],
  ["OTHER", "Khác"],
] as const;

function list(value: any): any[] {
  const data = value?.data ?? value;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return data ? [data] : [];
}

function unwrap(value: any) {
  return value?.data ?? value;
}

async function read(path: string) {
  const response = await authorizedFetch(path);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(
      new Error("Bạn không có quyền xem phiên dịch vụ này."),
      {
        forbidden: true,
        code: body?.error?.code,
        status: response.status,
      },
    );
  }
  if (!response.ok) {
    throw Object.assign(
      new Error(body?.error?.message ?? "Không thể tải dữ liệu."),
      {
        code: body?.error?.code,
        status: response.status,
      },
    );
  }
  return unwrap(body);
}

async function write(path: string, method: "POST" | "PATCH", payload: unknown) {
  const response = await authorizedFetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(
      new Error("Bạn không có quyền thực hiện thao tác này."),
      {
        forbidden: true,
        code: body?.error?.code,
        status: response.status,
      },
    );
  }
  if (!response.ok) {
    throw Object.assign(
      new Error(body?.error?.message ?? "Không thể hoàn tất thao tác."),
      {
        code: body?.error?.code,
        status: response.status,
      },
    );
  }
  return unwrap(body);
}

function text(value: unknown, fallback = "—") {
  return value == null || value === "" ? fallback : String(value);
}

function serviceName(service: any) {
  if (!service) return "Dịch vụ";
  if (typeof service === "string") return service;
  if (typeof service.name === "string") return service.name;
  if (service.name && typeof service.name === "object") {
    return (
      service.name["vi-VN"] ??
      service.name.vi ??
      service.name["en-US"] ??
      Object.values(service.name)[0] ??
      service.code ??
      "Dịch vụ"
    );
  }
  return service.displayName ?? service.code ?? "Dịch vụ";
}

function serviceDescription(service: any) {
  return text(
    service?.description?.["vi-VN"] ??
      service?.description?.vi ??
      service?.description,
    "Theo dõi tiến độ thực hiện dịch vụ.",
  );
}

function initials(value: unknown) {
  const parts = String(value ?? "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (
    parts
      .slice(-2)
      .map((part) => part.slice(0, 1))
      .join("")
      .toUpperCase() || "?"
  );
}

function money(value: unknown, code = "VND") {
  if (value == null || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  const minor = currencyMinorUnit(code);
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: code,
    maximumFractionDigits: minor,
  }).format(amount / 10 ** minor);
}

function dateTime(value: string | undefined, timezone = "UTC") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: timezone || "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function timeOnly(value: string | undefined, timezone = "UTC") {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: timezone || "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function secondsBetween(start: string | undefined, end: string | undefined) {
  if (!start || !end) return 0;
  return Math.max(
    0,
    Math.floor((new Date(end).valueOf() - new Date(start).valueOf()) / 1000),
  );
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function segmentValue(segment: any, camel: string, snake: string) {
  return segment?.[camel] ?? segment?.[snake];
}

export function calculateServiceTiming(input: {
  status?: string;
  actualStartedAt?: string;
  actualEndedAt?: string;
  pauses?: any[];
  totalPauseSeconds?: number;
  actualWorkSeconds?: number;
  now?: number;
}) {
  const startedAt = input.actualStartedAt
    ? new Date(input.actualStartedAt).valueOf()
    : 0;
  if (!startedAt)
    return {
      wallSeconds: 0,
      workSeconds: 0,
      pauseSeconds: 0,
      running: false,
      paused: false,
    };
  const now = input.now ?? Date.now();
  const endedAt = input.actualEndedAt
    ? new Date(input.actualEndedAt).valueOf()
    : now;
  const wallSeconds = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
  const pauseSeconds = Math.max(
    Number(input.totalPauseSeconds ?? 0),
    (input.pauses ?? []).reduce(
      (total, pause) =>
        total +
        secondsBetween(
          segmentValue(pause, "startedAt", "started_at"),
          segmentValue(pause, "endedAt", "ended_at") ??
            new Date(now).toISOString(),
        ),
      0,
    ),
  );
  const derivedWork = Math.max(0, wallSeconds - pauseSeconds);
  const workSeconds =
    input.status === "COMPLETED" && input.actualWorkSeconds != null
      ? Math.max(0, Number(input.actualWorkSeconds))
      : derivedWork;
  return {
    wallSeconds,
    workSeconds,
    pauseSeconds,
    running: input.status === "IN_PROGRESS",
    paused: input.status === "PAUSED",
  };
}

function errorText(cause: any) {
  switch (cause?.code) {
    case "SERVICE_SESSION_VERSION_CONFLICT":
    case "VERSION_CONFLICT":
      return "Phiên dịch vụ vừa thay đổi. Dữ liệu mới nhất đã được tải lại; hãy kiểm tra trước khi thao tác tiếp.";
    case "SERVICE_SESSION_STAFF_NOT_QUALIFIED":
    case "SERVICE_SESSION_STAFF_NOT_ASSIGNED":
      return "Kỹ thuật viên chưa đủ điều kiện hoặc chưa được phân công cho dịch vụ này.";
    case "SERVICE_SESSION_SCOPE_DENIED":
      return "Bạn không có quyền thao tác trên phiên dịch vụ này.";
    case "SERVICE_SESSION_INVALID_TRANSITION":
      return "Trạng thái phiên đã thay đổi nên thao tác này không còn hợp lệ.";
    default:
      return cause?.message ?? "Không thể hoàn tất thao tác.";
  }
}

function reasonLabel(value: unknown) {
  return REASON_LABELS[String(value)] ?? text(value);
}

function appointmentStatusLabel(value: unknown) {
  return APPOINTMENT_STATUS_LABELS[String(value)] ?? "Đang cập nhật";
}

function partialLabel(path: string) {
  if (path.includes("/checklist")) return "checklist";
  if (path.includes("/notes")) return "ghi chú";
  if (path.includes("/staff")) return "nhân sự";
  if (path.includes("checkout-summary")) return "tóm tắt thanh toán";
  if (path.includes("/history")) return "lịch sử lịch hẹn";
  if (path.includes("/branches/")) return "thông tin chi nhánh";
  return "dữ liệu bổ trợ";
}

function tone(status: string) {
  const value = STATUS_TONES[status] ?? "neutral";
  const className =
    `tone${value.charAt(0).toUpperCase()}${value.slice(1)}` as keyof typeof styles;
  return styles[className] ?? styles.toneNeutral;
}

function Card({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <section className={`${styles.card} ${className}`}>
      <header className={styles.cardHeader}>
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function Avatar({ name, small = false }: { name: unknown; small?: boolean }) {
  return (
    <span
      className={`${styles.avatar} ${small ? styles.avatarSmall : ""}`}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

function Badge({ status, children }: { status?: string; children: ReactNode }) {
  return (
    <span
      className={`${styles.badge} ${status ? tone(status) : styles.toneNeutral}`}
    >
      {children}
    </span>
  );
}

function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className={styles.modalBackdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="service-session-dialog-title"
      >
        <div className={styles.modalHeader}>
          <h2 id="service-session-dialog-title">{title}</h2>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onClose}
            aria-label="Đóng"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function StateBox({
  state,
  error,
  retry,
}: {
  state: LoadState;
  error?: string;
  retry: () => void;
}) {
  if (state === "loading")
    return (
      <div className={styles.stateBox} role="status" aria-busy="true">
        <span className={styles.spinner} />
        Đang tải phiên dịch vụ…
      </div>
    );
  if (state === "forbidden")
    return (
      <div className={`${styles.stateBox} ${styles.stateDanger}`} role="alert">
        <strong>Bạn không có quyền xem phiên dịch vụ này.</strong>
        <button type="button" onClick={retry}>
          Thử lại
        </button>
      </div>
    );
  if (state === "offline")
    return (
      <div className={`${styles.stateBox} ${styles.stateDanger}`} role="alert">
        <strong>Cần kết nối Internet để thực hiện thao tác.</strong>
        <button type="button" onClick={retry}>
          Thử lại
        </button>
      </div>
    );
  if (state === "error")
    return (
      <div className={`${styles.stateBox} ${styles.stateDanger}`} role="alert">
        <strong>Không thể tải phiên dịch vụ.</strong>
        <span>{error}</span>
        <button type="button" onClick={retry}>
          Thử lại
        </button>
      </div>
    );
  return null;
}

function ActionButton({
  children,
  variant = "secondary",
  disabled = false,
  onClick,
  type = "button",
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "quiet";
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  const className =
    `button${variant.charAt(0).toUpperCase()}${variant.slice(1)}` as keyof typeof styles;
  return (
    <button
      type={type}
      className={`${styles.button} ${styles[className]}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function serviceDuration(
  service: any,
  fallbackStart?: string,
  fallbackEnd?: string,
) {
  const snapshot = Number(service?.durationMin ?? service?.duration ?? 0);
  if (snapshot > 0) return snapshot;
  return Math.round(secondsBetween(fallbackStart, fallbackEnd) / 60);
}

function staffDisplay(staffRows: any[], id: string | undefined) {
  return (
    staffRows.find((staff) => staff.id === id)?.displayName ??
    (id ? "Kỹ thuật viên" : "Chưa phân công")
  );
}

export default function ServiceSessionPage({
  sessionId,
}: {
  sessionId: string;
}) {
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [bundle, setBundle] = useState<any>(null);
  const [now, setNow] = useState(Date.now());
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [pauseReason, setPauseReason] = useState("CUSTOMER_BREAK");
  const [pauseNote, setPauseNote] = useState("");
  const [transferReason, setTransferReason] = useState("SHIFT_CHANGE");
  const [transferNote, setTransferNote] = useState("");
  const [transferStaffId, setTransferStaffId] = useState("");
  const [completionNote, setCompletionNote] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(
    async (silent = false) => {
      if (!sessionId) return;
      if (!silent) setState("loading");
      try {
        const session = await read(
          `/v1/service-sessions/${encodeURIComponent(sessionId)}`,
        );
        const appointmentId = session.appointmentId;
        if (!appointmentId)
          throw new Error("Phiên dịch vụ chưa liên kết lịch hẹn.");
        const appointment = await read(
          `/v1/appointments/${encodeURIComponent(appointmentId)}`,
        );
        const optionalPaths = [
          `/v1/service-sessions?appointmentId=${encodeURIComponent(appointmentId)}`,
          "/v1/staff?status=ACTIVE",
          `/v1/service-sessions/${encodeURIComponent(sessionId)}/notes`,
          `/v1/service-sessions/${encodeURIComponent(sessionId)}/checklist`,
          `/v1/appointments/${encodeURIComponent(appointmentId)}/history`,
          `/v1/appointments/${encodeURIComponent(appointmentId)}/checkout-summary`,
          `/v1/branches/${encodeURIComponent(session.branchId)}`,
        ];
        const optional = await Promise.allSettled(
          optionalPaths.map((path) => read(path)),
        );
        const partialErrors = optional.flatMap((result, index) =>
          result.status === "rejected"
            ? [
                {
                  path: optionalPaths[index],
                  message: errorText(result.reason),
                },
              ]
            : [],
        );
        const value = (index: number) =>
          optional[index]?.status === "fulfilled"
            ? optional[index].value
            : null;
        setBundle({
          session,
          appointment,
          sessions: value(0),
          staff: value(1),
          notes: value(2),
          checklist: value(3),
          history: value(4),
          checkout: value(5),
          branch: value(6),
          partialErrors,
        });
        setState("ready");
        setError("");
      } catch (cause: any) {
        setError(errorText(cause));
        setState(
          cause?.forbidden
            ? "forbidden"
            : cause?.status === 0 || !navigator.onLine
              ? "offline"
              : "error",
        );
      }
    },
    [sessionId],
  );

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const refresh = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const polling = window.setInterval(() => {
      if (!saving && document.visibilityState === "visible") void load(true);
    }, 15000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(polling);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load, saving]);

  const session = bundle?.session;
  const appointment = bundle?.appointment;
  const timezone = bundle?.branch?.timezone ?? "Asia/Ho_Chi_Minh";
  const staffRows = list(bundle?.staff);
  const appointmentItems = appointment?.items ?? [];
  const currentItem =
    appointmentItems.find(
      (item: any) => item.id === session?.appointmentItemId,
    ) ?? {};
  const currentName = serviceName(session?.service ?? currentItem.service);
  const customerName =
    appointment?.contact?.displayName ??
    session?.customerDisplayName ??
    "Khách hàng";
  const currentSegment =
    (session?.segments ?? [])
      .slice()
      .reverse()
      .find((item: any) => !segmentValue(item, "endedAt", "ended_at")) ??
    (session?.segments ?? []).slice().reverse()[0];
  const assignedStaffId =
    session?.currentStaffId ??
    segmentValue(currentSegment, "staffId", "staff_id") ??
    currentItem.staff?.id;
  const effectiveStaffId = selectedStaffId || assignedStaffId || "";
  const staffName = staffDisplay(staffRows, effectiveStaffId);
  const timing = calculateServiceTiming({
    ...session,
    pauses: session?.pauses,
    now,
  });
  const expectedMinutes = serviceDuration(
    session?.service ?? currentItem.service,
    session?.scheduledStartAt,
    session?.scheduledEndAt,
  );
  const checklist = list(bundle?.checklist);
  const notes = list(bundle?.notes);
  const sessions = list(bundle?.sessions).sort(
    (a, b) =>
      new Date(a.scheduledStartAt ?? 0).valueOf() -
      new Date(b.scheduledStartAt ?? 0).valueOf(),
  );
  const checkout = bundle?.checkout;
  const currency =
    checkout?.pricingPreview?.currency ??
    appointment?.pricingSummary?.currency ??
    "VND";
  const totalMinor =
    checkout?.pricingPreview?.subtotalMinor ??
    appointment?.pricingSummary?.amountMinor ??
    appointment?.pricingSummary?.totalMinor;
  const remainingChecklist = checklist.filter((item) => !item.completed).length;
  const isActive = ["IN_PROGRESS", "PAUSED"].includes(session?.status);
  const readOnly = ["COMPLETED", "CANCELLED"].includes(session?.status);
  const nextSession = sessions.find(
    (item) => item.id !== session?.id && item.status === "PENDING",
  );

  useEffect(() => {
    if (effectiveStaffId && !selectedStaffId)
      setSelectedStaffId(effectiveStaffId);
  }, [effectiveStaffId, selectedStaffId]);

  const run = async (
    path: string,
    payload: any,
    success: string,
    method: "POST" | "PATCH" = "POST",
  ) => {
    if (!session || saving) return;
    setSaving(true);
    setMessage("");
    try {
      await write(path, method, { version: session.version, ...payload });
      setMessage(success);
      setModal(null);
      await load(true);
    } catch (cause: any) {
      setMessage(errorText(cause));
      await load(true);
    } finally {
      setSaving(false);
    }
  };

  const activity = useMemo(() => {
    const entries: Array<{
      at: string;
      label: string;
      detail?: string;
      tone: string;
    }> = [];
    for (const item of list(bundle?.history)) {
      const at = item.createdAt ?? item.created_at;
      if (at)
        entries.push({
          at,
          label:
            (item.toStatus ?? item.to_status)
              ? `Lịch hẹn: ${appointmentStatusLabel(item.toStatus ?? item.to_status)}`
              : "Cập nhật lịch hẹn",
          detail: reasonLabel(item.reasonCode ?? item.reason_code),
          tone: "neutral",
        });
    }
    if (session?.actualStartedAt)
      entries.push({
        at: session.actualStartedAt,
        label: "Bắt đầu thực hiện dịch vụ",
        tone: "live",
      });
    for (const pause of session?.pauses ?? []) {
      const started = segmentValue(pause, "startedAt", "started_at");
      if (started)
        entries.push({
          at: started,
          label: "Phiên dịch vụ tạm dừng",
          detail: reasonLabel(segmentValue(pause, "reasonCode", "reason_code")),
          tone: "warning",
        });
      const ended = segmentValue(pause, "endedAt", "ended_at");
      if (ended)
        entries.push({
          at: ended,
          label: "Tiếp tục thực hiện dịch vụ",
          tone: "live",
        });
    }
    for (const item of notes)
      entries.push({
        at: item.createdAt ?? item.created_at,
        label: "Đã thêm ghi chú kỹ thuật",
        detail: item.note,
        tone: "neutral",
      });
    if (session?.actualEndedAt)
      entries.push({
        at: session.actualEndedAt,
        label:
          session.status === "COMPLETED"
            ? "Đã hoàn thành dịch vụ"
            : "Phiên dịch vụ đã kết thúc",
        tone: "success",
      });
    return entries
      .filter((item) => item.at)
      .sort((a, b) => new Date(b.at).valueOf() - new Date(a.at).valueOf())
      .slice(0, 8);
  }, [bundle?.history, notes, session]);

  if (state !== "ready")
    return (
      <main className={styles.page}>
        <h1 className={styles.stateHeading}>Phiên dịch vụ</h1>
        <StateBox state={state} error={error} retry={() => void load()} />
      </main>
    );

  return (
    <main className={styles.page}>
      <div className={styles.pageInner}>
        <div className={styles.breadcrumb}>
          <a href={`/admin/appointments/${appointment.id}/overview`}>
            Lịch hẹn
          </a>
          <span>/</span>
          <span>#{text(appointment.bookingReference, appointment.id)}</span>
          <span>/</span>
          <strong>Phiên dịch vụ</strong>
        </div>
        <div className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>LỊCH HẸN · VẬN HÀNH DỊCH VỤ</p>
            <h1>Phiên dịch vụ</h1>
            <p>
              Theo dõi tiến trình thực hiện, thời gian làm việc, ghi chú và
              attribution của kỹ thuật viên.
            </p>
          </div>
          <div className={styles.headerActions}>
            <a
              className={`${styles.button} ${styles.buttonSecondary}`}
              href={`/admin/appointments/${appointment.id}/overview`}
            >
              Quay lại lịch hẹn
            </a>
            {isActive ? (
              <ActionButton
                variant="secondary"
                onClick={() => setModal("transfer")}
                disabled={saving}
              >
                Chuyển kỹ thuật viên
              </ActionButton>
            ) : null}
            {isActive ? (
              <ActionButton
                variant="primary"
                onClick={() => setModal("complete")}
                disabled={saving}
              >
                ✓ Hoàn thành dịch vụ
              </ActionButton>
            ) : null}
          </div>
        </div>

        {message ? (
          <div
            className={`${styles.notice} ${message.startsWith("Đã") ? styles.noticeSuccess : styles.noticeDanger}`}
            role="status"
          >
            {message}
          </div>
        ) : null}
        {bundle.partialErrors?.length ? (
          <div className={styles.partialNotice}>
            Chưa tải được:{" "}
            {bundle.partialErrors
              .map(
                (item: any) => `${partialLabel(item.path)} (${item.message})`,
              )
              .join(", ")}
            . Thao tác trên phiên dịch vụ vẫn dùng dữ liệu chính thức.{" "}
            <button type="button" onClick={() => void load(true)}>
              Tải lại
            </button>
          </div>
        ) : null}

        <section className={styles.contextBar}>
          <div className={styles.contextCustomer}>
            <Avatar name={customerName} />
            <div>
              <strong>{customerName}</strong>
              <span>{text(appointment.contact?.phone)}</span>
              <div className={styles.tagRow}>
                <span className={styles.tag}>
                  {text(appointment.bookingReference, "Lịch hẹn")}
                </span>
                <Badge status={session.status}>
                  {STATUS_LABELS[session.status] ?? "Đang cập nhật"}
                </Badge>
              </div>
            </div>
          </div>
          <div className={styles.contextStat}>
            <span>Chi nhánh</span>
            <strong>{text(bundle.branch?.name, session.branchId)}</strong>
          </div>
          <div className={styles.contextStat}>
            <span>Kỹ thuật viên hiện tại</span>
            <strong>{staffName}</strong>
          </div>
          <div className={styles.contextStat}>
            <span>Dịch vụ đang thực hiện</span>
            <strong>{currentName}</strong>
          </div>
        </section>

        <div className={styles.workspaceGrid}>
          <div className={styles.mainColumn}>
            <Card
              title="Tiến độ dịch vụ"
              action={
                <span className={styles.muted}>
                  Phiên {text(session.version)}
                </span>
              }
            >
              <div className={styles.stepper}>
                {sessions.length ? (
                  sessions.map((item: any, index: number) => (
                    <div
                      className={`${styles.step} ${item.id === session.id ? styles.stepCurrent : ""} ${item.status === "COMPLETED" ? styles.stepDone : ""}`}
                      key={item.id}
                    >
                      <span className={styles.stepNumber}>
                        {item.status === "COMPLETED" ? "✓" : index + 1}
                      </span>
                      <div>
                        <strong>{serviceName(item.service)}</strong>
                        <small>
                          {STATUS_LABELS[item.status] ?? "Đang cập nhật"}
                        </small>
                      </div>
                      {index < sessions.length - 1 ? (
                        <span className={styles.stepLine} />
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className={styles.empty}>
                    Chưa có danh sách phiên trong lịch hẹn.
                  </p>
                )}
              </div>
            </Card>

            <div className={styles.heroGrid}>
              <Card
                title="Dịch vụ hiện tại"
                className={styles.currentServiceCard}
                action={
                  <Badge status={session.status}>
                    {STATUS_LABELS[session.status] ?? "Đang cập nhật"}
                  </Badge>
                }
              >
                <div className={styles.serviceHero}>
                  <span className={styles.serviceIcon}>SG</span>
                  <div>
                    <h3>{currentName}</h3>
                    <p>
                      {serviceDescription(
                        session.service ?? currentItem.service,
                      )}
                    </p>
                  </div>
                </div>
                <div className={styles.metricGrid}>
                  <div>
                    <span>Khách hàng</span>
                    <strong>{customerName}</strong>
                  </div>
                  <div>
                    <span>Kỹ thuật viên</span>
                    <strong>{staffName}</strong>
                  </div>
                  <div>
                    <span>Bắt đầu lúc</span>
                    <strong>
                      {timeOnly(
                        session.actualStartedAt ?? session.scheduledStartAt,
                        timezone,
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>Thời lượng dự kiến</span>
                    <strong>{expectedMinutes || "—"} phút</strong>
                  </div>
                </div>
              </Card>
              <Card
                title="Điều khiển phiên dịch vụ"
                action={
                  <span className={styles.liveLabel}>
                    <span />
                    Realtime
                  </span>
                }
              >
                <div className={styles.timerBlock}>
                  <strong aria-live="polite">
                    {formatDuration(timing.workSeconds)}
                  </strong>
                  <span>Thời gian làm việc thực tế</span>
                </div>
                <div className={styles.controlRow}>
                  {session.status === "PENDING" ? (
                    <ActionButton
                      variant="primary"
                      onClick={() =>
                        effectiveStaffId
                          ? void run(
                              `/v1/service-sessions/${session.id}/start`,
                              { staffId: effectiveStaffId },
                              "Đã bắt đầu dịch vụ.",
                            )
                          : setMessage(
                              "Hãy chọn kỹ thuật viên được phân công trước khi bắt đầu.",
                            )
                      }
                      disabled={saving || !effectiveStaffId}
                    >
                      ▶ Bắt đầu
                    </ActionButton>
                  ) : null}
                  {session.status === "IN_PROGRESS" ? (
                    <ActionButton
                      variant="secondary"
                      onClick={() => setModal("pause")}
                      disabled={saving}
                    >
                      Ⅱ Tạm dừng
                    </ActionButton>
                  ) : null}
                  {session.status === "PAUSED" ? (
                    <ActionButton
                      variant="primary"
                      onClick={() =>
                        effectiveStaffId
                          ? void run(
                              `/v1/service-sessions/${session.id}/resume`,
                              { staffId: effectiveStaffId },
                              "Đã tiếp tục dịch vụ.",
                            )
                          : setMessage(
                              "Hãy chọn kỹ thuật viên trước khi tiếp tục.",
                            )
                      }
                      disabled={saving || !effectiveStaffId}
                    >
                      ▶ Tiếp tục
                    </ActionButton>
                  ) : null}
                  {isActive ? (
                    <ActionButton
                      variant="primary"
                      onClick={() => setModal("complete")}
                      disabled={saving}
                    >
                      ✓ Hoàn thành
                    </ActionButton>
                  ) : null}
                </div>
                {session.status === "PENDING" || session.status === "PAUSED" ? (
                  <label className={styles.field}>
                    <span>Kỹ thuật viên thao tác</span>
                    <select
                      value={selectedStaffId}
                      onChange={(event) =>
                        setSelectedStaffId(event.target.value)
                      }
                    >
                      <option value="">
                        {assignedStaffId
                          ? `${staffName} (đã phân công)`
                          : "Chọn kỹ thuật viên"}
                      </option>
                      {staffRows.map((staff) => (
                        <option value={staff.id} key={staff.id}>
                          {staff.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <div className={styles.timerStats}>
                  <span>
                    <b>Tạm dừng</b>
                    {formatDuration(timing.pauseSeconds)}
                  </span>
                  <span>
                    <b>Thời lượng dự kiến</b>
                    {expectedMinutes || "—"} phút
                  </span>
                  <span>
                    <b>Hiệu suất</b>
                    <em className={styles.goodText}>
                      {timing.workSeconds <= expectedMinutes * 60 ||
                      !expectedMinutes
                        ? "Đúng tiến độ"
                        : "Đang vượt thời lượng"}
                    </em>
                  </span>
                </div>
              </Card>
            </div>

            <div className={styles.threeColumnGrid}>
              <Card title="Phân bổ kỹ thuật viên">
                <div className={styles.staffCurrent}>
                  <Avatar name={staffName} small />
                  <div>
                    <strong>{staffName}</strong>
                    <span>
                      {assignedStaffId
                        ? "Attribution từ phiên dịch vụ"
                        : "Chưa có attribution"}
                    </span>
                  </div>
                  <Badge status={session.status}>
                    {session.status === "IN_PROGRESS"
                      ? "Đang thực hiện"
                      : STATUS_LABELS[session.status]}
                  </Badge>
                </div>
                <div className={styles.segmentList} tabIndex={0} aria-label="Lịch sử phân bổ kỹ thuật viên">
                  {(session.segments ?? []).map((item: any) => {
                    const id = segmentValue(item, "staffId", "staff_id");
                    return (
                      <div key={item.id}>
                        <span>{staffDisplay(staffRows, id)}</span>
                        <small>
                          {timeOnly(
                            segmentValue(item, "startedAt", "started_at"),
                            timezone,
                          )}{" "}
                          –{" "}
                          {segmentValue(item, "endedAt", "ended_at")
                            ? timeOnly(
                                segmentValue(item, "endedAt", "ended_at"),
                                timezone,
                              )
                            : "đang mở"}
                        </small>
                      </div>
                    );
                  })}
                </div>
                {isActive ? (
                  <ActionButton
                    variant="secondary"
                    onClick={() => setModal("transfer")}
                    disabled={saving}
                  >
                    Chuyển attribution
                  </ActionButton>
                ) : null}
              </Card>
              <Card
                title="Ghi chú kỹ thuật"
                action={
                  <span className={styles.muted}>{notes.length} ghi chú</span>
                }
              >
                <div className={styles.noteList} tabIndex={0} aria-label="Ghi chú kỹ thuật đã lưu">
                  {notes
                    .slice(-3)
                    .reverse()
                    .map((item: any) => (
                      <article key={item.id}>
                        <strong>
                          {dateTime(
                            item.createdAt ?? item.created_at,
                            timezone,
                          )}
                        </strong>
                        <p>{item.note}</p>
                      </article>
                    ))}
                  {!notes.length ? (
                    <p className={styles.empty}>
                      Chưa có ghi chú cho phiên này.
                    </p>
                  ) : null}
                </div>
                <form
                  className={styles.noteForm}
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (note.trim())
                      void run(
                        `/v1/service-sessions/${session.id}/notes`,
                        { visibility: "TECHNICIAN", note: note.trim() },
                        "Đã lưu ghi chú.",
                      ).then(() => setNote(""));
                  }}
                >
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Nhập ghi chú cho phiên dịch vụ…"
                    maxLength={4000}
                    rows={3}
                    aria-label="Ghi chú kỹ thuật"
                  />
                  <ActionButton
                    type="submit"
                    variant="secondary"
                    disabled={saving || !note.trim()}
                  >
                    Lưu ghi chú
                  </ActionButton>
                </form>
              </Card>
              <Card
                title="Checklist thực hiện"
                action={
                  checklist.length ? (
                    <span className={styles.muted}>
                      {checklist.length - remainingChecklist}/{checklist.length}
                    </span>
                  ) : undefined
                }
              >
                {checklist.length ? (
                  <div className={styles.checklist}>
                    {checklist.map((item: any) => (
                      <label className={styles.checkItem} key={item.id}>
                        <input
                          type="checkbox"
                          checked={Boolean(item.completed)}
                          onChange={(event) =>
                            void run(
                              `/v1/service-sessions/${session.id}/checklist/${item.id}`,
                              { completed: event.target.checked },
                              "Đã cập nhật checklist.",
                              "PATCH",
                            )
                          }
                          disabled={saving || readOnly}
                        />
                        <span
                          className={item.completed ? styles.checkedBox : ""}
                        >
                          {item.completed ? "✓" : ""}
                        </span>
                        <strong>{item.label}</strong>
                        {item.required ? <em>Bắt buộc</em> : null}
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className={styles.empty}>
                    Chưa có checklist cho dịch vụ này.
                  </p>
                )}
              </Card>
            </div>

            <Card
              title="Lịch sử hoạt động"
              action={
                <span className={styles.muted}>Nguồn dữ liệu vận hành</span>
              }
            >
              <div className={styles.timeline}>
                {activity.length ? (
                  activity.map((item, index) => (
                    <div
                      className={styles.timelineItem}
                      key={`${item.at}-${index}`}
                    >
                      <span
                        className={`${styles.timelineDot} ${item.tone === "success" ? styles.dotSuccess : item.tone === "warning" ? styles.dotWarning : item.tone === "live" ? styles.dotLive : ""}`}
                      />
                      <div>
                        <strong>{item.label}</strong>
                        <span>{dateTime(item.at, timezone)}</span>
                        {item.detail ? <small>{item.detail}</small> : null}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className={styles.empty}>
                    Chưa có hoạt động được ghi nhận.
                  </p>
                )}
              </div>
            </Card>
          </div>

          <aside className={styles.sideColumn}>
            <Card title="Dịch vụ trong lịch hẹn">
              <div className={styles.appointmentServices}>
                {sessions.length
                  ? sessions.map((item: any) => (
                      <a
                        href={
                          item.id === session.id
                            ? `#service-current`
                            : `/admin/service-sessions/${item.id}`
                        }
                        className={
                          item.id === session.id
                            ? styles.serviceRowCurrent
                            : styles.serviceRow
                        }
                        key={item.id}
                      >
                        <span className={styles.serviceStatusDot} />
                        <div>
                          <strong>{serviceName(item.service)}</strong>
                          <small>
                            {timeOnly(item.scheduledStartAt, timezone)} –{" "}
                            {timeOnly(item.scheduledEndAt, timezone)}
                          </small>
                        </div>
                        <Badge status={item.status}>
                          {STATUS_LABELS[item.status] ?? "Đang cập nhật"}
                        </Badge>
                      </a>
                    ))
                  : appointmentItems.map((item: any) => (
                      <div className={styles.serviceRow} key={item.id}>
                        <span className={styles.serviceStatusDot} />
                        <div>
                          <strong>{serviceName(item.service)}</strong>
                          <small>{serviceDuration(item.service)} phút</small>
                        </div>
                      </div>
                    ))}
              </div>
              <a
                className={styles.textLink}
                href={`/admin/appointments/${appointment.id}/add-service`}
              >
                + Thêm dịch vụ
              </a>
            </Card>
            <Card title="Tiến độ lịch hẹn">
              <div className={styles.progressTrack}>
                <span
                  style={{
                    width: `${sessions.length ? Math.round((sessions.filter((item: any) => item.status === "COMPLETED").length / sessions.length) * 100) : 0}%`,
                  }}
                />
              </div>
              <div className={styles.progressMeta}>
                <strong>
                  {
                    sessions.filter((item: any) => item.status === "COMPLETED")
                      .length
                  }
                  /{sessions.length || 0} phiên hoàn thành
                </strong>
                <span>{appointmentStatusLabel(appointment.status)}</span>
              </div>
              <div className={styles.progressDetail}>
                <span>Đã làm</span>
                <strong>{formatDuration(timing.workSeconds)}</strong>
              </div>
              <div className={styles.progressDetail}>
                <span>Tổng lịch hẹn</span>
                <strong>
                  {sessions.reduce(
                    (total: number, item: any) =>
                      total +
                      serviceDuration(
                        item.service,
                        item.scheduledStartAt,
                        item.scheduledEndAt,
                      ),
                    0,
                  ) || "—"}{" "}
                  phút
                </strong>
              </div>
            </Card>
            <Card title="Khách hàng">
              <div className={styles.customerCard}>
                <Avatar name={customerName} />
                <div>
                  <h3>{customerName}</h3>
                  <p>{text(appointment.contact?.phone)}</p>
                  <p>{text(appointment.contact?.email)}</p>
                </div>
              </div>
              <dl className={styles.detailList}>
                <div>
                  <dt>Mã lịch hẹn</dt>
                  <dd>{text(appointment.bookingReference)}</dd>
                </div>
                <div>
                  <dt>Ghi chú khách</dt>
                  <dd>{text(appointment.customerNote, "Không có")}</dd>
                </div>
              </dl>
              <div className={styles.actionPair}>
                <a
                  className={styles.outlineLink}
                  href={`/admin/customers/${appointment.customerId ?? ""}`}
                >
                  Xem hồ sơ
                </a>
                <a
                  className={styles.outlineLink}
                  href={`tel:${appointment.contact?.phone ?? ""}`}
                >
                  Liên hệ
                </a>
              </div>
            </Card>
            <Card title="Tóm tắt thanh toán">
              <dl className={styles.moneyList}>
                <div>
                  <dt>Tạm tính</dt>
                  <dd>{money(totalMinor, currency)}</dd>
                </div>
                <div>
                  <dt>Giảm giá</dt>
                  <dd>
                    {money(appointment.pricingSummary?.discountMinor, currency)}
                  </dd>
                </div>
                <div>
                  <dt>Đã đặt cọc</dt>
                  <dd>
                    {money(
                      appointment.depositPaidMinor ??
                        appointment.pricingSummary?.depositMinor,
                      currency,
                    )}
                  </dd>
                </div>
                <div className={styles.totalLine}>
                  <dt>Tổng cộng</dt>
                  <dd>
                    {money(
                      appointment.pricingSummary?.amountMinor ?? totalMinor,
                      currency,
                    )}
                  </dd>
                </div>
              </dl>
              <Badge>
                {checkout?.checkoutReady
                  ? "Sẵn sàng thanh toán"
                  : "Chưa checkout"}
              </Badge>
              {checkout?.checkoutReady ? (
                <a
                  className={styles.outlineLink}
                  href={`/admin/appointments/${appointment.id}/checkout-summary`}
                >
                  Mở thanh toán
                </a>
              ) : null}
            </Card>
            <Card title="Thao tác nhanh">
              <div className={styles.quickActions}>
                {session.status === "IN_PROGRESS" ? (
                  <ActionButton
                    variant="secondary"
                    onClick={() => setModal("pause")}
                    disabled={saving}
                  >
                    Ⅱ Tạm dừng dịch vụ
                  </ActionButton>
                ) : null}
                {isActive ? (
                  <ActionButton
                    variant="secondary"
                    onClick={() => setModal("transfer")}
                    disabled={saving}
                  >
                    ⇄ Chuyển kỹ thuật viên
                  </ActionButton>
                ) : null}
                <a
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  href={`/admin/appointments/${appointment.id}/add-service`}
                >
                  + Thêm dịch vụ
                </a>
                {isActive ? (
                  <ActionButton
                    variant="primary"
                    onClick={() => setModal("complete")}
                    disabled={saving}
                  >
                    ✓ Hoàn thành dịch vụ
                  </ActionButton>
                ) : null}
              </div>
            </Card>
            {session.status === "COMPLETED" && nextSession ? (
              <div className={styles.nextCard}>
                <span className={styles.successMark}>✓</span>
                <div>
                  <strong>Đã hoàn thành dịch vụ</strong>
                  <p>Phiên tiếp theo: {serviceName(nextSession.service)}</p>
                  <a href={`/admin/service-sessions/${nextSession.id}`}>
                    Mở phiên tiếp theo →
                  </a>
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      </div>

      <footer className={styles.stickyFooter}>
        <a
          className={`${styles.button} ${styles.buttonSecondary}`}
          href={`/admin/appointments/${appointment.id}/overview`}
        >
          ← Quay lại lịch hẹn
        </a>
        <div>
          {isActive ? (
            <ActionButton
              variant="secondary"
              onClick={() => setModal("transfer")}
              disabled={saving}
            >
              Chuyển kỹ thuật viên
            </ActionButton>
          ) : null}
          {isActive ? (
            <ActionButton
              variant="primary"
              onClick={() => setModal("complete")}
              disabled={saving}
            >
              ✓ Hoàn thành dịch vụ
            </ActionButton>
          ) : null}
        </div>
      </footer>

      {modal === "pause" ? (
        <Dialog title="Tạm dừng phiên dịch vụ" onClose={() => setModal(null)}>
          <form
            className={styles.modalForm}
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                `/v1/service-sessions/${session.id}/pause`,
                { reasonCode: pauseReason, note: pauseNote || undefined },
                "Đã tạm dừng dịch vụ.",
              );
            }}
          >
            <label className={styles.field}>
              <span>Lý do tạm dừng</span>
              <select
                value={pauseReason}
                onChange={(event) => setPauseReason(event.target.value)}
              >
                {PAUSE_REASONS.map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Ghi chú (tùy chọn)</span>
              <textarea
                value={pauseNote}
                onChange={(event) => setPauseNote(event.target.value)}
                rows={3}
                maxLength={1000}
              />
            </label>
            <div className={styles.modalActions}>
              <ActionButton variant="secondary" onClick={() => setModal(null)}>
                Hủy
              </ActionButton>
              <ActionButton type="submit" variant="primary" disabled={saving}>
                Xác nhận tạm dừng
              </ActionButton>
            </div>
          </form>
        </Dialog>
      ) : null}
      {modal === "transfer" ? (
        <Dialog title="Chuyển kỹ thuật viên" onClose={() => setModal(null)}>
          <form
            className={styles.modalForm}
            onSubmit={(event) => {
              event.preventDefault();
              if (!transferStaffId) return;
              void run(
                `/v1/service-sessions/${session.id}/transfer-staff`,
                {
                  targetStaffId: transferStaffId,
                  reasonCode: transferReason,
                  note: transferNote || undefined,
                },
                "Đã gửi yêu cầu chuyển kỹ thuật viên.",
              );
            }}
          >
            <p className={styles.helper}>
              Danh sách dưới đây là nhân sự ACTIVE trong chi nhánh. Backend sẽ
              kiểm tra kỹ năng, phân công và reservation trước khi nhận chuyển.
            </p>
            <label className={styles.field}>
              <span>Kỹ thuật viên đích</span>
              <select
                value={transferStaffId}
                onChange={(event) => setTransferStaffId(event.target.value)}
                required
              >
                <option value="">Chọn kỹ thuật viên</option>
                {staffRows
                  .filter((staff) => staff.id !== effectiveStaffId)
                  .map((staff) => (
                    <option value={staff.id} key={staff.id}>
                      {staff.displayName}
                    </option>
                  ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Lý do</span>
              <select
                value={transferReason}
                onChange={(event) => setTransferReason(event.target.value)}
              >
                {TRANSFER_REASONS.map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Ghi chú (tùy chọn)</span>
              <textarea
                value={transferNote}
                onChange={(event) => setTransferNote(event.target.value)}
                rows={3}
                maxLength={1000}
              />
            </label>
            <div className={styles.modalActions}>
              <ActionButton variant="secondary" onClick={() => setModal(null)}>
                Hủy
              </ActionButton>
              <ActionButton
                type="submit"
                variant="primary"
                disabled={saving || !transferStaffId}
              >
                Xác nhận chuyển
              </ActionButton>
            </div>
          </form>
        </Dialog>
      ) : null}
      {modal === "complete" ? (
        <Dialog title="Hoàn thành dịch vụ" onClose={() => setModal(null)}>
          <form
            className={styles.modalForm}
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                `/v1/service-sessions/${session.id}/complete`,
                { completionNote: completionNote || undefined },
                "Đã hoàn thành dịch vụ.",
              );
            }}
          >
            <div className={styles.completeSummary}>
              <div>
                <span>Thời gian làm</span>
                <strong>{formatDuration(timing.workSeconds)}</strong>
              </div>
              <div>
                <span>Dự kiến</span>
                <strong>{expectedMinutes || "—"} phút</strong>
              </div>
              <div>
                <span>Checklist</span>
                <strong>
                  {checklist.length
                    ? `${checklist.length - remainingChecklist}/${checklist.length}`
                    : "Không có"}
                </strong>
              </div>
            </div>
            {checklist.length && remainingChecklist ? (
              <div className={styles.modalWarning}>
                Còn {remainingChecklist} mục checklist chưa hoàn tất. Bạn vẫn có
                thể hoàn thành nếu nghiệp vụ cho phép.
              </div>
            ) : null}
            <label className={styles.field}>
              <span>Ghi chú hoàn thành (tùy chọn)</span>
              <textarea
                value={completionNote}
                onChange={(event) => setCompletionNote(event.target.value)}
                rows={4}
                maxLength={4000}
              />
            </label>
            <div className={styles.modalActions}>
              <ActionButton variant="secondary" onClick={() => setModal(null)}>
                Quay lại
              </ActionButton>
              <ActionButton type="submit" variant="primary" disabled={saving}>
                Xác nhận hoàn thành
              </ActionButton>
            </div>
          </form>
        </Dialog>
      ) : null}
    </main>
  );
}

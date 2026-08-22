/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { currencyMinorUnit } from "@nailsoft/domain-types";
import { authorizedFetch } from "../auth";
import styles from "./appointment-checkout-summary.module.css";

type LoadState = "loading" | "ready" | "error" | "forbidden" | "offline";

type Bundle = {
  summary: any;
  appointment: any;
  sessions: any[] | null;
  staff: any[] | null;
  branch: any | null;
  arrival: any | null;
  history: any[] | null;
  customer: any | null;
  loyalty: any | null;
  membership: any[] | null;
  vouchers: any[] | null;
  authContext: any | null;
  notes: Record<string, any[]>;
  partialErrors: string[];
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Chờ thực hiện",
  IN_PROGRESS: "Đang thực hiện",
  PAUSED: "Tạm dừng",
  COMPLETED: "Hoàn thành",
  CANCELLED: "Đã hủy",
  CONFIRMED: "Đã xác nhận",
  ARRIVED: "Khách đã đến",
  CHECKED_IN: "Đã check-in",
  IN_SERVICE: "Đang phục vụ",
  PARTIALLY_COMPLETED: "Đang hoàn thiện",
  READY_FOR_CHECKOUT: "Sẵn sàng thanh toán",
  CHECKED_OUT: "Đã thanh toán",
  PAID: "Đã thanh toán",
  CANCELLED_BY_CUSTOMER: "Khách đã hủy",
  CANCELLED_BY_SALON: "Salon đã hủy",
  NO_SHOW: "Khách không đến",
  EXPIRED: "Đã hết hạn",
};

const ITEM_SOURCE_LABELS: Record<string, string> = {
  ADD_SERVICE: "Dịch vụ thêm",
  ADD_ON: "Dịch vụ thêm",
  MANUAL: "Bổ sung thủ công",
  WALK_IN: "Khách vãng lai",
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Nháp POS",
  READY_FOR_PAYMENT: "Sẵn sàng thanh toán",
  PARTIALLY_PAID: "Đã thanh toán một phần",
  PAID: "Đã thanh toán",
};

const ACTIVE_SESSION_STATUSES = new Set(["PENDING", "IN_PROGRESS", "PAUSED"]);
const TERMINAL_ITEM_STATUSES = new Set(["COMPLETED", "CANCELLED"]);

function unwrap(value: any) {
  return value?.data ?? value;
}

function list(value: any): any[] {
  const data = unwrap(value);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return data ? [data] : [];
}

async function read(path: string) {
  const response = await authorizedFetch(path);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error("Bạn không có quyền xem dữ liệu này."), {
      forbidden: true,
      status: response.status,
      code: body?.error?.code,
    });
  }
  if (!response.ok) {
    throw Object.assign(
      new Error(body?.error?.message ?? "Không thể tải dữ liệu."),
      { status: response.status, code: body?.error?.code },
    );
  }
  return unwrap(body);
}

async function write(path: string, payload: unknown, idempotencyKey?: string) {
  const response = await authorizedFetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey ?? crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(
      new Error("Bạn không có quyền thực hiện thao tác này."),
      {
        forbidden: true,
        status: response.status,
        code: body?.error?.code,
      },
    );
  }
  if (!response.ok) {
    throw Object.assign(
      new Error(body?.error?.message ?? "Không thể hoàn tất thao tác."),
      { status: response.status, code: body?.error?.code },
    );
  }
  return unwrap(body);
}

function text(value: unknown, fallback = "—") {
  return value == null || value === "" ? fallback : String(value);
}

function displayValue(value: unknown, fallback = "—") {
  if (value == null || value === "") return fallback;
  if (typeof value !== "object") return String(value);
  const item = value as any;
  return (
    item["vi-VN"] ??
    item.vi ??
    item["en-US"] ??
    item.name?.["vi-VN"] ??
    item.name?.vi ??
    item.name ??
    item.code ??
    fallback
  );
}

function serviceName(service: any, fallback = "Dịch vụ") {
  if (!service) return fallback;
  if (typeof service === "string") return service;
  if (typeof service.name === "string") return service.name;
  if (service.name && typeof service.name === "object") {
    return (
      service.name["vi-VN"] ??
      service.name.vi ??
      service.name["en-US"] ??
      Object.values(service.name)[0] ??
      service.code ??
      fallback
    );
  }
  return service.displayName ?? service.code ?? fallback;
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

function duration(totalSeconds: unknown) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours} giờ ${minutes} phút`
    : `${minutes} phút${remainder >= 30 ? " 30 giây" : ""}`;
}

function durationMinutes(value: unknown) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  return minutes ? `${minutes} phút` : "—";
}

function dateTime(value: string | undefined, timezone = "Asia/Ho_Chi_Minh") {
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

function timeOnly(value: string | undefined, timezone = "Asia/Ho_Chi_Minh") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: timezone || "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function secondsBetween(start?: string, end?: string) {
  if (!start || !end) return 0;
  return Math.max(
    0,
    Math.floor((new Date(end).valueOf() - new Date(start).valueOf()) / 1000),
  );
}

function initials(value: unknown) {
  const parts = String(value ?? "KH")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (
    parts
      .slice(-2)
      .map((part) => part.slice(0, 1))
      .join("")
      .toUpperCase() || "KH"
  );
}

function pickMinor(source: any, keys: string[]) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== "")
      return Number(value);
  }
  return undefined;
}

function statusLabel(value: unknown) {
  return STATUS_LABELS[String(value)] ?? "Đang cập nhật";
}

function statusTone(value: unknown) {
  const status = String(value ?? "");
  if (
    ["COMPLETED", "READY_FOR_CHECKOUT", "PAID", "CHECKED_OUT"].includes(status)
  )
    return "success";
  if (status.startsWith("CANCEL") || ["NO_SHOW", "EXPIRED"].includes(status))
    return "danger";
  if (["IN_PROGRESS", "IN_SERVICE", "CHECKED_IN", "ARRIVED"].includes(status))
    return "live";
  if (status === "PAUSED" || status === "PENDING") return "warning";
  return "neutral";
}

function errorText(error: any) {
  switch (error?.code) {
    case "POS_ORDER_NOT_CHECKOUT_READY":
      return "Lịch hẹn vừa thay đổi hoặc chưa còn sẵn sàng thanh toán. Hãy tải lại dữ liệu.";
    case "FINANCIAL_BRANCH_INACTIVE":
      return "Chi nhánh đang tạm ngưng nên chưa thể tạo đơn POS.";
    case "APPOINTMENT_NOT_FOUND":
      return "Không tìm thấy lịch hẹn này.";
    case "CONFLICT":
    case "VERSION_CONFLICT":
      return "Dữ liệu đã thay đổi. Hãy tải lại rồi kiểm tra trước khi tiếp tục.";
    default:
      return error?.message ?? "Không thể hoàn tất thao tác.";
  }
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

function Badge({ value, children }: { value?: unknown; children: ReactNode }) {
  return (
    <span
      className={`${styles.badge} ${styles[`tone${statusTone(value).replace(/^./, (char) => char.toUpperCase())}`]}`}
    >
      {children}
    </span>
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

function StateBox({
  state,
  error,
  retry,
}: {
  state: LoadState;
  error: string;
  retry: () => void;
}) {
  if (state === "loading")
    return (
      <div className={styles.stateBox} role="status">
        <span className={styles.spinner} />
        Đang tải tổng kết lịch hẹn…
      </div>
    );
  if (state === "forbidden")
    return (
      <div className={`${styles.stateBox} ${styles.stateDanger}`} role="alert">
        <strong>Không có quyền xem tổng kết</strong>
        <span>{error}</span>
        <button
          type="button"
          className={styles.buttonSecondary}
          onClick={retry}
        >
          Thử lại
        </button>
      </div>
    );
  if (state === "offline")
    return (
      <div className={styles.stateBox} role="alert">
        <strong>Đang offline</strong>
        <span>Không thể xác nhận chuyển sang POS khi chưa có kết nối.</span>
        <button
          type="button"
          className={styles.buttonSecondary}
          onClick={retry}
        >
          Thử lại
        </button>
      </div>
    );
  if (state === "error")
    return (
      <div className={`${styles.stateBox} ${styles.stateDanger}`} role="alert">
        <strong>Không thể tải dữ liệu</strong>
        <span>{error}</span>
        <button
          type="button"
          className={styles.buttonSecondary}
          onClick={retry}
        >
          Tải lại
        </button>
      </div>
    );
  return null;
}

function plannedMinutes(item: any, session: any, appointmentItem: any) {
  const service =
    item?.service ??
    appointmentItem?.service ??
    item?.serviceSnapshot ??
    appointmentItem?.serviceSnapshot;
  const explicit =
    service?.durationMin ??
    service?.defaultDurationMin ??
    item?.durationMin ??
    appointmentItem?.durationMin;
  if (explicit) return Number(explicit);
  if (session?.scheduledStartAt && session?.scheduledEndAt)
    return Math.round(
      secondsBetween(session.scheduledStartAt, session.scheduledEndAt) / 60,
    );
  return 0;
}

function priceMinor(item: any) {
  return pickMinor(item?.priceSnapshot, [
    "amountMinor",
    "amount",
    "unitPriceMinor",
  ]);
}

function sourceLabel(value: unknown) {
  const key = String(value ?? "");
  return ITEM_SOURCE_LABELS[key] ?? (key ? text(value) : "Dịch vụ trong lịch");
}

function staffDisplay(staffRows: any[] | null | undefined, id: unknown) {
  if (!id) return "Chưa phân công";
  const staff = (staffRows ?? []).find(
    (row) => row.id === id || row.staffId === id,
  );
  return staff?.displayName ?? staff?.name ?? "Nhân sự đã phân công";
}

function calculatePercentages(rows: Array<{ id: string; seconds: number }>) {
  const total = rows.reduce((sum, row) => sum + row.seconds, 0);
  if (!total) return rows.map((row) => ({ ...row, percent: 0 }));
  const raw = rows.map((row) => ({ ...row, raw: (row.seconds / total) * 100 }));
  const rounded = raw.map((row) => ({ ...row, percent: Math.floor(row.raw) }));
  let remainder = 100 - rounded.reduce((sum, row) => sum + row.percent, 0);
  rounded
    .slice()
    .sort((a, b) => b.raw - Math.floor(b.raw) - (a.raw - Math.floor(a.raw)))
    .forEach((row) => {
      if (remainder > 0) {
        row.percent += 1;
        remainder -= 1;
      }
    });
  return rounded.map((row) => ({
    id: row.id,
    seconds: row.seconds,
    percent: row.percent,
  }));
}

export default function AppointmentCheckoutSummaryPage({
  appointmentId,
}: {
  appointmentId: string;
}) {
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [confirmServices, setConfirmServices] = useState(false);
  const [confirmAddedServices, setConfirmAddedServices] = useState(false);
  const [confirmAccuracy, setConfirmAccuracy] = useState(false);
  const [tip, setTip] = useState(0);
  const [tipCustom, setTipCustom] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [noteMessage, setNoteMessage] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [handoffMessage, setHandoffMessage] = useState("");
  const [creatingOrder, setCreatingOrder] = useState(false);
  const stableKey = useRef<string | undefined>(undefined);

  const load = useCallback(
    async (silent = false) => {
      if (!appointmentId) {
        setState("error");
        setError("Thiếu mã lịch hẹn.");
        return;
      }
      if (!silent) setState("loading");
      setError("");
      try {
        const [summary, appointment] = await Promise.all([
          read(
            `/v1/appointments/${encodeURIComponent(appointmentId)}/checkout-summary`,
          ),
          read(`/v1/appointments/${encodeURIComponent(appointmentId)}`),
        ]);
        const customerId = summary?.customer?.id ?? appointment?.customerId;
        const branchId = appointment?.branchId ?? summary?.branchId;
        const optional = [
          [
            "sessions",
            () =>
              read(
                `/v1/service-sessions?appointmentId=${encodeURIComponent(appointmentId)}`,
              ),
          ],
          ["staff", () => read("/v1/staff?status=ACTIVE")],
          [
            "branch",
            () =>
              branchId
                ? read(`/v1/branches/${encodeURIComponent(branchId)}`)
                : Promise.reject(new Error("Thiếu chi nhánh")),
          ],
          [
            "arrival",
            () =>
              read(
                `/v1/appointments/${encodeURIComponent(appointmentId)}/arrival`,
              ),
          ],
          [
            "history",
            () =>
              read(
                `/v1/appointments/${encodeURIComponent(appointmentId)}/history`,
              ),
          ],
          [
            "customer",
            () =>
              customerId
                ? read(`/v1/customers/${encodeURIComponent(customerId)}`)
                : Promise.reject(new Error("Thiếu khách hàng")),
          ],
          [
            "loyalty",
            () =>
              customerId
                ? read(
                    `/v1/customers/${encodeURIComponent(customerId)}/loyalty`,
                  )
                : Promise.reject(new Error("Thiếu khách hàng")),
          ],
          [
            "membership",
            () =>
              customerId
                ? read(
                    `/v1/customers/${encodeURIComponent(customerId)}/membership`,
                  )
                : Promise.reject(new Error("Thiếu khách hàng")),
          ],
          [
            "vouchers",
            () =>
              customerId
                ? read(
                    `/v1/customers/${encodeURIComponent(customerId)}/vouchers`,
                  )
                : Promise.reject(new Error("Thiếu khách hàng")),
          ],
          ["authContext", () => read("/v1/auth/context")],
        ] as const;
        const results = await Promise.allSettled(
          optional.map(([, task]) => task()),
        );
        const values = new Map<string, any>();
        const partialErrors: string[] = [];
        results.forEach((result, index) => {
          const key = optional[index]?.[0] ?? "dữ liệu bổ trợ";
          if (result.status === "fulfilled") values.set(key, result.value);
          else if (!(key === "arrival" && result.reason?.status === 404))
            partialErrors.push(`${key}: ${errorText(result.reason)}`);
        });
        const sessionRows = list(values.get("sessions"));
        const notesResults = await Promise.allSettled(
          sessionRows.map(
            async (session) =>
              [
                session.id,
                await read(
                  `/v1/service-sessions/${encodeURIComponent(session.id)}/notes`,
                ),
              ] as const,
          ),
        );
        const notes: Record<string, any[]> = {};
        notesResults.forEach((result) => {
          if (result.status === "fulfilled")
            notes[result.value[0]] = list(result.value[1]);
        });
        setBundle({
          summary,
          appointment,
          sessions: values.has("sessions") ? sessionRows : null,
          staff: values.has("staff") ? list(values.get("staff")) : null,
          branch: values.get("branch") ?? null,
          arrival: values.get("arrival") ?? null,
          history: values.has("history") ? list(values.get("history")) : null,
          customer: values.get("customer") ?? null,
          loyalty: values.get("loyalty") ?? null,
          membership: values.has("membership")
            ? list(values.get("membership"))
            : null,
          vouchers: values.has("vouchers")
            ? list(values.get("vouchers"))
            : null,
          authContext: values.get("authContext") ?? null,
          notes,
          partialErrors,
        });
        setState("ready");
      } catch (cause: any) {
        setError(errorText(cause));
        setState(
          cause?.forbidden
            ? "forbidden"
            : cause?.status === 0 ||
                (typeof navigator !== "undefined" && !navigator.onLine)
              ? "offline"
              : "error",
        );
      }
    },
    [appointmentId],
  );

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 15000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  const derived = useMemo(() => {
    if (!bundle) return null;
    const { summary, appointment } = bundle;
    const sessions = (bundle.sessions ?? [])
      .slice()
      .sort((a, b) =>
        String(a.scheduledStartAt ?? "").localeCompare(
          String(b.scheduledStartAt ?? ""),
        ),
      );
    const appointmentItems = list(appointment?.items);
    const sessionByItem = new Map(
      sessions.map((session) => [session.appointmentItemId, session]),
    );
    const items = list(summary?.items).map((item) => ({
      ...item,
      appointmentItem: appointmentItems.find(
        (row) => row.id === item.appointmentItemId,
      ),
      session: sessionByItem.get(item.appointmentItemId),
    }));
    const activeItems = items.filter((item) => item.status !== "CANCELLED");
    const addedItems = activeItems.filter((item) =>
      ["ADD_SERVICE", "ADD_ON", "MANUAL"].includes(String(item.itemSource)),
    );
    const hasActiveSession =
      items.some((item) => ACTIVE_SESSION_STATUSES.has(String(item.status))) ||
      sessions.some((session) =>
        ACTIVE_SESSION_STATUSES.has(String(session.status)),
      );
    const allTerminal =
      activeItems.length > 0 &&
      activeItems.every((item) =>
        TERMINAL_ITEM_STATUSES.has(String(item.status)),
      );
    const contributionMap = new Map<string, number>();
    items.forEach((item) => {
      for (const contribution of list(item.staffContributions)) {
        const id = String(contribution.staffId ?? contribution.staff_id ?? "");
        if (id)
          contributionMap.set(
            id,
            (contributionMap.get(id) ?? 0) +
              Number(
                contribution.workSeconds ?? contribution.work_seconds ?? 0,
              ),
          );
      }
    });
    const contributions = calculatePercentages(
      Array.from(contributionMap, ([id, seconds]) => ({ id, seconds })).sort(
        (a, b) => b.seconds - a.seconds,
      ),
    );
    const serviceStart = items
      .map((item) => item.actualStartedAt ?? item.session?.actualStartedAt)
      .filter(Boolean)
      .sort()[0];
    const serviceEnd = items
      .map((item) => item.actualEndedAt ?? item.session?.actualEndedAt)
      .filter(Boolean)
      .sort()
      .at(-1);
    const plannedSeconds = items.reduce(
      (total, item) =>
        total + plannedMinutes(item, item.session, item.appointmentItem) * 60,
      0,
    );
    const actualSeconds = items.reduce(
      (total, item) =>
        total +
        Number(item.actualWorkSeconds ?? item.session?.actualWorkSeconds ?? 0),
      0,
    );
    const currency =
      summary?.pricingPreview?.currency ??
      appointment?.pricingSummary?.currency ??
      "VND";
    const subtotalMinor = pickMinor(summary?.pricingPreview, [
      "subtotalMinor",
      "subtotal",
    ]);
    const pricing = appointment?.pricingSummary ?? {};
    const totalMinor =
      pickMinor(pricing, ["amountMinor", "totalMinor", "total"]) ??
      subtotalMinor;
    const discountMinor = pickMinor(pricing, ["discountMinor", "discount"]);
    const taxMinor = pickMinor(pricing, ["taxMinor", "tax"]);
    const paidMinor =
      pickMinor(appointment, [
        "amountPaidMinor",
        "paidMinor",
        "paidAmountMinor",
      ]) ?? pickMinor(pricing, ["amountPaidMinor", "paidMinor"]);
    const depositMinor =
      pickMinor(appointment, ["depositPaidMinor", "depositAmountMinor"]) ??
      pickMinor(pricing, ["depositPaidMinor", "depositMinor"]);
    const customerName =
      summary?.customer?.displayName ??
      appointment?.contact?.displayName ??
      bundle.customer?.profile?.displayName ??
      "Khách hàng";
    const contact = bundle.customer?.contact ?? appointment?.contact ?? {};
    const authPermissions =
      bundle.authContext?.authorization?.permissions ?? [];
    const branch =
      bundle.branch ??
      bundle.authContext?.branches?.find(
        (row: any) => row.id === appointment?.branchId,
      );
    const branchActive = branch?.status === "ACTIVE";
    const canCreatePos = authPermissions.includes("pos.order.create");
    const pricingLoaded = subtotalMinor !== undefined && Boolean(currency);
    const online = typeof navigator === "undefined" || navigator.onLine;
    const systemChecks = [
      {
        label: "Tất cả dịch vụ đã hoàn thành",
        ok: Boolean(summary?.checkoutReady && allTerminal),
      },
      { label: "Không còn phiên dịch vụ đang chạy", ok: !hasActiveSession },
      { label: "Tổng tiền đã được tính", ok: pricingLoaded },
      { label: "Thông tin chi nhánh đang hoạt động", ok: branchActive },
      { label: "Có quyền tạo đơn POS", ok: canCreatePos },
      { label: "Đang có kết nối Internet", ok: online },
    ];
    const requiredChecks =
      systemChecks.every((check) => check.ok) &&
      Boolean(summary?.checkoutReady) &&
      confirmServices &&
      (!addedItems.length || confirmAddedServices) &&
      confirmAccuracy;
    return {
      summary,
      appointment,
      arrival: bundle.arrival,
      sessions,
      items,
      activeItems,
      addedItems,
      contributions,
      serviceStart,
      serviceEnd,
      plannedSeconds,
      actualSeconds,
      currency,
      subtotalMinor,
      totalMinor,
      discountMinor,
      taxMinor,
      paidMinor,
      depositMinor,
      customerName,
      contact,
      branch,
      branchActive,
      canCreatePos,
      online,
      hasActiveSession,
      allTerminal,
      pricingLoaded,
      systemChecks,
      requiredChecks,
      timezone: branch?.timezone ?? "Asia/Ho_Chi_Minh",
      paymentLabel:
        PAYMENT_STATUS_LABELS[
          String(summary?.paymentStatus ?? appointment?.paymentStatus ?? "")
        ] ?? "Chưa tạo đơn POS",
      customerActivity: bundle.customer?.activitySummary,
      membership: bundle.membership?.[0],
      loyalty: bundle.loyalty,
      vouchers: bundle.vouchers ?? [],
    };
  }, [bundle, confirmAccuracy, confirmAddedServices, confirmServices]);

  const saveNote = async () => {
    const lastSession = derived?.sessions.at(-1);
    if (!lastSession || !noteDraft.trim() || savingNote) return;
    setSavingNote(true);
    setNoteMessage("");
    try {
      await write(
        `/v1/service-sessions/${encodeURIComponent(lastSession.id)}/notes`,
        { visibility: "TECHNICIAN", note: noteDraft.trim() },
      );
      setNoteDraft("");
      setNoteMessage("Đã lưu ghi chú vào phiên dịch vụ cuối cùng.");
      await load(true);
    } catch (cause) {
      setNoteMessage(errorText(cause));
    } finally {
      setSavingNote(false);
    }
  };

  const handoff = async () => {
    if (!derived?.requiredChecks || creatingOrder) return;
    if (!stableKey.current) stableKey.current = crypto.randomUUID();
    setCreatingOrder(true);
    setHandoffMessage("");
    try {
      const result = await write(
        `/v1/appointments/${encodeURIComponent(appointmentId)}/pos-orders`,
        {},
        stableKey.current,
      );
      const orderId = result?.id ?? result?.orderId;
      if (!orderId) throw new Error("POS chưa trả về mã đơn hàng.");
      window.location.assign(
        `/admin/pos/orders/${encodeURIComponent(orderId)}`,
      );
    } catch (cause: any) {
      setHandoffMessage(errorText(cause));
      setCreatingOrder(false);
      await load(true);
    }
  };

  const tipMinor = tip || (Number(tipCustom) > 0 ? Number(tipCustom) : 0);

  return (
    <main className={styles.page}>
      <div className={styles.pageInner}>
        <div className={styles.breadcrumb}>
          <a href="/admin/appointments">Lịch hẹn</a>
          <span>/</span>
          <strong>
            {bundle?.summary?.bookingReference ?? "Tổng kết lịch hẹn"}
          </strong>
          <span>/</span>
          <span>Tổng kết dịch vụ</span>
        </div>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>LỊCH HẸN / CHECKOUT</p>
            <h1>Tổng kết lịch hẹn</h1>
            <p>
              Kiểm tra dịch vụ đã hoàn thành, thời gian thực hiện, kỹ thuật viên
              và số tiền trước khi chuyển sang thanh toán.
            </p>
          </div>
          <div className={styles.headerActions}>
            <a
              href={`/admin/appointments/${encodeURIComponent(appointmentId)}/overview`}
              className={styles.buttonSecondary}
            >
              ← Quay lại lịch hẹn
            </a>
            <button
              type="button"
              className={styles.buttonPrimary}
              onClick={() => void handoff()}
              disabled={!derived?.requiredChecks || creatingOrder}
            >
              {creatingOrder ? "Đang mở POS…" : "Chuyển sang thanh toán →"}
            </button>
          </div>
        </header>

        <StateBox state={state} error={error} retry={() => void load()} />
        {state === "ready" && derived ? (
          <>
            {bundle?.partialErrors.length ? (
              <div className={styles.partialNotice} role="status">
                <strong>Một phần dữ liệu bổ trợ chưa tải được.</strong>
                <span>{bundle.partialErrors.slice(0, 3).join(" · ")}</span>
              </div>
            ) : null}
            {handoffMessage ? (
              <div
                className={`${styles.partialNotice} ${styles.noticeDanger}`}
                role="alert"
              >
                <strong>Chưa thể chuyển sang POS.</strong>
                <span>{handoffMessage}</span>
              </div>
            ) : null}
            <section className={styles.completedHero}>
              <div className={styles.heroMark}>✓</div>
              <div className={styles.heroCustomer}>
                <p className={styles.eyebrow}>Dịch vụ đã hoàn thành</p>
                <h2>{derived.customerName}</h2>
                <div className={styles.inlineMeta}>
                  <strong>{text(derived.summary?.bookingReference)}</strong>
                  <Badge value="COMPLETED">
                    {derived.summary?.checkoutReady
                      ? "Sẵn sàng thanh toán"
                      : statusLabel(derived.summary?.status)}
                  </Badge>
                </div>
              </div>
              <div className={styles.heroMetric}>
                <span>Bắt đầu</span>
                <strong>
                  {timeOnly(derived.serviceStart, derived.timezone)}
                </strong>
              </div>
              <div className={styles.heroMetric}>
                <span>Hoàn thành</span>
                <strong>
                  {timeOnly(derived.serviceEnd, derived.timezone)}
                </strong>
              </div>
              <div className={styles.heroMetric}>
                <span>
                  {derived.arrival
                    ? "Tổng thời gian tại salon"
                    : "Tổng thời gian phục vụ"}
                </span>
                <strong>
                  {duration(
                    derived.arrival?.arrivedAt
                      ? secondsBetween(
                          derived.arrival.arrivedAt,
                          derived.serviceEnd,
                        )
                      : derived.actualSeconds || derived.plannedSeconds,
                  )}
                </strong>
              </div>
            </section>

            <section
              className={styles.progressCard}
              aria-label="Tiến trình lịch hẹn"
            >
              {[
                [
                  "Đặt lịch",
                  true,
                  dateTime(derived.appointment?.createdAt, derived.timezone),
                ],
                ["Đã xác nhận", true, ""],
                [
                  "Check-in",
                  Boolean(
                    derived.arrival ||
                    [
                      "CHECKED_IN",
                      "IN_SERVICE",
                      "PARTIALLY_COMPLETED",
                      "COMPLETED",
                    ].includes(derived.appointment?.status),
                  ),
                  "",
                ],
                [
                  "Đang phục vụ",
                  Boolean(derived.actualSeconds || derived.serviceStart),
                  "",
                ],
                [
                  "Hoàn thành",
                  Boolean(
                    derived.summary?.checkoutReady || derived.allTerminal,
                  ),
                  "",
                ],
                ["Thanh toán", false, "Sẵn sàng tại POS"],
              ].map(([label, done, detail], index) => (
                <div
                  className={`${styles.progressStep} ${done ? styles.progressDone : ""}`}
                  key={String(label)}
                >
                  <span className={styles.progressDot}>
                    {done ? "✓" : index + 1}
                  </span>
                  <strong>{label}</strong>
                  <small>
                    {text(detail, index === 5 ? "Chưa thanh toán" : "")}
                  </small>
                </div>
              ))}
            </section>

            <div className={styles.workspaceGrid}>
              <div className={styles.mainColumn}>
                <Card
                  title="Dịch vụ đã hoàn thành"
                  action={
                    <span className={styles.cardHint}>
                      {derived.activeItems.length} dịch vụ ·{" "}
                      {durationMinutes(derived.plannedSeconds / 60)} dự kiến
                    </span>
                  }
                >
                  <div className={styles.serviceList}>
                    {derived.items.map((item: any) => (
                      <article
                        className={styles.serviceRow}
                        key={item.appointmentItemId}
                      >
                        <div className={styles.serviceIcon}>
                          {item.status === "CANCELLED" ? "×" : "✦"}
                        </div>
                        <div className={styles.serviceInfo}>
                          <strong>
                            {serviceName(
                              item.serviceSnapshot ??
                                item.service ??
                                item.appointmentItem?.service,
                            )}
                          </strong>
                          <small>
                            {item.itemSource && item.itemSource !== "BOOKING"
                              ? sourceLabel(item.itemSource)
                              : "Dịch vụ trong lịch"}
                          </small>
                        </div>
                        <div className={styles.serviceTime}>
                          <span>Dự kiến</span>
                          <strong>
                            {durationMinutes(
                              plannedMinutes(
                                item,
                                item.session,
                                item.appointmentItem,
                              ),
                            )}
                          </strong>
                        </div>
                        <div className={styles.serviceTime}>
                          <span>Thực tế</span>
                          <strong>
                            {durationMinutes(
                              Number(
                                item.actualWorkSeconds ??
                                  item.session?.actualWorkSeconds ??
                                  0,
                              ) / 60,
                            )}
                          </strong>
                        </div>
                        <div className={styles.servicePrice}>
                          {money(priceMinor(item), derived.currency)}
                        </div>
                        <Badge value={item.status}>
                          {statusLabel(item.status)}
                        </Badge>
                      </article>
                    ))}
                    {!derived.items.length ? (
                      <div className={styles.emptyInline}>
                        Checkout summary chưa trả về dòng dịch vụ.
                      </div>
                    ) : null}
                  </div>
                  <div className={styles.serviceTotals}>
                    <strong>{derived.activeItems.length} dịch vụ</strong>
                    <strong>
                      {durationMinutes(derived.plannedSeconds / 60)} dự kiến
                    </strong>
                    <strong>
                      {durationMinutes(derived.actualSeconds / 60)} thực tế
                    </strong>
                    <strong className={styles.totalAccent}>
                      {money(derived.subtotalMinor, derived.currency)}
                    </strong>
                  </div>
                </Card>

                <div className={styles.twoColumn}>
                  <Card title="Kỹ thuật viên thực hiện">
                    {derived.contributions.length ? (
                      <div className={styles.staffList}>
                        {derived.contributions.map((row: any) => (
                          <div className={styles.staffRow} key={row.id}>
                            <Avatar
                              name={staffDisplay(bundle?.staff, row.id)}
                              small
                            />
                            <div>
                              <strong>
                                {staffDisplay(bundle?.staff, row.id)}
                              </strong>
                              <small>{duration(row.seconds)} thực hiện</small>
                            </div>
                            <div className={styles.staffShare}>
                              <b>{row.percent}%</b>
                              <span>
                                <i style={{ width: `${row.percent}%` }} />
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className={styles.emptyInline}>
                        Chưa có phân bổ thời gian kỹ thuật viên trong dữ liệu
                        phiên.
                      </div>
                    )}
                    <p className={styles.helper}>
                      Phần trăm được tính từ tổng work seconds thực tế của các
                      phiên.
                    </p>
                  </Card>
                  <Card title="Ghi chú sau dịch vụ">
                    <div className={styles.noteList}>
                      {Object.values(bundle?.notes ?? {})
                        .flat()
                        .slice(-4)
                        .map((note: any) => (
                          <div className={styles.notePill} key={note.id}>
                            {text(note.note)}
                          </div>
                        ))}
                    </div>
                    {derived.sessions.length ? (
                      <>
                        <textarea
                          className={styles.noteInput}
                          value={noteDraft}
                          onChange={(event) => setNoteDraft(event.target.value)}
                          maxLength={2000}
                          placeholder="Thêm ghi chú cuối phiên…"
                        />
                        <div className={styles.noteFooter}>
                          <small>
                            {noteDraft.length}/2000 · lưu vào phiên dịch vụ cuối
                          </small>
                          <button
                            type="button"
                            className={styles.buttonOutline}
                            onClick={() => void saveNote()}
                            disabled={!noteDraft.trim() || savingNote}
                          >
                            {savingNote ? "Đang lưu…" : "Lưu ghi chú"}
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className={styles.helper}>
                        Chưa có phiên dịch vụ để ghi chú.
                      </p>
                    )}
                    {noteMessage ? (
                      <p className={styles.inlineStatus} role="status">
                        {noteMessage}
                      </p>
                    ) : null}
                  </Card>
                </div>

                <Card
                  title="Xác nhận trước khi thanh toán"
                  className={styles.confirmCard}
                >
                  <label className={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={confirmServices}
                      onChange={(event) =>
                        setConfirmServices(event.target.checked)
                      }
                    />
                    <span>
                      <strong>Tôi đã kiểm tra đủ dịch vụ đã hoàn thành.</strong>
                      <small>
                        Các dòng dịch vụ lấy từ snapshot lịch hẹn và checkout
                        summary.
                      </small>
                    </span>
                  </label>
                  {derived.addedItems.length ? (
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={confirmAddedServices}
                        onChange={(event) =>
                          setConfirmAddedServices(event.target.checked)
                        }
                      />
                      <span>
                        <strong>Tôi đã kiểm tra các dịch vụ được thêm.</strong>
                        <small>
                          {derived.addedItems.length} dịch vụ thêm sẽ được
                          chuyển sang POS.
                        </small>
                      </span>
                    </label>
                  ) : null}
                  <label className={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={confirmAccuracy}
                      onChange={(event) =>
                        setConfirmAccuracy(event.target.checked)
                      }
                    />
                    <span>
                      <strong>
                        Tôi xác nhận số tiền, thời gian và kỹ thuật viên hiển
                        thị là chính xác.
                      </strong>
                      <small>
                        POS sẽ tính lại giá cuối cùng trước khi thu tiền.
                      </small>
                    </span>
                  </label>
                  <div className={styles.readonlyNotice}>
                    Chuyển sang POS chỉ tạo hoặc mở lại đơn nháp. Chưa ghi nhận
                    thanh toán ở màn này.
                  </div>
                </Card>

                <Card title="Bước tiếp theo" className={styles.nextStepCard}>
                  <div className={styles.nextStepList}>
                    <div className={`${styles.nextStepRow} ${styles.nextStepCurrent}`}>
                      <span className={styles.nextStepNumber}>1</span>
                      <div>
                        <strong>Tạo đơn POS</strong>
                        <small>
                          Chuyển các dịch vụ đã hoàn thành và giá hiện tại sang POS.
                        </small>
                      </div>
                    </div>
                    <div className={styles.nextStepRow}>
                      <span className={styles.nextStepNumber}>2</span>
                      <div>
                        <strong>Thu tiền</strong>
                        <small>POS sẽ tính lại chiết khấu, thuế và số tiền cuối.</small>
                      </div>
                    </div>
                    <div className={styles.nextStepRow}>
                      <span className={styles.nextStepNumber}>3</span>
                      <div>
                        <strong>Xuất hóa đơn / biên nhận</strong>
                        <small>Thực hiện tiếp trong POS sau khi thanh toán thành công.</small>
                      </div>
                    </div>
                  </div>
                  <p className={styles.helper}>
                    Nút “Chuyển sang thanh toán” chỉ mở hoặc tạo đơn POS; không ghi nhận
                    thanh toán trực tiếp tại màn này.
                  </p>
                </Card>
              </div>

              <aside className={styles.sideColumn}>
                <Card title="Khách hàng">
                  <div className={styles.customerHeader}>
                    <Avatar name={derived.customerName} />
                    <div>
                      <h3>{derived.customerName}</h3>
                      <div className={styles.tagRow}>
                        {derived.membership ? (
                          <span className={styles.tag}>
                            {displayValue(
                              derived.membership.tierName ??
                                derived.membership.code,
                            )}
                          </span>
                        ) : null}
                        {derived.customerActivity?.completedVisitCount ? (
                          <span className={styles.tagSuccess}>
                            Khách quay lại
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <dl className={styles.detailList}>
                    <div>
                      <dt>Số điện thoại</dt>
                      <dd>{text(derived.contact.phone)}</dd>
                    </div>
                    <div>
                      <dt>Email</dt>
                      <dd>{text(derived.contact.email)}</dd>
                    </div>
                    <div>
                      <dt>Số lần hoàn thành</dt>
                      <dd>
                        {text(derived.customerActivity?.completedVisitCount)}
                      </dd>
                    </div>
                    <div>
                      <dt>Tích điểm hiện có</dt>
                      <dd>{text(derived.loyalty?.availablePoints)}</dd>
                    </div>
                  </dl>
                  <div className={styles.actionRow}>
                    <a
                      href={`/admin/customers/${encodeURIComponent(derived.summary?.customer?.id ?? derived.appointment?.customerId ?? "")}`}
                      className={styles.buttonOutline}
                    >
                      Xem hồ sơ
                    </a>
                    <a
                      href={`tel:${derived.contact.phone ?? ""}`}
                      className={styles.buttonOutline}
                    >
                      Liên hệ
                    </a>
                  </div>
                </Card>

                <Card
                  title="Ưu đãi & quyền lợi"
                  action={
                    <span className={styles.cardHint}>
                      {derived.vouchers.length} voucher
                    </span>
                  }
                >
                  <div className={styles.benefitRows}>
                    <div>
                      <span>Điểm tích lũy</span>
                      <strong>{text(derived.loyalty?.availablePoints)}</strong>
                    </div>
                    <div>
                      <span>Hạng khách hàng</span>
                      <strong>
                        {displayValue(
                          derived.membership?.tierName ??
                            derived.membership?.code,
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>Voucher khả dụng</span>
                      <strong>{derived.vouchers.length || "—"}</strong>
                    </div>
                  </div>
                  <p className={styles.helper}>
                    Ưu đãi sẽ được áp dụng và kiểm tra trong POS.
                  </p>
                  <div className={styles.actionRow}>
                    <button
                      type="button"
                      className={styles.buttonOutline}
                      disabled
                    >
                      Áp dụng ưu đãi
                    </button>
                    <button
                      type="button"
                      className={styles.buttonOutline}
                      disabled
                    >
                      Xem quyền lợi
                    </button>
                  </div>
                </Card>

                <Card title="Tóm tắt thanh toán" className={styles.paymentCard}>
                  <dl className={styles.paymentList}>
                    <div>
                      <dt>Tạm tính</dt>
                      <dd>{money(derived.subtotalMinor, derived.currency)}</dd>
                    </div>
                    <div>
                      <dt>Giảm giá</dt>
                      <dd>
                        {derived.discountMinor == null
                          ? "Tính tại POS"
                          : money(derived.discountMinor, derived.currency)}
                      </dd>
                    </div>
                    <div>
                      <dt>Thuế</dt>
                      <dd>
                        {derived.taxMinor == null
                          ? "Tính tại POS"
                          : money(derived.taxMinor, derived.currency)}
                      </dd>
                    </div>
                    <div className={styles.paymentTotal}>
                      <dt>Tổng cộng dự kiến</dt>
                      <dd>{money(derived.totalMinor, derived.currency)}</dd>
                    </div>
                  </dl>
                  <Badge
                    value={
                      derived.summary?.checkoutReady
                        ? "READY_FOR_CHECKOUT"
                        : "PENDING"
                    }
                  >
                    {derived.summary?.checkoutReady
                      ? "Sẵn sàng thanh toán"
                      : "Chưa checkout"}
                  </Badge>
                </Card>

                <Card
                  title="Tiền tip"
                  action={
                    <span className={styles.cardHint}>
                      Chỉ là ý định tại màn này
                    </span>
                  }
                >
                  <div className={styles.tipGrid}>
                    {[0, 50000, 100000, 150000].map((amount) => (
                      <button
                        type="button"
                        key={amount}
                        className={
                          tip === amount && !tipCustom
                            ? styles.tipActive
                            : styles.tipButton
                        }
                        onClick={() => {
                          setTip(amount);
                          setTipCustom("");
                        }}
                      >
                        {amount ? money(amount, derived.currency) : "Không tip"}
                      </button>
                    ))}
                  </div>
                  <div className={styles.tipCustom}>
                    <label htmlFor="tip-custom">Khác</label>
                    <input
                      id="tip-custom"
                      inputMode="numeric"
                      value={tipCustom}
                      onChange={(event) => {
                        setTipCustom(event.target.value.replace(/\D/g, ""));
                        setTip(0);
                      }}
                      placeholder="0"
                    />
                    <strong>
                      {tipMinor ? money(tipMinor, derived.currency) : "—"}
                    </strong>
                  </div>
                  <p className={styles.helper}>
                    Tip chưa được gửi lên server và sẽ chỉ được xử lý sau khi có
                    đơn POS.
                  </p>
                </Card>

                <Card
                  title="Kiểm tra trước khi thanh toán"
                  action={
                    <Badge
                      value={derived.requiredChecks ? "COMPLETED" : "PENDING"}
                    >
                      {derived.requiredChecks ? "Sẵn sàng" : "Cần kiểm tra"}
                    </Badge>
                  }
                >
                  <ul className={styles.checkList}>
                    {derived.systemChecks.map((check) => (
                      <li
                        className={check.ok ? styles.checkOk : styles.checkFail}
                        key={check.label}
                      >
                        <span>{check.ok ? "✓" : "!"}</span>
                        {check.label}
                      </li>
                    ))}
                  </ul>
                  {!derived.summary?.checkoutReady ? (
                    <p className={styles.blocker}>
                      Backend chưa đánh dấu lịch hẹn checkout-ready.
                    </p>
                  ) : null}
                  {derived.hasActiveSession ? (
                    <p className={styles.blocker}>
                      Vẫn còn phiên dịch vụ đang chạy hoặc chờ xử lý.
                    </p>
                  ) : null}
                  {!derived.canCreatePos ? (
                    <p className={styles.blocker}>
                      Tài khoản hiện tại chưa có quyền tạo đơn POS.
                    </p>
                  ) : null}
                </Card>

                <Card title="Thao tác nhanh">
                  <div className={styles.quickActions}>
                    <a
                      className={styles.buttonOutline}
                      href={
                        derived.appointment?.status === "COMPLETED"
                          ? undefined
                          : `/admin/appointments/${encodeURIComponent(appointmentId)}/add-service`
                      }
                      aria-disabled={
                        derived.appointment?.status === "COMPLETED"
                      }
                      onClick={(event) => {
                        if (derived.appointment?.status === "COMPLETED")
                          event.preventDefault();
                      }}
                    >
                      + Thêm dịch vụ{" "}
                      {derived.appointment?.status === "COMPLETED"
                        ? "(đã hoàn thành)"
                        : ""}
                    </a>
                    <button
                      type="button"
                      className={styles.buttonPrimary}
                      onClick={() => void handoff()}
                      disabled={!derived.requiredChecks || creatingOrder}
                    >
                      {creatingOrder
                        ? "Đang mở POS…"
                        : "Chuyển sang thanh toán"}
                    </button>
                  </div>
                </Card>
              </aside>
            </div>
          </>
        ) : null}
      </div>
      {state === "ready" && derived ? (
        <footer className={styles.stickyFooter}>
          <a
            href={`/admin/appointments/${encodeURIComponent(appointmentId)}/overview`}
            className={styles.buttonSecondary}
          >
            ← Quay lại chi tiết lịch hẹn
          </a>
          <div>
            <button
              type="button"
              className={styles.buttonSecondary}
              onClick={() => void load(true)}
            >
              Lưu & xem sau
            </button>
            <button
              type="button"
              className={styles.buttonPrimary}
              onClick={() => void handoff()}
              disabled={!derived.requiredChecks || creatingOrder}
            >
              {creatingOrder
                ? "Đang mở POS…"
                : `Chuyển sang thanh toán · ${money(derived.totalMinor, derived.currency)} →`}
            </button>
          </div>
        </footer>
      ) : null}
    </main>
  );
}

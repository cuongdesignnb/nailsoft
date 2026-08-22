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
import { authorizedFetch, getAuthContext } from "../auth";
import styles from "./pos-checkout-workspace.module.css";
import PosReceiptSuccessPage from "./pos-receipt-success";

type WorkspaceMode = "order" | "payment" | "receipt";
type LoadState = "loading" | "ready" | "error" | "forbidden" | "offline";
type TenderType = "CASH" | "CARD_EXTERNAL" | "BANK_TRANSFER";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Đang chuẩn bị đơn",
  READY_FOR_PAYMENT: "Sẵn sàng thu tiền",
  PARTIALLY_PAID: "Đã thu một phần",
  PAID: "Đã thanh toán",
  VOIDED: "Đã hủy",
  EXPIRED: "Đã hết hạn",
};

const TENDER_LABELS: Record<TenderType, string> = {
  CASH: "Tiền mặt",
  CARD_EXTERNAL: "Thẻ",
  BANK_TRANSFER: "Chuyển khoản",
};

function apiError(error: any) {
  const code = String(error?.code ?? "");
  const messages: Record<string, string> = {
    POS_ORDER_NOT_FOUND: "Không tìm thấy đơn POS.",
    POS_ORDER_REGISTER_REQUIRED: "Cần gán quầy thu ngân trước khi tiếp tục.",
    POS_ORDER_PRICING_LOCKED: "Giá của đơn đã được chốt và không thể sửa.",
    POS_ORDER_VERSION_CONFLICT:
      "Đơn vừa được cập nhật bởi người khác. Dữ liệu mới nhất đã được tải lại.",
    PAYMENT_EXCEEDS_AMOUNT_DUE:
      "Số tiền áp dụng vượt quá số tiền còn phải thu. Dữ liệu đã được tải lại.",
    PAYMENT_PARTIAL_NOT_ALLOWED: "Đơn này không cho phép thanh toán một phần.",
    PAYMENT_CASH_SESSION_REQUIRED:
      "Cần mở ca tiền mặt tại đúng quầy trước khi thu tiền.",
    PAYMENT_REGISTER_MISMATCH:
      "Ca tiền mặt không thuộc quầy đang xử lý đơn này.",
    PAYMENT_CASH_SESSION_MISMATCH:
      "Các khoản tiền mặt tiếp theo phải dùng cùng ca tiền mặt ban đầu.",
    CASH_SESSION_CURRENCY_MISMATCH:
      "Loại tiền của ca tiền mặt không khớp với đơn hàng.",
    PAYMENT_PROVIDER_DISABLED:
      "Phương thức thanh toán ngoài hiện đang bị tắt theo cấu hình hệ thống.",
    PAYMENT_PROVIDER_REFERENCE_REUSED:
      "Mã giao dịch này đã được ghi nhận trước đó.",
    FINANCIAL_BRANCH_INACTIVE: "Chi nhánh đang tạm ngưng hoạt động.",
    FINANCIAL_PERMISSION_DENIED:
      "Tài khoản hiện tại không có quyền thực hiện thao tác tài chính này.",
    POS_ORDER_NOT_CHECKOUT_READY:
      "Lịch hẹn chưa sẵn sàng để tạo đơn POS.",
  };
  return messages[code] ?? error?.message ?? "Không thể hoàn tất thao tác.";
}

function text(value: unknown, fallback = "—") {
  if (value == null || value === "") return fallback;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    return String(item["vi-VN"] ?? item.vi ?? item.en ?? item.name ?? fallback);
  }
  return fallback;
}

function money(value: unknown, currency = "VND") {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "VND" ? 0 : 2,
  }).format(amount / (currency === "VND" ? 1 : 100));
}

function parseMinor(value: string) {
  const normalized = value.replace(/[^0-9]/g, "");
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function formatDateTime(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function displayName(snapshot: any, fallback = "Khách hàng") {
  return text(
    snapshot?.displayName ?? snapshot?.name ?? snapshot?.fullName,
    fallback,
  );
}

function serviceLabel(line: any) {
  return text(
    line?.description?.name ??
      line?.description?.displayName ??
      line?.description,
    "Dịch vụ",
  );
}

function sourceLabel(line: any) {
  const source = line?.sourceSnapshot?.itemSource;
  if (["ADD_SERVICE", "ADD_ON", "MANUAL"].includes(String(source)))
    return "Dịch vụ thêm";
  return "Dịch vụ trong lịch hẹn";
}

function staffLabel(line: any, staff: any[]) {
  const contributions = Array.isArray(line?.sourceSnapshot?.staffContributions)
    ? line.sourceSnapshot.staffContributions
    : [];
  const names = contributions
    .map((item: any) => staff.find((row) => row.id === item.staffId)?.displayName)
    .filter(Boolean);
  return names.length ? names.join(" · ") : "Kỹ thuật viên theo snapshot";
}

function stateTone(status: string) {
  if (status === "PAID") return "success";
  if (status === "PARTIALLY_PAID") return "warning";
  if (status === "READY_FOR_PAYMENT") return "live";
  if (["VOIDED", "EXPIRED"].includes(status)) return "danger";
  return "neutral";
}

function Card({
  title,
  action,
  children,
  className = "",
  id,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
  id?: string;
}) {
  return (
    <section id={id} className={`${styles.card} ${className}`}>
      <header className={styles.cardHeader}>
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function Badge({ value, children }: { value: string; children: ReactNode }) {
  return (
    <span className={`${styles.badge} ${styles[`tone${stateTone(value).replace(/^./, (char) => char.toUpperCase())}`]}`}>
      {children}
    </span>
  );
}

function StatePanel({
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
      <div className={styles.statePanel} role="status">
        <span className={styles.spinner} /> Đang tải dữ liệu đơn POS…
      </div>
    );
  if (state === "forbidden")
    return (
      <div className={`${styles.statePanel} ${styles.stateDanger}`} role="alert">
        <strong>Không có quyền xem đơn POS</strong>
        <span>{error}</span>
        <button type="button" className={styles.buttonSecondary} onClick={retry}>
          Thử lại
        </button>
      </div>
    );
  if (state === "offline")
    return (
      <div className={styles.statePanel} role="alert">
        <strong>Đang offline</strong>
        <span>Cần kết nối Internet để xử lý thao tác tài chính.</span>
        <button type="button" className={styles.buttonSecondary} onClick={retry}>
          Thử lại
        </button>
      </div>
    );
  if (state === "error")
    return (
      <div className={`${styles.statePanel} ${styles.stateDanger}`} role="alert">
        <strong>Không thể tải đơn POS</strong>
        <span>{error}</span>
        <button type="button" className={styles.buttonSecondary} onClick={retry}>
          Tải lại
        </button>
      </div>
    );
  return null;
}

export default function PosCheckoutWorkspace({
  orderId,
  mode = "order",
}: {
  orderId: string;
  mode?: WorkspaceMode;
}) {
  const [order, setOrder] = useState<any>(null);
  const [registers, setRegisters] = useState<any[]>([]);
  const [cashSessions, setCashSessions] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [authContext, setAuthContext] = useState<any>(null);
  const [invoicePrint, setInvoicePrint] = useState<any>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [partialErrors, setPartialErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [selectedTender, setSelectedTender] = useState<TenderType>("CASH");
  const [selectedCashSessionId, setSelectedCashSessionId] = useState("");
  const [cashReceivedMinor, setCashReceivedMinor] = useState("");
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitAmountMinor, setSplitAmountMinor] = useState("");
  const [externalReference, setExternalReference] = useState("");
  const [cardLast4, setCardLast4] = useState("");
  const [bankEvidenceNote, setBankEvidenceNote] = useState("Đã xác nhận tại quầy");
  const [discountType, setDiscountType] = useState<"FIXED" | "PERCENT">("FIXED");
  const [discountValue, setDiscountValue] = useState("");
  const [discountNote, setDiscountNote] = useState("");
  const [tipCustom, setTipCustom] = useState("");
  const [emailReceipt, setEmailReceipt] = useState(true);
  const [printReceipt, setPrintReceipt] = useState(false);
  const [selectedRegisterId, setSelectedRegisterId] = useState("");
  const intentKeys = useRef<Record<string, string>>({});

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const response = await authorizedFetch(path, init);
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      throw Object.assign(new Error(body.error?.message ?? "Permission denied"), {
        forbidden: true,
        code: body.error?.code,
      });
    }
    if (!response.ok)
      throw Object.assign(new Error(body.error?.message ?? "Request failed"), {
        code: body.error?.code,
        status: response.status,
      });
    return body.data;
  }, []);

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setState("offline");
        return;
      }
      const nextOrder = await api(`/v1/pos-orders/${encodeURIComponent(orderId)}`);
      const [registerResult, sessionResult, staffResult, contextResult] =
        await Promise.allSettled([
          api(`/v1/pos-registers?branchId=${encodeURIComponent(nextOrder.branchId)}`),
          api("/v1/cash-sessions?status=OPEN"),
          api("/v1/staff?status=ACTIVE"),
          getAuthContext(),
        ]);
      const errors: string[] = [];
      if (registerResult.status === "fulfilled") setRegisters(registerResult.value ?? []);
      else errors.push("Không tải được danh sách quầy.");
      if (sessionResult.status === "fulfilled") setCashSessions(sessionResult.value ?? []);
      else errors.push("Không tải được ca tiền mặt.");
      if (staffResult.status === "fulfilled") setStaff(staffResult.value ?? []);
      if (contextResult.status === "fulfilled") setAuthContext(contextResult.value);
      else errors.push("Không tải được quyền thao tác.");
      setOrder(nextOrder);
      if (mode === "receipt" && nextOrder.invoice?.id) {
        try {
          setInvoicePrint(await api(`/v1/invoices/${nextOrder.invoice.id}/print`));
        } catch {
          setInvoicePrint(null);
          errors.push("Biên nhận chưa sẵn sàng.");
        }
      }
      setPartialErrors(errors);
      setState("ready");
    } catch (cause: any) {
      setError(apiError(cause));
      setState(cause?.forbidden ? "forbidden" : cause?.status === 0 ? "offline" : "error");
    }
  }, [api, mode, orderId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const command = useCallback(
    async (intent: string, path: string, payload: unknown) => {
      const signature = `${intent}:${JSON.stringify(payload)}`;
      const key = intentKeys.current[signature] ?? crypto.randomUUID();
      intentKeys.current[signature] = key;
      const result = await api(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": key,
        },
        body: JSON.stringify(payload),
      });
      delete intentKeys.current[signature];
      return result;
    },
    [api],
  );

  const status = String(order?.status ?? "");
  const isDraft = status === "DRAFT";
  const isPayable = ["READY_FOR_PAYMENT", "PARTIALLY_PAID"].includes(status);
  const isPaid = status === "PAID";
  const canEditPricing = isDraft;
  const currency = order?.currency ?? "VND";
  const dueMinor = Number(order?.amountDueMinor ?? 0);
  const cashReceived = parseMinor(cashReceivedMinor);
  const splitAmount = Math.min(parseMinor(splitAmountMinor), dueMinor);
  const amountToApply = splitEnabled ? splitAmount : dueMinor;
  const partialAllowed = order?.paymentCapabilities?.partialPaymentsAllowed === true;
  const permissions = authContext?.authorization?.permissions ?? [];
  const canDiscount = permissions.includes("pos.discount.apply") || !authContext;
  const canTip = permissions.includes("pos.tip.set") || !authContext;
  const canFinalize = permissions.includes("pos.order.finalize") || !authContext;
  const canCaptureCash = permissions.includes("payment.capture_cash") || !authContext;
  const canExternal = permissions.includes("payment.record_external");
  const pendingApproval = (order?.approvalRequests ?? []).some(
    (item: any) => item.status === "PENDING",
  );
  const register = registers.find((item) => item.id === order?.registerId);
  const validCashSessions = cashSessions.filter(
    (item) =>
      item.status === "OPEN" &&
      item.registerId === order?.registerId &&
      item.branchId === order?.branchId,
  );
  const selectedCashSession = validCashSessions.find(
    (item) => item.id === selectedCashSessionId,
  );
  const cashReady = Boolean(selectedCashSession && canCaptureCash);
  const externalReady = canExternal;
  const cashSufficient = selectedTender !== "CASH" || (cashReady && cashReceived >= amountToApply);
  const paymentReady =
    isPayable &&
    Boolean(order?.registerId) &&
    amountToApply > 0 &&
    (selectedTender === "CASH" ? cashSufficient : externalReady && Boolean(externalReference.trim()));
  const finalizeReady = isDraft && Boolean(order?.registerId) && canFinalize && !pendingApproval;
  const previewChange = selectedTender === "CASH" && cashReceived >= amountToApply
    ? cashReceived - amountToApply
    : 0;

  useEffect(() => {
    if (!order) return;
    const due = Number(order.amountDueMinor ?? 0);
    setCashReceivedMinor(String(due));
    setSplitAmountMinor(String(due));
    setSelectedCashSessionId((current) =>
      validCashSessions.some((item) => item.id === current)
        ? current
        : validCashSessions.length === 1
          ? validCashSessions[0].id
          : "",
    );
  }, [order?.id, order?.version, order?.amountDueMinor, validCashSessions]);

  const quickCashAmounts = useMemo(() => {
    const due = Number(order?.amountDueMinor ?? 0);
    if (!due) return [];
    const ceil = (step: number) => Math.ceil(due / step) * step;
    return Array.from(new Set([due, ceil(50000), ceil(100000), ceil(500000)]))
      .filter((value) => value >= due)
      .slice(0, 4);
  }, [order?.amountDueMinor]);

  const mutate = async (
    action: string,
    path: string,
    payload: unknown,
    successMessage: string,
  ) => {
    if (busyAction) return;
    setBusyAction(action);
    setMessage("");
    try {
      await command(action, path, payload);
      setMessage(successMessage);
      await load();
    } catch (cause: any) {
      setMessage(apiError(cause));
      if (String(cause?.code ?? "").includes("VERSION")) await load();
    } finally {
      setBusyAction("");
    }
  };

  const assignRegister = () => {
    if (!order || !selectedRegisterId) return;
    void mutate(
      "assign-register",
      `/v1/pos-orders/${orderId}/assign-register`,
      { version: order.version, registerId: selectedRegisterId },
      "Đã gán quầy thu ngân cho đơn.",
    );
  };
  useEffect(() => {
    if (order?.registerId) setSelectedRegisterId(order.registerId);
  }, [order?.registerId]);

  const applyDiscount = () => {
    if (!order || !discountValue || !canEditPricing || !canDiscount) return;
    void mutate(
      "discount",
      `/v1/pos-orders/${orderId}/discounts`,
      {
        version: order.version,
        discountType,
        value: Number(discountValue),
        reasonCode: "CUSTOMER_CARE",
        ...(discountNote.trim() ? { note: discountNote.trim() } : {}),
      },
      "Đã gửi yêu cầu ưu đãi; hệ thống sẽ cập nhật theo quyền phê duyệt.",
    );
  };

  const setTip = (amountMinor: number) => {
    if (!order || !canEditPricing || !canTip) return;
    void mutate(
      "tip",
      `/v1/pos-orders/${orderId}/tip`,
      {
        version: order.version,
        amountMinor,
        source: "CASHIER_ENTRY",
        allocationBasis: "WORK_SECONDS",
      },
      "Đã cập nhật tiền tip theo thời gian thực tế của kỹ thuật viên.",
    );
  };

  const finalize = () => {
    if (!order || !finalizeReady) return;
    void mutate(
      "finalize",
      `/v1/pos-orders/${orderId}/finalize`,
      { version: order.version },
      "Đơn đã chốt giá và sẵn sàng thu tiền.",
    );
  };

  const capturePayment = () => {
    if (!order || !paymentReady || busyAction) return;
    const payload: Record<string, unknown> = {
      version: order.version,
      tenderType: selectedTender,
      amountToApplyMinor: amountToApply,
    };
    if (selectedTender === "CASH") {
      payload.cashReceivedMinor = cashReceived;
      payload.cashSessionId = selectedCashSessionId;
    } else if (selectedTender === "CARD_EXTERNAL") {
      payload.provider = "manual-terminal";
      payload.providerTransactionId = externalReference.trim();
      if (cardLast4) payload.cardLast4 = cardLast4;
    } else {
      payload.providerTransactionId = externalReference.trim();
      payload.receivedAt = new Date().toISOString();
      payload.evidenceNote = bankEvidenceNote.trim() || "Đã xác nhận tại quầy";
    }
    void mutate(
      `payment-${selectedTender}-${amountToApply}-${cashReceived}-${selectedCashSessionId}-${externalReference}`,
      `/v1/pos-orders/${orderId}/payments`,
      payload,
      selectedTender === "CASH"
        ? "Đã ghi nhận tiền mặt; đơn đã được tải lại từ máy chủ."
        : "Đã ghi nhận bằng chứng thanh toán ngoài.",
    );
  };

  const deliverEmail = () => {
    if (!order?.invoice?.id || !order?.customerSnapshot?.email) return;
    void mutate(
      "invoice-email",
      `/v1/invoices/${order.invoice.id}/deliver`,
      { channel: "EMAIL", destination: order.customerSnapshot.email },
      "Đã gửi yêu cầu gửi biên nhận qua email.",
    );
  };

  const appointment = order?.appointmentSnapshot ?? {};
  const customer = order?.customerSnapshot ?? {};
  const lineItems = order?.lines ?? [];
  const membership = order?.membership ?? null;
  const loyalty = order?.loyalty ?? null;
  const tipMinor = Number(order?.tipMinor ?? 0);

  if (mode === "receipt") return <PosReceiptSuccessPage orderId={orderId} />;

  if (state !== "ready" || !order) {
    return (
      <main className={styles.page}>
        <div className={styles.pageInner}>
          <StatePanel state={state} error={error} retry={() => void load()} />
        </div>
      </main>
    );
  }

  if ((mode as string) === "receipt") {
    return (
      <main className={styles.page}>
        <div className={styles.pageInner}>
          <div className={styles.breadcrumb}>
            <a href={`/admin/pos/orders/${orderId}`}>POS</a>
            <span>/</span>
            <strong>Biên nhận</strong>
          </div>
          <div className={styles.pageHeader}>
            <div>
              <p className={styles.eyebrow}>POS / BIÊN NHẬN</p>
              <h1>Biên nhận thanh toán</h1>
              <p>Chứng từ được đọc từ invoice đã phát hành.</p>
            </div>
            <a className={styles.buttonSecondary} href={`/admin/pos/orders/${orderId}`}>
              ← Quay lại đơn POS
            </a>
          </div>
          {order.status !== "PAID" || order.invoice?.status !== "ISSUED" || !invoicePrint ? (
            <div className={`${styles.statePanel} ${styles.stateWarning}`} role="alert">
              <strong>Biên nhận chưa sẵn sàng</strong>
              <span>Chỉ đơn đã thanh toán và invoice đã phát hành mới có thể xem biên nhận.</span>
            </div>
          ) : (
            <ReceiptCard data={invoicePrint} currency={currency} />
          )}
        </div>
      </main>
    );
  }

  const heroAction = isDraft
    ? { label: "Chốt đơn để thanh toán", onClick: finalize, disabled: !finalizeReady }
    : isPayable
      ? { label: `Hoàn tất thanh toán · ${money(dueMinor, currency)}`, onClick: capturePayment, disabled: !paymentReady }
      : isPaid
        ? { label: "Mở biên nhận", onClick: () => (window.location.href = `/admin/pos/orders/${orderId}/receipt`), disabled: false }
        : null;

  return (
    <main className={styles.page}>
      <div className={styles.pageInner}>
        <div className={styles.breadcrumb}>
          <a href="/admin/pos">POS</a>
          <span>/</span>
          <strong>Thanh toán</strong>
          <span>/</span>
          <span>Từ lịch hẹn #{text(appointment.bookingReference, "—")}</span>
        </div>
        <div className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>POS / THANH TOÁN</p>
            <h1>Thanh toán</h1>
            <p>Thu tiền cho lịch hẹn đã hoàn thành, kiểm tra dịch vụ, ưu đãi và phương thức thanh toán.</p>
          </div>
          <div className={styles.headerActions}>
            <a className={styles.buttonSecondary} href={`/admin/appointments/${order.appointmentId ?? ""}/checkout-summary`}>
              ← Quay lại tổng kết lịch hẹn
            </a>
            {heroAction ? (
              <button type="button" className={styles.buttonPrimary} onClick={heroAction.onClick} disabled={heroAction.disabled || Boolean(busyAction)}>
                {busyAction === "finalize" ? "Đang chốt đơn…" : busyAction.startsWith("payment-") ? "Đang ghi nhận…" : heroAction.label}
              </button>
            ) : null}
          </div>
        </div>

        {partialErrors.length ? (
          <div className={styles.partialNotice} role="status">
            <strong>Một phần dữ liệu bổ trợ chưa tải được.</strong>
            <span>{partialErrors.join(" · ")}</span>
          </div>
        ) : null}
        {message ? <div className={styles.actionNotice} role="status">{message}</div> : null}

        <section className={styles.orderHero}>
          <div className={styles.orderIdentity}>
            <span className={styles.heroKicker}>Đơn POS từ lịch hẹn</span>
            <strong>{text(order.orderNumber)}</strong>
            <small>#{text(appointment.bookingReference)}</small>
          </div>
          <div className={styles.customerHero}>
            <span className={styles.avatar}>{displayName(customer).slice(0, 1).toUpperCase()}</span>
            <div><strong>{displayName(customer)}</strong><small>{text(customer.phone)}</small></div>
          </div>
          <div className={styles.heroDetail}><span>Chi nhánh</span><strong>{text(appointment.branch?.name, text(order.branchId))}</strong></div>
          <div className={styles.heroDetail}><span>Kỹ thuật viên chính</span><strong>{staffLabel(lineItems[0], staff)}</strong></div>
          <div className={styles.heroDetail}><span>Trạng thái đơn</span><Badge value={status}>{STATUS_LABELS[status] ?? status}</Badge></div>
          <div className={styles.heroDetail}><span>Quầy thu ngân</span><strong>{register ? `${register.code} · ${register.name}` : "Chưa gán quầy"}</strong></div>
        </section>

        <div className={styles.workspaceGrid}>
          <div className={styles.leftColumn}>
            <Card title="Dịch vụ thanh toán" action={<span className={styles.cardHint}>{lineItems.length} dịch vụ</span>}>
              <div className={styles.lineList}>
                {lineItems.map((line: any) => (
                  <article className={styles.lineRow} key={line.id}>
                    <span className={styles.lineIcon}>✦</span>
                    <div className={styles.lineDescription}>
                      <strong>{serviceLabel(line)}</strong>
                      <small>{staffLabel(line, staff)} · {sourceLabel(line)}</small>
                    </div>
                    <span>{line.quantity} × {money(line.netMinor, currency)}</span>
                    <Badge value={line.status === "ACTIVE" ? "PAID" : "VOIDED"}>{line.status === "ACTIVE" ? "Hoàn thành" : "Đã hủy"}</Badge>
                  </article>
                ))}
                {!lineItems.length ? <p className={styles.emptyInline}>Đơn chưa có dòng dịch vụ.</p> : null}
              </div>
              <div className={styles.totalStrip}><span>{lineItems.length} dịch vụ</span><strong>{money(order.totalMinor, currency)}</strong></div>
            </Card>

            <Card id="pos-discount-card" title="Ưu đãi & giảm giá" action={<span className={styles.cardHint}>{canEditPricing ? "Có thể chỉnh khi DRAFT" : "Giá đã được chốt"}</span>}>
              <div className={styles.benefitList}>
                {(order.discounts ?? []).map((discount: any) => (
                  <div className={styles.benefitRow} key={discount.id}>
                    <span className={styles.benefitIcon}>%</span>
                    <div><strong>{discount.reasonCode ?? "Ưu đãi"}</strong><small>{discount.status === "PENDING" ? "Đang chờ quản lý duyệt" : "Đã áp dụng từ dữ liệu POS"}</small></div>
                    <strong>{discount.status === "PENDING" ? "Chờ duyệt" : `−${money(discount.amountMinor, currency)}`}</strong>
                  </div>
                ))}
                {!order.discounts?.length ? <p className={styles.emptyInline}>Chưa có ưu đãi hoặc giảm giá được áp dụng.</p> : null}
              </div>
              {canEditPricing ? (
                <div className={styles.editBox}>
                  <div className={styles.formRow}>
                    <label>Loại ưu đãi<select value={discountType} onChange={(event) => setDiscountType(event.target.value as "FIXED" | "PERCENT")} disabled={!canDiscount}><option value="FIXED">Số tiền</option><option value="PERCENT">Phần trăm (basis points)</option></select></label>
                    <label>Giá trị<input inputMode="numeric" value={discountValue} onChange={(event) => setDiscountValue(event.target.value.replace(/\D/g, ""))} placeholder={discountType === "FIXED" ? "50000" : "500"} disabled={!canDiscount} /></label>
                  </div>
                  <input value={discountNote} onChange={(event) => setDiscountNote(event.target.value)} placeholder="Lý do / ghi chú (tùy chọn)" disabled={!canDiscount} />
                  <button type="button" className={styles.buttonOutline} onClick={applyDiscount} disabled={!canDiscount || !discountValue || Boolean(busyAction)}>Áp dụng / gửi duyệt</button>
                </div>
              ) : <p className={styles.helper}>Giá đã được chốt sau khi finalize; không thể sửa ưu đãi ở bước thanh toán.</p>}
              {(order.approvalRequests ?? []).filter((item: any) => item.status === "PENDING").map((item: any) => <div className={styles.warningBox} key={item.id}>Đang chờ quản lý duyệt giảm giá trước khi chốt đơn.</div>)}
            </Card>

            <Card id="pos-tip-card" title="Tiền tip" action={<span className={styles.cardHint}>{canEditPricing ? "Phân bổ theo WORK_SECONDS" : "Đã chốt"}</span>}>
              <div className={styles.tipGrid}>
                {[0, 50000, 100000, 150000].map((amount) => (
                  <button key={amount} type="button" className={tipMinor === amount ? styles.tipActive : styles.tipButton} disabled={!canEditPricing || !canTip || Boolean(busyAction)} onClick={() => setTip(amount)}>{amount ? money(amount, currency) : "Không tip"}</button>
                ))}
              </div>
              {canEditPricing ? <div className={styles.tipCustom}><label htmlFor="pos-tip-custom">Khác</label><input id="pos-tip-custom" inputMode="numeric" value={tipCustom} onChange={(event) => setTipCustom(event.target.value.replace(/\D/g, ""))} disabled={!canTip} placeholder="0" /><button type="button" className={styles.buttonOutline} onClick={() => setTip(parseMinor(tipCustom))} disabled={!canTip || !tipCustom || Boolean(busyAction)}>Lưu tip</button></div> : <p className={styles.lockedText}>Tip đã chốt: <strong>{money(tipMinor, currency)}</strong></p>}
              <p className={styles.helper}>Tip được phân bổ cho nhân sự có đóng góp thực tế theo work seconds. Không nhập PAN, CVV hoặc PIN.</p>
            </Card>
          </div>

          <div className={styles.centerColumn}>
            <Card title="Phương thức thanh toán">
              <div className={styles.paymentTiles} role="radiogroup" aria-label="Phương thức thanh toán">
                {(["CASH", "BANK_TRANSFER", "CARD_EXTERNAL"] as TenderType[]).map((tender) => {
                  const available = tender === "CASH" ? cashReady : externalReady;
                  const disabled = !isPayable || !available;
                  return <button key={tender} type="button" role="radio" aria-checked={selectedTender === tender} className={`${styles.paymentTile} ${selectedTender === tender ? styles.paymentTileActive : ""} ${disabled ? styles.paymentTileDisabled : ""}`} disabled={disabled} onClick={() => setSelectedTender(tender)}><span className={styles.paymentIcon}>{tender === "CASH" ? "▣" : tender === "BANK_TRANSFER" ? "⇄" : "▤"}</span><strong>{TENDER_LABELS[tender]}</strong><small>{!isPayable ? "Sau khi chốt đơn" : available ? "Sẵn sàng" : tender === "CASH" ? "Chưa mở ca tiền mặt" : "Chưa được bật"}</small></button>;
                })}
              </div>
            </Card>

            <Card title="Quầy thu ngân & ca tiền mặt" action={<span className={styles.cardHint}>Bắt buộc theo backend</span>}>
              {isDraft ? <div className={styles.registerPicker}><label>Quầy thanh toán<select value={selectedRegisterId} onChange={(event) => setSelectedRegisterId(event.target.value)}><option value="">Chọn quầy</option>{registers.filter((item) => item.status === "ACTIVE" && item.branchId === order.branchId).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label><button type="button" className={styles.buttonOutline} onClick={assignRegister} disabled={!selectedRegisterId || selectedRegisterId === order.registerId || Boolean(busyAction)}>Gán quầy</button></div> : <div className={styles.registerContext}><strong>{register ? `${register.code} · ${register.name}` : "Chưa gán quầy"}</strong><small>Thiết bị/quầy sẽ được backend kiểm tra khi finalize và capture.</small></div>}
              {selectedTender === "CASH" ? <div className={styles.sessionContext}>{validCashSessions.length ? <><label>Ca tiền mặt<select value={selectedCashSessionId} onChange={(event) => setSelectedCashSessionId(event.target.value)} disabled={!isPayable || Boolean(order.cashSessionId)}>{validCashSessions.map((item) => <option key={item.id} value={item.id}>{item.registerCode ?? item.id} · {item.businessDate ?? "Ca đang mở"}</option>)}</select></label><small className={styles.successText}>Ca OPEN đúng chi nhánh và quầy.</small></> : <div className={styles.warningBox}>Chưa có ca tiền mặt đang mở cho quầy này. <a href="/admin/pos/cash-sessions/open">Mở ca tiền mặt</a></div>}</div> : <p className={styles.helper}>Thanh toán ngoài không nhập thông tin thẻ nhạy cảm; backend sẽ kiểm tra quyền và provider.</p>}
            </Card>

            <Card title="Số tiền khách thanh toán" action={<span className={styles.cardHint}>{money(dueMinor, currency)} còn phải thu</span>}>
              {selectedTender === "CASH" ? <><div className={styles.amountBox}><span>Tổng cần thu</span><strong>{money(dueMinor, currency)}</strong></div><label className={styles.moneyField}>Số tiền khách đưa<input aria-label="Số tiền khách đưa" inputMode="numeric" value={cashReceivedMinor} onChange={(event) => setCashReceivedMinor(event.target.value.replace(/\D/g, ""))} disabled={!isPayable || !cashReady} /></label><div className={styles.quickAmounts}>{quickCashAmounts.map((amount) => <button type="button" key={amount} className={cashReceived === amount ? styles.quickAmountActive : styles.quickAmount} onClick={() => setCashReceivedMinor(String(amount))} disabled={!isPayable || !cashReady}>{money(amount, currency)}</button>)}</div><div className={styles.changeRow}><span>Tiền thừa</span><strong className={previewChange ? styles.successText : ""}>{previewChange ? money(previewChange, currency) : "—"}</strong></div></> : <><label className={styles.moneyField}>Mã giao dịch / tham chiếu<input aria-label="Mã giao dịch" value={externalReference} onChange={(event) => setExternalReference(event.target.value)} placeholder="Nhập mã từ terminal / ngân hàng" disabled={!isPayable || !externalReady} /></label>{selectedTender === "CARD_EXTERNAL" ? <label className={styles.moneyField}>4 số cuối thẻ (tùy chọn)<input aria-label="Bốn số cuối thẻ" value={cardLast4} onChange={(event) => setCardLast4(event.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" maxLength={4} disabled={!isPayable || !externalReady} /></label> : <label className={styles.moneyField}>Ghi chú đối soát<input aria-label="Ghi chú đối soát" value={bankEvidenceNote} onChange={(event) => setBankEvidenceNote(event.target.value)} disabled={!isPayable || !externalReady} /></label>}</>}
            </Card>

            {isPayable && partialAllowed ? <Card title="Chia thanh toán" action={<label className={styles.switchLabel}><input type="checkbox" checked={splitEnabled} onChange={(event) => { setSplitEnabled(event.target.checked); if (!event.target.checked) setSplitAmountMinor(String(dueMinor)); }} /> Cho phép thu từng phần</label>}><p className={styles.helper}>Mỗi lần thu sẽ gửi amountToApplyMinor không vượt quá amountDue; sau thành công hệ thống tải lại version mới.</p>{splitEnabled ? <label className={styles.moneyField}>Số tiền áp dụng lần này<input aria-label="Số tiền áp dụng lần này" inputMode="numeric" value={splitAmountMinor} onChange={(event) => setSplitAmountMinor(event.target.value.replace(/\D/g, ""))} /></label> : null}</Card> : null}

            <Card title="Trạng thái thanh toán" className={paymentReady ? styles.paymentReadyCard : ""}>
              <div className={styles.paymentStatus} role="status" aria-live="polite"><span className={isPaid ? styles.statusMarkSuccess : paymentReady ? styles.statusMarkSuccess : styles.statusMarkPending}>{isPaid || paymentReady ? "✓" : "!"}</span><div><strong>{isPaid ? "Thanh toán thành công" : status === "PARTIALLY_PAID" ? "Đã thanh toán một phần" : paymentReady ? "Đủ tiền" : "Chưa đủ điều kiện"}</strong><small>{isPaid ? "Đơn đã chuyển sang trạng thái PAID." : paymentReady ? "Sẵn sàng hoàn tất thanh toán" : order.registerId ? "Kiểm tra phương thức, ca tiền mặt và số tiền khách đưa." : "Gán quầy trước khi finalize hoặc capture."}</small></div></div>
              <dl className={styles.amountList}><div><dt>Tổng cần thu</dt><dd>{money(order.grandTotalMinor, currency)}</dd></div><div><dt>Đã thu</dt><dd>{money(order.amountPaidMinor, currency)}</dd></div><div><dt>Còn lại</dt><dd className={styles.amountAccent}>{money(order.amountDueMinor, currency)}</dd></div>{selectedTender === "CASH" && previewChange ? <div><dt>Tiền thừa dự kiến</dt><dd className={styles.successText}>{money(previewChange, currency)}</dd></div> : null}</dl>
            </Card>

            {isPayable ? <button type="button" className={styles.largeAction} onClick={capturePayment} disabled={!paymentReady || Boolean(busyAction)}>{busyAction.startsWith("payment-") ? "Đang ghi nhận thanh toán…" : status === "PARTIALLY_PAID" ? `Thu số còn lại · ${money(dueMinor, currency)}` : `Hoàn tất thanh toán · ${money(dueMinor, currency)}`}</button> : null}
          </div>

          <aside className={styles.rightColumn}>
            <Card title="Khách hàng">
              <div className={styles.customerBlock}><span className={styles.avatarLarge}>{displayName(customer).slice(0, 1).toUpperCase()}</span><div><h3>{displayName(customer)}</h3>{membership ? <span className={styles.tag}>{text(membership.tierName ?? membership.code)}</span> : null}</div></div>
              <dl className={styles.detailList}><div><dt>SĐT</dt><dd>{text(customer.phone)}</dd></div><div><dt>Email</dt><dd>{text(customer.email)}</dd></div>{loyalty?.availablePoints != null ? <div><dt>Điểm hiện tại</dt><dd>{text(loyalty.availablePoints)}</dd></div> : null}</dl>
              <div className={styles.actionRow}><a className={styles.buttonOutline} href={`/admin/customers/${encodeURIComponent(order.customerId ?? "")}`}>Xem hồ sơ</a><a className={styles.buttonOutline} href={`tel:${customer.phone ?? ""}`}>Liên hệ</a></div>
            </Card>

            <Card title="Tóm tắt hóa đơn">
              <dl className={styles.invoiceList}><div><dt>Dịch vụ</dt><dd>{money(order.subtotalMinor, currency)}</dd></div><div><dt>Giảm giá</dt><dd className={order.discountMinor ? styles.successText : ""}>{order.discountMinor ? `−${money(order.discountMinor, currency)}` : money(0, currency)}</dd></div><div><dt>Thuế</dt><dd>{money(order.taxMinor, currency)}</dd></div><div><dt>Tip</dt><dd>{money(order.tipMinor, currency)}</dd></div><div className={styles.invoiceTotal}><dt>Tổng dịch vụ sau tax</dt><dd>{money(order.totalMinor, currency)}</dd></div><div><dt>Tổng cần thanh toán</dt><dd className={styles.amountAccent}>{money(order.grandTotalMinor, currency)}</dd></div><div><dt>Đã thanh toán</dt><dd>{money(order.amountPaidMinor, currency)}</dd></div><div><dt>Còn lại</dt><dd className={styles.amountAccent}>{money(order.amountDueMinor, currency)}</dd></div></dl>
            </Card>

            <Card title="Nguồn đơn hàng">
              <dl className={styles.detailList}><div><dt>Lịch hẹn gốc</dt><dd>#{text(appointment.bookingReference)}</dd></div><div><dt>Trạng thái lịch</dt><dd>{text(appointment.status)}</dd></div><div><dt>Chi nhánh</dt><dd>{text(appointment.branch?.name, text(order.branchId))}</dd></div><div><dt>Quầy</dt><dd>{register ? register.code : "—"}</dd></div></dl>
              {order.appointmentId ? <a className={styles.inlineLink} href={`/admin/appointments/${order.appointmentId}/overview`}>Xem lịch hẹn →</a> : null}
            </Card>

            <Card title="Biên nhận">
              <label className={styles.checkRow}><input type="checkbox" checked={printReceipt} onChange={(event) => setPrintReceipt(event.target.checked)} disabled={!isPaid} /> In biên nhận sau khi thanh toán</label>
              <label className={styles.checkRow}><input type="checkbox" checked={emailReceipt} onChange={(event) => setEmailReceipt(event.target.checked)} disabled={!customer.email} /> Gửi email biên nhận {customer.email ? `(${customer.email})` : "(chưa có email)"}</label>
              <p className={styles.helper}>Tùy chọn chỉ được thực hiện sau khi invoice đã ISSUED.</p>
            </Card>

            {isPaid ? <Card title="Thanh toán thành công" className={styles.successCard}><p className={styles.successText}>Đơn đã PAID và invoice đã được phát hành bởi backend.</p><div className={styles.actionStack}><a className={styles.buttonPrimary} href={`/admin/pos/orders/${orderId}/receipt`}>Mở biên nhận</a>{emailReceipt && customer.email ? <button type="button" className={styles.buttonOutline} onClick={deliverEmail} disabled={Boolean(busyAction)}>Gửi email biên nhận</button> : null}</div></Card> : <Card title="Thao tác nhanh"><div className={styles.actionStack}>{isDraft ? <button type="button" className={styles.buttonOutline} onClick={() => document.getElementById("pos-discount-card")?.scrollIntoView({ behavior: "smooth" })}>Áp dụng ưu đãi</button> : null}{isDraft ? <button type="button" className={styles.buttonOutline} onClick={() => document.getElementById("pos-tip-card")?.scrollIntoView({ behavior: "smooth" })}>Thêm tip</button> : null}{isPayable ? <button type="button" className={styles.buttonPrimary} onClick={capturePayment} disabled={!paymentReady || Boolean(busyAction)}>Thu tiền</button> : null}{!isDraft && !isPayable ? <a className={styles.buttonOutline} href={`/admin/pos/orders/${orderId}/receipt`}>Mở biên nhận</a> : null}</div></Card>}
          </aside>
        </div>
      </div>
      <footer className={styles.stickyFooter}>
        <a className={styles.buttonSecondary} href={`/admin/appointments/${order.appointmentId ?? ""}/checkout-summary`}>← Quay lại tổng kết lịch hẹn</a>
        <div>{printReceipt && isPaid ? <a className={styles.buttonSecondary} href={`/admin/pos/orders/${orderId}/receipt`}>In biên nhận</a> : null}{heroAction ? <button type="button" className={styles.buttonPrimary} onClick={heroAction.onClick} disabled={heroAction.disabled || Boolean(busyAction)}>{heroAction.label}</button> : null}</div>
      </footer>
    </main>
  );
}

function ReceiptCard({ data, currency }: { data: any; currency: string }) {
  return (
    <article className={styles.receiptCard}>
      <div className={styles.receiptHeader}><div><span className={styles.eyebrow}>NailSoft CMS</span><h2>{text(data.branchSnapshot?.name, "Salon")}</h2></div><strong>{text(data.invoiceNumber)}</strong></div>
      <p>{formatDateTime(data.issuedAt)} · {text(data.branchSnapshot?.timezone)}</p>
      <div className={styles.receiptLines}>{(data.lines ?? []).map((line: any) => <div className={styles.receiptLine} key={line.id}><span>{serviceLabel(line)}</span><strong>{money(line.netMinor, currency)}</strong></div>)}</div>
      <dl className={styles.invoiceList}><div><dt>Tổng dịch vụ</dt><dd>{money(data.totalMinor, currency)}</dd></div><div><dt>Tip</dt><dd>{money(data.tipMinor, currency)}</dd></div><div className={styles.invoiceTotal}><dt>Đã thanh toán</dt><dd>{money(data.paidMinor, currency)}</dd></div></dl>
      <small>Mã kiểm tra: {text(data.verificationCode)}</small>
    </article>
  );
}

export function isPosCheckoutWorkspacePath(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  return parts[0] === "admin" && parts[1] === "pos" && parts[2] === "orders" && Boolean(parts[3]) && (parts.length === 4 || ["payment", "receipt"].includes(parts[4] ?? ""));
}

export function posWorkspaceRoute(pathname: string): { orderId: string; mode: WorkspaceMode } | null {
  if (!isPosCheckoutWorkspacePath(pathname)) return null;
  const parts = pathname.split("/").filter(Boolean);
  return { orderId: parts[3]!, mode: parts[4] === "receipt" ? "receipt" : parts[4] === "payment" ? "payment" : "order" };
}

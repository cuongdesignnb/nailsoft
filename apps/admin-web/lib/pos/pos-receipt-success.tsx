"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authorizedFetch, getAuthContext } from "../auth";
import styles from "./pos-receipt-success.module.css";

type LoadState = "loading" | "ready" | "error" | "forbidden" | "offline";

const TENDER_LABELS: Record<string, string> = {
  CASH: "Tiền mặt",
  CARD_EXTERNAL: "Thẻ",
  BANK_TRANSFER: "Chuyển khoản",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Chưa hoàn tất thanh toán",
  READY_FOR_PAYMENT: "Sẵn sàng thanh toán",
  PARTIALLY_PAID: "Đã thanh toán một phần",
  PAID: "Đã thanh toán",
  VOIDED: "Đã hủy",
};

function localized(value: any, fallback = "—"): string {
  if (typeof value === "string" && value.trim()) return value;
  if (!value || typeof value !== "object") return fallback;
  for (const key of ["vi-VN", "vi", "en-US", "en", "name"]) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key];
  }
  const first = Object.values(value).find((item) => typeof item === "string" && item.trim());
  return typeof first === "string" ? first : fallback;
}

function displayName(value: any, fallback = "Khách hàng") {
  return value?.displayName ?? value?.name ?? value?.fullName ?? fallback;
}

function money(value: unknown, currency: string) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "VND" ? 0 : 2,
  }).format(currency === "VND" ? amount : amount / 100);
}

function integer(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? new Intl.NumberFormat("vi-VN").format(amount) : "—";
}

function dateTime(value: unknown, timeZone?: string) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: timeZone || undefined,
    }).format(new Date(String(value)));
  } catch {
    return String(value);
  }
}

function shortDate(value: unknown, timeZone?: string) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      dateStyle: "medium",
      timeZone: timeZone || undefined,
    }).format(new Date(String(value)));
  } catch {
    return String(value);
  }
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "N";
}

function apiError(error: any) {
  if (error?.forbidden) return "Bạn không có quyền xem biên nhận này.";
  if (error?.status === 0) return "Không thể kết nối máy chủ. Kiểm tra mạng rồi thử lại.";
  return error?.message ?? "Không thể tải dữ liệu biên nhận.";
}

function deliveryLabel(status: string | undefined) {
  switch (status) {
    case "PENDING":
      return "Đang gửi";
    case "SENT":
    case "DELIVERED":
      return "Đã gửi thành công";
    case "FAILED":
      return "Gửi thất bại";
    case "DISABLED":
      return "Email chưa được bật";
    default:
      return "Chưa gửi";
  }
}

function statusTone(status: string | undefined) {
  if (status === "SENT" || status === "DELIVERED") return styles.success;
  if (status === "FAILED") return styles.danger;
  if (status === "DISABLED") return styles.warning;
  return styles.info;
}

function serviceName(line: any) {
  return localized(line?.description?.name ?? line?.description?.serviceName ?? line?.description, "Dịch vụ");
}

function Card({
  title,
  eyebrow,
  action,
  className = "",
  children,
}: {
  title: string;
  eyebrow?: string;
  action?: React.ReactNode;
  className?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <section className={`${styles.card} ${className}`}>
      <header className={styles.cardHeader}>
        <div>
          {eyebrow ? <p className={styles.cardEyebrow}>{eyebrow}</p> : null}
          <h2>{title}</h2>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  return <span className={large ? styles.avatarLarge : styles.avatar}>{initials(name)}</span>;
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "success" | "warning" | "danger" | "info" | "neutral" }) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}

function StatusPanel({ state, message, retry }: { state: LoadState; message?: string; retry: () => void }) {
  const title = state === "forbidden" ? "Không thể xem biên nhận" : state === "offline" ? "Đang ngoại tuyến" : "Không thể tải giao dịch";
  return (
    <div className={`${styles.statePanel} ${state === "forbidden" ? styles.stateDanger : styles.stateWarning}`} role="alert">
      <strong>{state === "loading" ? "Đang tải biên nhận…" : title}</strong>
      <span>{state === "loading" ? "Đang lấy dữ liệu chính thức từ POS order và invoice." : message}</span>
      {state !== "loading" ? (
        <div className={styles.stateActions}>
          <button type="button" className={styles.buttonSecondary} onClick={retry}>Thử lại</button>
          <a className={styles.buttonOutline} href="/admin/pos/orders">Về danh sách đơn hàng</a>
        </div>
      ) : <span className={styles.spinner} aria-hidden="true" />}
    </div>
  );
}

export default function PosReceiptSuccessPage({ orderId }: { orderId: string }) {
  const [state, setState] = useState<LoadState>("loading");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const requestKeys = useRef<Record<string, string>>({});

  const request = useCallback(async (path: string, init?: RequestInit) => {
    const response = await authorizedFetch(path, init);
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      throw Object.assign(new Error(body.error?.message ?? "Permission denied"), { forbidden: true, code: body.error?.code });
    }
    if (!response.ok) throw Object.assign(new Error(body.error?.message ?? "Request failed"), { status: response.status, code: body.error?.code });
    return body.data;
  }, []);

  const load = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
    if (quiet) setRefreshing(true);
    else setState("loading");
    setError("");
    try {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setState("offline");
        return;
      }
      const order = await request(`/v1/pos-orders/${encodeURIComponent(orderId)}`);
      const invoiceReady = order.status === "PAID" && order.invoice?.status === "ISSUED" && order.invoice?.id;
      const entries: Array<[string, Promise<any>]> = [
        ["history", request(`/v1/pos-orders/${encodeURIComponent(orderId)}/history`)],
        ["staff", request(`/v1/staff?status=ACTIVE&branchId=${encodeURIComponent(order.branchId)}`)],
        ["auth", getAuthContext()],
      ];
      if (order.appointmentId) entries.push(["appointment", request(`/v1/appointments/${encodeURIComponent(order.appointmentId)}`)]);
      if (order.customerId) {
        entries.push(["customer", request(`/v1/customers/${encodeURIComponent(order.customerId)}`)]);
        entries.push(["loyalty", request(`/v1/customers/${encodeURIComponent(order.customerId)}/loyalty`)]);
        entries.push(["ledger", request(`/v1/customers/${encodeURIComponent(order.customerId)}/loyalty/ledger`)]);
        entries.push(["membership", request(`/v1/customers/${encodeURIComponent(order.customerId)}/membership`)]);
      }
      if (invoiceReady) entries.push(["receipt", request(`/v1/invoices/${encodeURIComponent(order.invoice.id)}/print`)]);
      if (order.invoice?.id) entries.push(["reviewRequests", request("/v1/review-requests")]);
      const results = await Promise.allSettled(entries.map(([, promise]) => promise));
      const optional: Record<string, any> = {};
      const optionalErrors: string[] = [];
      entries.forEach(([key], index) => {
        const result = results[index];
        if (!result) return;
        if (result.status === "fulfilled") optional[key] = result.value;
        else if (key !== "auth" && key !== "staff" && key !== "history") optionalErrors.push(key);
      });
      const receipt = optional.receipt ?? null;
      if (invoiceReady && !receipt) {
        const receiptFailure = results[entries.findIndex(([key]) => key === "receipt")];
        const reason = receiptFailure?.status === "rejected" ? receiptFailure.reason : null;
        setData({ order, ...optional, receipt: null, optionalErrors });
        setError(apiError(reason));
      } else {
        setData({ order, ...optional, receipt, optionalErrors });
      }
      setState("ready");
    } catch (reason: any) {
      setError(apiError(reason));
      setState(reason?.forbidden ? "forbidden" : reason?.status === 0 ? "offline" : "error");
    } finally {
      setRefreshing(false);
    }
  }, [orderId, request]);

  useEffect(() => { void load(); }, [load]);

  const latestDelivery = useMemo(() => {
    const deliveries = [...(data?.receipt?.deliveries ?? [])];
    return deliveries.sort((a, b) => new Date(String(b.createdAt ?? "")).getTime() - new Date(String(a.createdAt ?? "")).getTime())[0];
  }, [data?.receipt?.deliveries]);

  useEffect(() => {
    if (!latestDelivery || !["PENDING"].includes(latestDelivery.status)) return;
    const timer = window.setInterval(() => void load({ quiet: true }), 7000);
    return () => window.clearInterval(timer);
  }, [latestDelivery, load]);

  if (state !== "ready" || !data?.order) {
    return <main className={styles.page}><div className={styles.pageInner}><StatusPanel state={state} message={error || "Đang tải…"} retry={() => void load()} /></div></main>;
  }

  const order = data.order;
  const receipt = data.receipt;
  const invoice = order.invoice;
  const timeZone = receipt?.branchSnapshot?.timezone ?? order.appointmentSnapshot?.branch?.timezone;
  const customer = receipt?.customerSnapshot ?? order.customerSnapshot ?? {};
  const auth = data.auth;
  const permissions: string[] | undefined = auth?.authorization?.permissions;
  const can = (permission: string) => !auth || Boolean(permissions?.includes(permission));
  const isPaid = order.status === "PAID";
  const isIssued = invoice?.status === "ISSUED";
  const canPrint = can("invoice.print");
  const canDeliver = can("invoice.deliver") && Boolean(customer.email);
  const canRefund = can("refund.request");
  const financialReady = isPaid && isIssued && Boolean(receipt?.receipt);

  const deliverEmail = async () => {
    if (!invoice?.id || !customer.email || !canDeliver || busy) return;
    setBusy("deliver");
    setMessage("");
    try {
      const key = requestKeys.current.email ?? (requestKeys.current.email = crypto.randomUUID());
      const result = await request(`/v1/invoices/${encodeURIComponent(invoice.id)}/deliver`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify({ channel: "EMAIL", destination: customer.email }),
      });
      delete requestKeys.current.email;
      setMessage(result.status === "DISABLED" ? "Email chưa được bật trong môi trường hiện tại." : "Yêu cầu gửi biên nhận đã được ghi nhận; trạng thái sẽ cập nhật theo backend.");
      await load({ quiet: true });
    } catch (reason: any) {
      setMessage(apiError(reason));
    } finally {
      setBusy("");
    }
  };

  const guardMessage = !isPaid
    ? order.status === "READY_FOR_PAYMENT" || order.status === "PARTIALLY_PAID"
      ? "Đơn hàng vẫn còn số tiền chưa thanh toán. Tiếp tục thanh toán để mở biên nhận chính thức."
      : order.status === "VOIDED" ? "Đơn hàng đã bị hủy và không thể phát hành biên nhận." : "Đơn hàng chưa hoàn tất thanh toán."
    : !invoice ? "Thanh toán đã hoàn tất nhưng chứng từ chưa sẵn sàng. Không tạo invoice từ frontend."
      : !isIssued ? "Chứng từ đang được hoàn tất. Chỉ invoice ISSUED mới có thể in hoặc gửi cho khách."
        : error || "Biên nhận chính thức chưa sẵn sàng.";

  return (
    <main className={styles.page}>
      <div className={styles.pageInner}>
        <div className={styles.breadcrumb}><a href="/admin/pos">POS</a><span>/</span><a href="/admin/pos/orders">Đơn hàng</a><span>/</span><strong>#{order.orderNumber}</strong><span>/</span><span>Biên nhận</span></div>
        <header className={styles.pageHeader}>
          <div><p className={styles.eyebrow}>POS / ĐƠN HÀNG / BIÊN NHẬN</p><h1>{financialReady ? "Thanh toán thành công" : "Biên nhận thanh toán"}</h1><p>Giao dịch đã được ghi nhận. Kiểm tra biên nhận, điểm tích lũy và gửi chứng từ cho khách hàng.</p></div>
          <div className={styles.headerActions}><a className={styles.buttonSecondary} href={`/admin/pos/orders/${orderId}`}>← Quay lại đơn hàng</a>{financialReady && canPrint ? <button type="button" className={styles.buttonSecondary} onClick={() => window.print()}>▣ In biên nhận</button> : null}{financialReady && canDeliver ? <button type="button" className={styles.buttonPrimary} onClick={() => void deliverEmail()} disabled={Boolean(busy)}>{busy === "deliver" ? "Đang gửi…" : "✈ Gửi biên nhận cho khách"}</button> : null}</div>
        </header>

        {message ? <div className={styles.notice} role="status">{message}</div> : null}
        {data.optionalErrors?.length ? <div className={styles.noticeMuted} role="status">Một số dữ liệu chăm sóc sau dịch vụ chưa khả dụng; receipt tài chính vẫn được giữ nguyên từ backend.</div> : null}

        {!financialReady ? (
          <div className={`${styles.guardPanel} ${isPaid ? styles.guardWarning : styles.guardDanger}`} role="alert">
            <strong>{isPaid && isIssued ? "Không thể tải receipt chính thức" : STATUS_LABELS[order.status] ?? "Biên nhận chưa sẵn sàng"}</strong>
            <span>{guardMessage}</span>
            <div className={styles.guardActions}>{isPaid && isIssued ? <button type="button" className={styles.buttonSecondary} onClick={() => void load()}>Làm mới</button> : null}{!isPaid ? <a className={styles.buttonPrimary} href={`/admin/pos/orders/${orderId}/payment`}>Tiếp tục thanh toán</a> : null}</div>
          </div>
        ) : (
          <ReceiptContent data={data} timeZone={timeZone} canPrint={canPrint} canDeliver={canDeliver} canRefund={canRefund} busy={busy} onDeliver={deliverEmail} refreshing={refreshing} />
        )}
      </div>
      {financialReady ? <footer className={styles.stickyFooter}><a className={styles.buttonSecondary} href="/admin/pos/orders">← Về danh sách đơn hàng</a><div>{canPrint ? <button type="button" className={styles.buttonSecondary} onClick={() => window.print()}>▣ In biên nhận</button> : null}{canDeliver ? <button type="button" className={styles.buttonOutline} onClick={() => void deliverEmail()} disabled={Boolean(busy)}>Gửi email</button> : null}{order.customerId ? <a className={styles.buttonPrimary} href={`/admin/appointments/new?customerId=${encodeURIComponent(order.customerId)}`}>＋ Tạo lịch hẹn tiếp theo</a> : null}</div></footer> : null}
    </main>
  );
}

function ReceiptContent({ data, timeZone, canPrint, canDeliver, canRefund, busy, onDeliver, refreshing }: { data: any; timeZone?: string | undefined; canPrint: boolean; canDeliver: boolean; canRefund: boolean; busy: string; onDeliver: () => Promise<void>; refreshing: boolean }) {
  const order = data.order;
  const receipt = data.receipt;
  const invoice = order.invoice;
  const currency = receipt.currency ?? order.currency ?? "VND";
  const customer = receipt.customerSnapshot ?? order.customerSnapshot ?? {};
  const staff = Array.isArray(data.staff) ? data.staff : [];
  const staffMap = new Map<string, any>(staff.map((item: any) => [String(item.id), item]));
  const appointmentItems = new Map<string, any>((data.appointment?.items ?? []).map((item: any) => [String(item.id), item]));
  const orderLines = Array.isArray(order.lines) ? order.lines : [];
  const paymentRows = receipt.tenders?.length ? receipt.tenders : order.payments ?? [];
  const tipMinor = Number(order.tip?.amountMinor ?? receipt.tipMinor ?? order.tipMinor ?? 0);
  const allocations = order.tip?.allocations ?? [];
  const allocationTotal = allocations.reduce((sum: number, item: any) => sum + Number(item.amountMinor ?? 0), 0);
  const tipInvariant = allocationTotal === tipMinor;
  const lineByNo = new Map<number, any>(orderLines.map((line: any) => [Number(line.lineNo), line]));
  const staffNamesForLine = (line: any) => {
    const source = lineByNo.get(Number(line.lineNo))?.sourceSnapshot ?? {};
    const ids = [...(source.staffContributions ?? []).map((item: any) => item.staffId)];
    const appointmentItem = appointmentItems.get(line.appointmentItemId);
    if (appointmentItem?.staff?.id) ids.push(appointmentItem.staff.id);
    const names = [...new Set(ids)].map((id) => staffMap.get(id)?.displayName).filter(Boolean);
    return names.length ? names.join(", ") : "Theo snapshot dịch vụ";
  };
  const staffWorkSeconds = new Map<string, number>();
  orderLines.forEach((line: any) => {
    const source = line.sourceSnapshot ?? {};
    (source.staffContributions ?? []).forEach((item: any) => staffWorkSeconds.set(item.staffId, (staffWorkSeconds.get(item.staffId) ?? 0) + Number(item.workSeconds ?? 0)));
  });
  const paymentEvents = paymentRows.map((payment: any) => ({ type: "payment", label: `Thanh toán ${TENDER_LABELS[payment.tenderType] ?? payment.tenderType}`, date: payment.capturedAt ?? payment.createdAt, detail: payment.paymentReference, amount: payment.capturedMinor }));
  const historyEvents = (data.history ?? []).map((item: any) => ({ type: "status", label: item.toStatus === "PAID" ? "Đơn hàng đã thanh toán" : item.toStatus === "READY_FOR_PAYMENT" ? "Đơn hàng sẵn sàng thanh toán" : item.toStatus === "DRAFT" ? "Đơn POS được tạo" : `Trạng thái: ${item.toStatus}`, date: item.createdAt, detail: item.reasonCode }));
  const otherEvents = [
    ...(order.discounts ?? []).map((item: any) => ({ type: "discount", label: "Áp dụng ưu đãi", date: item.createdAt, detail: item.reasonCode, amount: item.amountMinor })),
    ...(order.tip?.createdAt ? [{ type: "tip", label: "Thêm tip", date: order.tip.createdAt, amount: tipMinor }] : []),
    ...(receipt.issuedAt ? [{ type: "invoice", label: "Biên nhận được phát hành", date: receipt.issuedAt, detail: receipt.invoiceNumber }] : []),
  ];
  const events = [...historyEvents, ...otherEvents, ...paymentEvents].filter((item) => item.date).sort((a, b) => new Date(String(a.date)).getTime() - new Date(String(b.date)).getTime());
  const latestDelivery = [...(receipt.deliveries ?? [])].sort((a: any, b: any) => new Date(String(b.createdAt ?? "")).getTime() - new Date(String(a.createdAt ?? "")).getTime())[0];
  const emailDelivery = [...(receipt.deliveries ?? [])].filter((item: any) => item.channel === "EMAIL").sort((a: any, b: any) => new Date(String(b.createdAt ?? "")).getTime() - new Date(String(a.createdAt ?? "")).getTime())[0] ?? latestDelivery;
  const loyaltyLedger = (data.ledger ?? []).filter((item: any) => item.posOrderId === order.id || item.invoiceId === invoice?.id);
  const loyaltyEarn = loyaltyLedger.find((item: any) => Number(item.pendingDelta ?? 0) > 0 || Number(item.availableDelta ?? 0) > 0 || Number(item.lifetimeDelta ?? 0) > 0);
  const loyaltyAccount = data.loyalty;
  const loyaltyAfter = loyaltyAccount ? Number(loyaltyAccount.availablePoints ?? 0) + Number(loyaltyAccount.pendingPoints ?? 0) : null;
  const loyaltyEarned = loyaltyEarn ? Number(loyaltyEarn.pendingDelta ?? loyaltyEarn.availableDelta ?? loyaltyEarn.lifetimeDelta ?? 0) : null;
  const loyaltyBefore = loyaltyAfter != null && loyaltyEarned != null ? loyaltyAfter - loyaltyEarned : null;
  const nextAppointment = (data.customer?.recentAppointments ?? []).filter((item: any) => item.id !== order.appointmentId && new Date(String(item.scheduledStartAt)).getTime() > Date.now() && !["CANCELLED_BY_CUSTOMER", "CANCELLED_BY_SALON", "NO_SHOW", "EXPIRED"].includes(item.status)).sort((a: any, b: any) => new Date(String(a.scheduledStartAt)).getTime() - new Date(String(b.scheduledStartAt)).getTime())[0];
  const reviewRequest = (data.reviewRequests ?? []).find((item: any) => item.invoiceId === invoice?.id || item.appointmentId === order.appointmentId);
  const grandTotal = Number(receipt.paidMinor ?? receipt.totalMinor ?? order.grandTotalMinor ?? 0);

  return (
    <>
      <section className={styles.successHero} aria-label="Thanh toán hoàn tất">
        <div className={styles.successMark} aria-hidden="true">✓</div>
        <div className={styles.heroAmount}><span>Thanh toán hoàn tất</span><strong>{money(grandTotal, currency)}</strong></div>
        <div className={styles.heroMeta}><span>Mã đơn POS</span><strong>#{order.orderNumber}</strong><small>{dateTime(order.paidAt ?? receipt.issuedAt, timeZone)}</small><div><Badge tone="success">Đã thanh toán</Badge><Badge tone="success">Biên nhận đã phát hành</Badge></div></div>
        <div className={styles.heroMeta}><span>Khách hàng</span><strong>{displayName(customer)}</strong><small>{order.appointmentSnapshot?.bookingReference ? `Từ lịch hẹn #${order.appointmentSnapshot.bookingReference}` : "Nguồn POS"}</small></div>
        <div className={styles.heroMeta}><span>Mã giao dịch</span><strong>{paymentRows.length === 1 ? paymentRows[0].paymentReference ?? "—" : `${paymentRows.length} giao dịch thanh toán`}</strong><small>{receipt.invoiceNumber}</small></div>
      </section>

      <nav className={styles.workflow} aria-label="Tiến trình giao dịch"><span className={styles.stepDone}>✓ <b>Đặt lịch</b></span><i /><span className={styles.stepDone}>✓ <b>Check-in</b></span><i /><span className={styles.stepDone}>✓ <b>Phục vụ</b></span><i /><span className={styles.stepDone}>✓ <b>Tổng kết</b></span><i /><span className={styles.stepDone}>✓ <b>Thanh toán</b></span><i /><span className={`${styles.stepDone} ${styles.stepFinal}`}>✓ <b>Hoàn tất</b></span></nav>

      <div className={styles.bodyGrid}>
        <div className={styles.mainColumn}>
          <DigitalReceiptCard receipt={receipt} currency={currency} customer={customer} order={order} timeZone={timeZone} paymentRows={paymentRows} staffNamesForLine={staffNamesForLine} canPrint={canPrint} />
          <div className={styles.mainSplit}>
            <TipAllocationCard allocations={allocations} tipMinor={tipMinor} tipInvariant={tipInvariant} staffMap={staffMap} staffWorkSeconds={staffWorkSeconds} currency={currency} />
            <TimelineCard events={events} currency={currency} timeZone={timeZone} />
          </div>
        </div>
        <aside className={styles.sideColumn}>
          <CustomerCard customer={customer} current={data.customer} order={order} />
          {loyaltyEarned != null && loyaltyAfter != null ? <LoyaltyCard before={loyaltyBefore ?? 0} earned={loyaltyEarned} after={loyaltyAfter} membership={data.membership} /> : null}
          <DeliveryCard delivery={emailDelivery} email={customer.email} canDeliver={canDeliver} busy={busy} onDeliver={onDeliver} />
          <NextAppointmentCard appointment={nextAppointment} timeZone={timeZone} />
          {reviewRequest ? <Card title="Chăm sóc sau dịch vụ" eyebrow="ENGAGEMENT"><div className={styles.reviewRow}><span className={styles.iconCircle}>✓</span><div><strong>{reviewRequest.status === "SENT" ? "Yêu cầu đánh giá đã gửi" : `Yêu cầu đánh giá: ${reviewRequest.status}`}</strong><small>{reviewRequest.sentAt ? dateTime(reviewRequest.sentAt, timeZone) : "Theo trạng thái backend"}</small></div><Badge tone={reviewRequest.status === "SENT" ? "success" : "info"}>{reviewRequest.status}</Badge></div></Card> : null}
          <TransactionStatusCard order={order} invoice={invoice} tipInvariant={tipInvariant} loyalty={loyaltyEarn != null} />
          <QuickActionsCard order={order} invoice={invoice} canRefund={canRefund} canPrint={canPrint} canDeliver={canDeliver} busy={busy} onDeliver={onDeliver} />
        </aside>
      </div>
      {refreshing ? <div className={styles.refreshing} role="status">Đang cập nhật trạng thái delivery…</div> : null}
    </>
  );
}

function DigitalReceiptCard({ receipt, currency, customer, order, timeZone, paymentRows, staffNamesForLine, canPrint }: { receipt: any; currency: string; customer: any; order: any; timeZone?: string | undefined; paymentRows: any[]; staffNamesForLine: (line: any) => string; canPrint: boolean }) {
  return (
    <Card title="Biên nhận" eyebrow="OFFICIAL FINANCIAL EVIDENCE" className={styles.receiptCard} action={canPrint ? <button type="button" className={styles.textAction} onClick={() => window.print()}>In biên nhận</button> : null}>
      <div className={styles.receiptHeading}><div><strong>{receipt.branchSnapshot?.name ?? order.appointmentSnapshot?.branch?.name ?? "NailSoft"}</strong><small>{receipt.branchSnapshot?.address ?? receipt.branchSnapshot?.contact?.address ?? ""}</small><small>{receipt.branchSnapshot?.phone ?? receipt.branchSnapshot?.hotline ?? ""}</small></div><div className={styles.invoiceNumber}><span>BIÊN NHẬN</span><strong>#{receipt.invoiceNumber}</strong><small>{dateTime(receipt.issuedAt ?? order.paidAt, timeZone)}</small></div></div>
      <div className={styles.receiptCustomer}><div><span>Khách hàng</span><strong>{displayName(customer)}</strong></div><div><span>SĐT</span><strong>{customer.phone ?? "—"}</strong></div><div><span>Nguồn</span><strong>{order.appointmentSnapshot?.bookingReference ? `Lịch hẹn #${order.appointmentSnapshot.bookingReference}` : "POS"}</strong></div></div>
      <div className={styles.receiptTableWrap}><table className={styles.receiptTable}><caption>Dịch vụ trong biên nhận</caption><thead><tr><th>Dịch vụ</th><th>Kỹ thuật viên</th><th>SL</th><th>Thành tiền</th></tr></thead><tbody>{(receipt.lines ?? []).map((line: any) => <tr key={line.id}><td><strong>{serviceName(line)}</strong></td><td>{staffNamesForLine(line)}</td><td>{line.quantity}</td><td>{money(line.netMinor, currency)}</td></tr>)}</tbody></table></div>
      <div className={styles.receiptDetailGrid}><dl className={styles.amountList}><div><dt>Tạm tính</dt><dd>{money(receipt.subtotalMinor, currency)}</dd></div><div><dt>Giảm giá</dt><dd className={receipt.discountMinor ? styles.successText : ""}>{receipt.discountMinor ? `−${money(receipt.discountMinor, currency)}` : money(0, currency)}</dd></div><div><dt>Thuế</dt><dd>{money(receipt.taxMinor, currency)}</dd></div><div><dt>Tip</dt><dd>{money(receipt.tipMinor, currency)}</dd></div><div className={styles.totalRow}><dt>Tổng cộng</dt><dd>{money(receipt.totalMinor, currency)}</dd></div><div><dt>Đã thanh toán</dt><dd className={styles.successText}>{money(receipt.paidMinor, currency)}</dd></div></dl><div className={styles.paymentBox}><strong>Thanh toán</strong>{paymentRows.map((payment: any) => <div className={styles.paymentRow} key={payment.id}><span>{TENDER_LABELS[payment.tenderType] ?? payment.tenderType}</span><b>{money(payment.capturedMinor, currency)}</b></div>)}{paymentRows.some((payment: any) => payment.tenderType === "CASH") ? paymentRows.filter((payment: any) => payment.tenderType === "CASH").map((payment: any) => <div className={styles.paymentSubline} key={`${payment.id}-cash`}>Khách đưa <b>{money(payment.cashReceivedMinor, currency)}</b><br />Tiền thừa <b className={styles.successText}>{money(payment.changeDueMinor, currency)}</b></div>) : null}<Badge tone="success">ĐÃ THANH TOÁN</Badge></div></div>
      <div className={styles.receiptFooter}><p>Cảm ơn quý khách đã sử dụng dịch vụ tại NailSoft.</p><div><span className={styles.qrPlaceholder} aria-hidden="true">▦</span><span>Mã xác minh: <strong>{receipt.verificationCode}</strong><small>{receipt.verificationUrl}</small></span></div></div>
    </Card>
  );
}

function TipAllocationCard({ allocations, tipMinor, tipInvariant, staffMap, staffWorkSeconds, currency }: { allocations: any[]; tipMinor: number; tipInvariant: boolean; staffMap: Map<string, any>; staffWorkSeconds: Map<string, number>; currency: string }) {
  return <Card title="Kỹ thuật viên & phân bổ tip" eyebrow="TIP ALLOCATION" action={<span className={styles.cardHint}>{allocations.length} phân bổ</span>}>{!tipInvariant ? <div className={styles.dataError} role="alert">Dữ liệu phân bổ tip không khớp tổng tip từ backend. Vui lòng làm mới.</div> : null}{allocations.length ? <div className={styles.tipRows}>{allocations.map((item: any) => { const name = staffMap.get(item.staffId)?.displayName ?? "Nhân sự theo snapshot"; return <div className={styles.tipRow} key={`${item.staffId}-${item.appointmentItemId ?? "all"}`}><Avatar name={name} /><div><strong>{name}</strong><small>{staffWorkSeconds.get(item.staffId) ? `${Math.round((staffWorkSeconds.get(item.staffId) ?? 0) / 60)} phút đóng góp thực tế` : "Phân bổ từ backend"}</small></div><b>{money(item.amountMinor, currency)}</b></div>; })}</div> : <p className={styles.emptyInline}>Không có tip phân bổ cho giao dịch này.</p>}<div className={styles.totalRow}><span>Tổng tip</span><strong>{money(tipMinor, currency)}</strong></div></Card>;
}

function TimelineCard({ events, currency, timeZone }: { events: any[]; currency: string; timeZone?: string | undefined }) {
  return <Card title="Lịch sử giao dịch" eyebrow="PERSISTED ACTIVITY"><div className={styles.timeline}>{events.length ? events.map((event, index) => <div className={styles.timelineItem} key={`${event.type}-${event.date}-${index}`}><span className={styles.timelineDot} /><time>{dateTime(event.date, timeZone)}</time><div><strong>{event.label}</strong>{event.detail ? <small>{event.detail}</small> : null}</div>{event.amount != null ? <b>{money(event.amount, currency)}</b> : null}</div>) : <p className={styles.emptyInline}>Chưa có lịch sử giao dịch được trả về.</p>}</div></Card>;
}

function CustomerCard({ customer, current, order }: { customer: any; current: any; order: any }) {
  return <Card title="Khách hàng" eyebrow="CUSTOMER SNAPSHOT"><div className={styles.customerHeader}><Avatar name={displayName(customer)} large /><div><h3>{displayName(customer)}</h3><Badge tone="info">Khách hàng lịch hẹn</Badge></div></div><dl className={styles.detailList}><div><dt>SĐT</dt><dd>{customer.phone ?? "—"}</dd></div><div><dt>Email</dt><dd>{customer.email ?? "—"}</dd></div><div><dt>Lượt ghé đã hoàn tất</dt><dd>{current?.activitySummary?.completedVisitCount != null ? integer(current.activitySummary.completedVisitCount) : "—"}</dd></div><div><dt>Lần ghé gần nhất</dt><dd>{current?.activitySummary?.lastVisitAt ? new Date(current.activitySummary.lastVisitAt).toLocaleDateString("vi-VN") : "—"}</dd></div></dl><div className={styles.actionRow}><a className={styles.buttonOutline} href={`/admin/customers/${encodeURIComponent(order.customerId ?? "")}`}>Xem hồ sơ</a><a className={styles.buttonOutline} href={`tel:${customer.phone ?? ""}`}>Liên hệ</a></div></Card>;
}

function LoyaltyCard({ before, earned, after, membership }: { before: number; earned: number; after: number; membership: any }) {
  return <Card title="Điểm tích lũy" eyebrow="LOYALTY LEDGER"><div className={styles.loyaltyRows}><div><span>Trước giao dịch</span><strong>{integer(before)} điểm</strong></div><div><span>Giao dịch này</span><strong className={styles.successText}>+{integer(earned)} điểm</strong></div><div className={styles.loyaltyTotal}><span>Tổng mới</span><strong>{integer(after)} điểm</strong></div></div>{membership?.tier?.name ? <Badge tone="warning">{localized(membership.tier.name)}</Badge> : null}</Card>;
}

function DeliveryCard({ delivery, email, canDeliver, busy, onDeliver }: { delivery: any; email?: string; canDeliver: boolean; busy: string; onDeliver: () => Promise<void> }) {
  return <Card title="Gửi biên nhận" eyebrow="RECEIPT DELIVERY"><div className={styles.deliveryDestination}><span>Email khách hàng</span><strong>{email ?? "Chưa có email"}</strong></div><div className={styles.deliveryStatus}><span className={statusTone(delivery?.status)}>{deliveryLabel(delivery?.status)}</span>{delivery?.destinationRedacted ? <small>{delivery.destinationRedacted}</small> : null}</div>{delivery?.status === "FAILED" || delivery?.status === "DISABLED" || !delivery ? <button type="button" className={styles.buttonOutlineFull} onClick={() => void onDeliver()} disabled={!canDeliver || Boolean(busy)}>{delivery?.status === "FAILED" ? "Gửi lại email" : "Gửi biên nhận qua email"}</button> : null}<p className={styles.helper}>{delivery?.status === "PENDING" ? "Yêu cầu đã được ghi nhận; không hiển thị thành công trước khi worker cập nhật." : "Trạng thái delivery lấy từ invoice."}</p></Card>;
}

function NextAppointmentCard({ appointment, timeZone }: { appointment: any; timeZone?: string | undefined }) {
  return <Card title="Lịch hẹn tiếp theo" eyebrow="AFTER-CARE" action={appointment ? <a className={styles.textAction} href={`/admin/appointments/${appointment.id}/overview`}>Xem lịch hẹn</a> : null}>{appointment ? <div className={styles.nextAppointment}><strong>{shortDate(appointment.scheduledStartAt, timeZone)}</strong><span>{dateTime(appointment.scheduledStartAt, timeZone)}</span><small>{appointment.bookingReference ?? "Lịch hẹn tiếp theo"}</small></div> : <p className={styles.emptyInline}>Khách chưa có lịch hẹn tiếp theo.</p>}<a className={styles.buttonOutlineFull} href={`/admin/appointments/new${appointment?.customerId ? `?customerId=${encodeURIComponent(appointment.customerId)}` : ""}`}>＋ Tạo lịch hẹn tiếp theo</a></Card>;
}

function TransactionStatusCard({ order, invoice, tipInvariant, loyalty }: { order: any; invoice: any; tipInvariant: boolean; loyalty: boolean }) {
  const checks = [{ label: "Thanh toán đã xác nhận", ok: order.status === "PAID" }, { label: "Đơn hàng đã đóng", ok: order.status === "PAID" }, { label: "Biên nhận đã phát hành", ok: invoice?.status === "ISSUED" }, { label: "Tip được ghi nhận", ok: tipInvariant }, { label: "Điểm khách hàng đã cập nhật", ok: loyalty }];
  return <Card title="Trạng thái giao dịch" eyebrow="FINANCIAL CHECKS"><div className={styles.checkList}>{checks.map((item) => <div className={item.ok ? styles.checkOk : styles.checkPending} key={item.label}><span>{item.ok ? "✓" : "!"}</span>{item.label}</div>)}</div><p className={styles.helper}>Các trạng thái được đối chiếu từ read model; delivery hoặc loyalty lỗi không làm đảo ngược payment.</p></Card>;
}

function QuickActionsCard({ order, invoice, canRefund, canPrint, canDeliver, busy, onDeliver }: { order: any; invoice: any; canRefund: boolean; canPrint: boolean; canDeliver: boolean; busy: string; onDeliver: () => Promise<void> }) {
  return <Card title="Thao tác tiếp theo" eyebrow="QUICK ACTIONS"><div className={styles.actionStack}>{canPrint ? <button type="button" className={styles.buttonOutlineFull} onClick={() => window.print()}>In lại biên nhận</button> : null}{canDeliver ? <button type="button" className={styles.buttonOutlineFull} onClick={() => void onDeliver()} disabled={Boolean(busy)}>Gửi lại email</button> : null}{order.appointmentId ? <a className={styles.buttonOutlineFull} href={`/admin/appointments/${order.appointmentId}/overview`}>Xem lịch hẹn gốc</a> : null}<a className={styles.buttonOutlineFull} href={`/admin/pos/orders/${order.id}`}>Xem đơn POS</a>{canRefund && invoice?.id ? <a className={styles.buttonOutlineFull} href={`/admin/refunds/new?invoiceId=${encodeURIComponent(invoice.id)}`}>Yêu cầu hoàn tiền</a> : null}</div></Card>;
}

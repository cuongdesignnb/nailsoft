/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { authorizedFetch } from "../auth";
import styles from "./pos-order-detail.module.css";

type Json = Record<string, any>;
type LoadState = "loading" | "ready" | "error" | "forbidden";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Đơn nháp",
  READY_FOR_PAYMENT: "Chờ thanh toán",
  PARTIALLY_PAID: "Thanh toán một phần",
  PAID: "Đã thanh toán",
  VOIDED: "Đã hủy",
};
const TENDER_LABELS: Record<string, string> = {
  CASH: "Tiền mặt",
  CARD_EXTERNAL: "Thẻ",
  BANK_TRANSFER: "Chuyển khoản",
  OTHER_EXTERNAL: "Khác",
};
const PAYMENT_STATUS_LABELS: Record<string, string> = {
  CAPTURED: "Thành công",
  FAILED: "Thất bại",
  PENDING: "Đang xử lý",
  VOIDED: "Đã hủy",
};
const DELIVERY_STATUS_LABELS: Record<string, string> = {
  PENDING: "Đang gửi",
  SENT: "Đã gửi",
  FAILED: "Gửi thất bại",
  DISABLED: "Email chưa được bật",
};
const DISCOUNT_REASON_LABELS: Record<string, string> = {
  CUSTOMER_CARE: "Chăm sóc khách hàng thân thiết",
  VIP: "Ưu đãi khách VIP",
  VOUCHER: "Voucher",
  PROMOTION: "Khuyến mãi",
};

type OrderDetail = Json & {
  lines: Json[];
  payments: Json[];
  discounts: Json[];
  approvalRequests: Json[];
  invoice?: Json | null;
  tip?: Json | null;
  customerSnapshot?: Json | null;
  appointmentSnapshot?: Json | null;
};

async function getJson<T = any>(path: string): Promise<T> {
  const response = await authorizedFetch(path);
  const body = (await response.json().catch(() => ({}))) as Json;
  if (!response.ok) {
    const error = body.error ?? {};
    const reason = new Error(error.message ?? "Không thể tải dữ liệu đơn hàng.") as Error & { status?: number; code?: string };
    reason.status = response.status;
    reason.code = error.code;
    throw reason;
  }
  return body.data as T;
}

async function optionalJson<T = any>(path: string): Promise<T | undefined> {
  try {
    return await getJson<T>(path);
  } catch {
    return undefined;
  }
}

function text(value: unknown, fallback = "—"): string {
  if (value == null || value === "") return fallback;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((item) => text(item, "")).filter(Boolean).join(", ") || fallback;
  if (typeof value === "object") {
    const item = value as Json;
    return text(item["vi-VN"] ?? item.vi ?? item.en ?? item.name ?? item.displayName ?? item.label, fallback);
  }
  return fallback;
}

function money(value: unknown, currency = "VND"): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "—";
  const units = currency === "VND" ? amount : amount / 100;
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: currency === "VND" ? 0 : 2 }).format(units);
}

function dateTime(value: unknown, timezone = "Asia/Ho_Chi_Minh"): string {
  if (!value) return "—";
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("vi-VN", { timeZone: timezone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(parsed);
}

function timeOnly(value: unknown, timezone = "Asia/Ho_Chi_Minh"): string {
  if (!value) return "—";
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("vi-VN", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(parsed);
}

function firstValue(...values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function snapshotName(snapshot: Json | null | undefined) {
  return text(firstValue(snapshot?.displayName, snapshot?.name, snapshot?.customerName), "Khách hàng");
}

function customerPhone(snapshot: Json | null | undefined) {
  return text(firstValue(snapshot?.phone, snapshot?.phoneE164, snapshot?.phoneNormalized), "—");
}

function customerEmail(snapshot: Json | null | undefined) {
  return text(firstValue(snapshot?.email, snapshot?.emailAddress), "—");
}

function lineName(line: Json) {
  const description = line.description ?? line.descriptionSnapshot ?? {};
  return text(firstValue(description?.name, description, line.sourceSnapshot?.serviceSnapshot?.name, line.serviceName), "Dịch vụ");
}

function sourceSnapshot(line: Json): Json {
  return (line.sourceSnapshot ?? line.source_snapshot ?? {}) as Json;
}

function staffEntries(line: Json): Json[] {
  const source = sourceSnapshot(line);
  const candidates = [source.staffContributions, source.contributions, source.serviceSession?.staffContributions, source.serviceSession?.contributions];
  const values = candidates.find((candidate) => Array.isArray(candidate));
  if (Array.isArray(values)) return values;
  if (source.staffId || source.staff_id || source.staffName || source.displayName) return [source];
  return [];
}

function lineStaffLabel(line: Json, staffMap: Map<string, string>) {
  const names: string[] = [];
  for (const entry of staffEntries(line)) {
    const explicit = firstValue(entry.displayName, entry.staffName, entry.name);
    const id = firstValue(entry.staffId, entry.staff_id, entry.id);
    const resolved = explicit ? text(explicit, "") : id ? staffMap.get(String(id)) : undefined;
    if (resolved && !names.includes(resolved)) names.push(resolved);
  }
  return names.length ? names.join(" + ") : "Chưa ghi nhận";
}

function itemSourceLabel(order: OrderDetail, line: Json) {
  const source = sourceSnapshot(line);
  const itemSource = String(firstValue(source.itemSource, source.item_source, source.sourceType, source.source_type, "") ?? "").toUpperCase();
  if (itemSource.includes("ADD") || itemSource.includes("EXTRA") || itemSource.includes("MANUAL")) return "Phát sinh";
  if (order.source === "APPOINTMENT" && line.appointmentItemId) return "Từ lịch hẹn";
  if (itemSource.includes("APPOINTMENT") || itemSource.includes("BOOKING")) return "Từ lịch hẹn";
  return itemSource ? text(itemSource, "—") : "—";
}

function reasonLabel(discount: Json) {
  const code = String(firstValue(discount.reasonCode, discount.reason_code, discount.code, "") ?? "").toUpperCase();
  return DISCOUNT_REASON_LABELS[code] ?? text(firstValue(discount.note, discount.reasonCode, discount.reason_code), "Ưu đãi");
}

function statusClass(status: string) {
  return styles[`status_${status}`] ?? styles.statusNeutral;
}

function permissionSet(context: Json | undefined) {
  return new Set<string>((context?.authorization?.permissions ?? []).map(String));
}

function hasPermission(permissions: Set<string>, permission: string) {
  return permissions.has(permission);
}

export default function PosOrderDetailPage({ orderId }: { orderId: string }) {
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [order, setOrder] = useState<OrderDetail>();
  const [history, setHistory] = useState<Json[]>([]);
  const [appointment, setAppointment] = useState<Json>();
  const [appointmentHistory, setAppointmentHistory] = useState<Json[]>([]);
  const [invoice, setInvoice] = useState<Json>();
  const [cashSession, setCashSession] = useState<Json>();
  const [customer, setCustomer] = useState<Json>();
  const [loyalty, setLoyalty] = useState<Json>();
  const [staff, setStaff] = useState<Json[]>([]);
  const [users, setUsers] = useState<Json[]>([]);
  const [context, setContext] = useState<Json>();
  const [refreshToken, setRefreshToken] = useState(0);
  const [deliveryMessage, setDeliveryMessage] = useState("");
  const [deliveryBusy, setDeliveryBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setState("loading");
    setError("");
    void (async () => {
      try {
        const base = await getJson<OrderDetail>(`/v1/pos-orders/${orderId}`);
        const cashPayment = (base.payments ?? []).find((payment) => payment.tenderType === "CASH" && payment.cashSessionId);
        const [nextHistory, nextAppointment, nextAppointmentHistory, nextInvoice, nextCustomer, nextLoyalty, nextStaff, nextUsers, nextContext, nextCash] = await Promise.all([
          optionalJson<Json[]>(`/v1/pos-orders/${orderId}/history`),
          base.appointmentId ? optionalJson<Json>(`/v1/appointments/${base.appointmentId}`) : Promise.resolve(undefined),
          base.appointmentId ? optionalJson<Json[]>(`/v1/appointments/${base.appointmentId}/history`) : Promise.resolve(undefined),
          base.invoice?.id ? optionalJson<Json>(`/v1/invoices/${base.invoice.id}`) : Promise.resolve(undefined),
          base.customerId ? optionalJson<Json>(`/v1/customers/${base.customerId}`) : Promise.resolve(undefined),
          base.customerId ? optionalJson<Json>(`/v1/customers/${base.customerId}/loyalty`) : Promise.resolve(undefined),
          optionalJson<Json[]>(`/v1/staff?branchId=${encodeURIComponent(base.branchId)}`),
          optionalJson<Json[]>("/v1/users"),
          optionalJson<Json>("/v1/auth/context"),
          cashPayment?.cashSessionId ? optionalJson<Json>(`/v1/cash-sessions/${cashPayment.cashSessionId}`) : Promise.resolve(undefined),
        ]);
        if (!active) return;
        setOrder(base);
        setHistory(nextHistory ?? []);
        setAppointment(nextAppointment);
        setAppointmentHistory(nextAppointmentHistory ?? []);
        setInvoice(nextInvoice ?? base.invoice ?? undefined);
        setCustomer(nextCustomer);
        setLoyalty(nextLoyalty);
        setStaff(nextStaff ?? []);
        setUsers(nextUsers ?? []);
        setContext(nextContext);
        setCashSession(nextCash);
        setState("ready");
      } catch (reason: any) {
        if (!active) return;
        setState(reason?.status === 403 ? "forbidden" : "error");
        setError(reason?.message ?? "Không thể tải đơn hàng.");
      }
    })();
    return () => {
      active = false;
    };
  }, [orderId, refreshToken]);

  const permissions = useMemo(() => permissionSet(context), [context]);
  const staffMap = useMemo(() => new Map(staff.map((member) => [String(member.id), text(member.displayName, "")])), [staff]);
  const userMap = useMemo(() => new Map(users.map((user) => [String(user.id), text(user.displayName, "")])), [users]);
  const timezone = text(firstValue(order?.appointmentSnapshot?.branch?.timezone, order?.appointmentSnapshot?.branchTimezone, (context?.branches ?? []).find((branch: Json) => branch.id === order?.branchId)?.timezone), "Asia/Ho_Chi_Minh");
  const branchName = text(firstValue(order?.appointmentSnapshot?.branch?.name, order?.appointmentSnapshot?.branchName, (context?.branches ?? []).find((branch: Json) => branch.id === order?.branchId)?.name), "Chi nhánh hiện tại");

  if (state === "loading") return <LoadingState />;
  if (state === "forbidden") return <ErrorState title="Bạn không có quyền xem đơn hàng này." detail="Dữ liệu đơn hàng không được tiết lộ ngoài phạm vi chi nhánh được cấp quyền." onRetry={() => setRefreshToken((value) => value + 1)} />;
  if (state === "error" || !order) return <ErrorState title="Không thể tải đơn hàng." detail={error} onRetry={() => setRefreshToken((value) => value + 1)} />;

  const status = String(order.status ?? "");
  const paid = status === "PAID";
  const receiptReady = paid && String((invoice ?? order.invoice)?.status ?? "") === "ISSUED";
  const paymentPermission = hasPermission(permissions, "payment.read");
  const invoicePrintPermission = hasPermission(permissions, "invoice.print");
  const invoiceDeliverPermission = hasPermission(permissions, "invoice.deliver");
  const refundPermission = hasPermission(permissions, "refund.request");
  const resolvedInvoice = invoice ?? order.invoice ?? undefined;
  const cashierId = cashSession?.cashierUserId ?? cashSession?.cashier_user_id;
  const cashierName = cashierId ? userMap.get(String(cashierId)) ?? (context?.user?.id === cashierId ? text(context?.user?.displayName) : "Chưa ghi nhận") : "Chưa ghi nhận";
  const cashPayment = (order.payments ?? []).find((payment) => payment.tenderType === "CASH");
  const currentCustomer = customer ?? {};
  const customerMembership = firstValue(currentCustomer.membership?.tierName, currentCustomer.membership?.name, currentCustomer.membershipTier, currentCustomer.tier);
  const loyaltyPoints = firstValue(loyalty?.availablePoints, loyalty?.available, loyalty?.balance, loyalty?.points);
  const lifetimeSpend = firstValue(currentCustomer.lifetimeSpendMinor, currentCustomer.totalSpendMinor, currentCustomer.totalSpentMinor);
  const historicalEmail = customerEmail(order.customerSnapshot);

  async function resendReceipt() {
    if (!resolvedInvoice?.id || !invoiceDeliverPermission || deliveryBusy) return;
    setDeliveryBusy(true);
    setDeliveryMessage("");
    try {
      const response = await authorizedFetch(`/v1/invoices/${resolvedInvoice.id}/deliver`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ channel: "EMAIL", destination: historicalEmail === "—" ? undefined : historicalEmail }),
      });
      const body = (await response.json().catch(() => ({}))) as Json;
      if (!response.ok) throw new Error(body.error?.message ?? "Không thể gửi biên nhận.");
      setDeliveryMessage("Đã tạo yêu cầu gửi biên nhận.");
      setRefreshToken((value) => value + 1);
    } catch (reason: any) {
      setDeliveryMessage(reason?.message ?? "Không thể gửi biên nhận.");
    } finally {
      setDeliveryBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <p className={styles.breadcrumb}><span>POS</span><b>/</b><span>Đơn hàng</span><b>/</b> #{order.orderNumber}</p>
          <div className={styles.titleLine}><h1>Chi tiết đơn hàng</h1><span className={styles.orderRef}>#{order.orderNumber}</span><span className={`${styles.statusBadge} ${statusClass(status)}`}>{STATUS_LABELS[status] ?? "Trạng thái đơn"}</span></div>
          <p className={styles.subtitle}>Kiểm tra dịch vụ, thanh toán và toàn bộ lịch sử xử lý của đơn hàng.</p>
        </div>
        <div className={styles.headerActions}>
          <a className={styles.secondaryButton} href="/admin/pos/orders">← <span>Danh sách đơn hàng</span></a>
          {paid && invoicePrintPermission ? <a className={styles.secondaryButton} href={`/admin/pos/orders/${order.id}/receipt`}>▣ <span>In biên nhận</span></a> : null}
          {receiptReady && invoicePrintPermission ? <a className={styles.primaryButton} href={`/admin/pos/orders/${order.id}/receipt`}>▣ <span>Xem biên nhận</span></a> : status === "PAID" ? <button className={styles.disabledButton} type="button" disabled>Biên nhận đang được hoàn tất</button> : null}
          {status === "READY_FOR_PAYMENT" || status === "PARTIALLY_PAID" ? <a className={styles.primaryButton} href={`/admin/pos/orders/${order.id}/payment`}>{status === "PARTIALLY_PAID" ? "Thu số còn lại" : "Tiếp tục thanh toán"}</a> : null}
          {status === "DRAFT" ? <a className={styles.primaryButton} href={`/admin/pos/orders/${order.id}/payment`}>Tiếp tục chỉnh đơn</a> : null}
        </div>
      </div>

      <section className={styles.hero}>
        <div className={styles.heroCustomer}><span className={styles.avatar}>{snapshotName(order.customerSnapshot).slice(0, 1)}</span><div><h2>{snapshotName(order.customerSnapshot)}</h2><p>{customerPhone(order.customerSnapshot)}</p><div className={styles.badgeRow}>{firstValue(order.customerSnapshot?.membershipTier, order.customerSnapshot?.tier) ? <span className={styles.goldBadge}>{text(firstValue(order.customerSnapshot?.membershipTier, order.customerSnapshot?.tier))}</span> : null}{order.customerSnapshot?.returningCustomer || order.customerSnapshot?.isReturning ? <span className={styles.successBadge}>Khách quay lại</span> : null}</div></div></div>
        <dl className={styles.heroMeta}><div><dt>Ngày tạo</dt><dd>{dateTime(order.createdAt, timezone)}</dd></div><div><dt>Thu ngân</dt><dd>{cashierName}</dd></div><div><dt>Chi nhánh</dt><dd>{branchName}</dd></div><div><dt>Nguồn</dt><dd>{order.source === "APPOINTMENT" ? "Lịch hẹn" : text(order.source)}</dd></div></dl>
        <div className={styles.heroAmount}><span>Tổng thanh toán</span><strong>{money(order.grandTotalMinor, order.currency)}</strong><span className={`${styles.statusBadge} ${statusClass(status)}`}>{STATUS_LABELS[status] ?? status}</span><small>{(order.payments ?? []).length ? (order.payments ?? []).map((payment) => TENDER_LABELS[payment.tenderType] ?? payment.tenderType).join(" + ") : "Chưa có giao dịch"} <b>·</b> {timeOnly((order.payments ?? []).find((payment) => payment.status === "CAPTURED")?.capturedAt, timezone)}</small></div>
      </section>

      <Lifecycle order={order} history={history} invoice={resolvedInvoice} timezone={timezone} />

      <div className={styles.contentGrid}>
        <div className={styles.leftColumn}>
          <div className={styles.splitGrid}>
            <LinesCard order={order} staffMap={staffMap} currency={order.currency} />
            <div className={styles.stack}><DiscountCard order={order} userMap={userMap} currency={order.currency} /><TipCard tip={order.tip} staffMap={staffMap} currency={order.currency} /></div>
          </div>
          {paymentPermission ? <PaymentsCard order={order} currency={order.currency} /> : null}
          <ActivityCard order={order} history={history} invoice={resolvedInvoice} timezone={timezone} userMap={userMap} />
        </div>
        <aside className={styles.rightColumn}>
          <SummaryCard order={order} currency={order.currency} />
          <CustomerCard order={order} currentCustomer={currentCustomer} membership={customerMembership} loyaltyPoints={loyaltyPoints} lifetimeSpend={lifetimeSpend} />
          <AppointmentSourceCard order={order} appointment={appointment} appointmentHistory={appointmentHistory} timezone={timezone} staffMap={staffMap} />
          {cashPayment?.cashSessionId ? <CashSessionCard payment={cashPayment} session={cashSession} cashierName={cashierName} timezone={timezone} /> : null}
          <ReceiptCard invoice={resolvedInvoice} deliveryMessage={deliveryMessage} canPrint={invoicePrintPermission} canDeliver={invoiceDeliverPermission} onResend={resendReceipt} deliveryBusy={deliveryBusy} />
          {loyaltyPoints !== undefined ? <LoyaltyCard loyalty={loyalty} points={loyaltyPoints} /> : null}
          <ActionsCard order={order} invoice={resolvedInvoice} canPrint={invoicePrintPermission} canDeliver={invoiceDeliverPermission} canRefund={refundPermission} onResend={resendReceipt} deliveryBusy={deliveryBusy} />
          {paid ? <CorrectionNotice canRefund={refundPermission} /> : null}
        </aside>
      </div>

      <footer className={styles.stickyFooter}><a className={styles.secondaryButton} href="/admin/pos/orders">← Danh sách đơn hàng</a><div>{paid && invoicePrintPermission ? <a className={styles.secondaryButton} href={`/admin/pos/orders/${order.id}/receipt`}>In biên nhận</a> : null}{paid && invoiceDeliverPermission ? <button className={styles.secondaryButton} type="button" onClick={() => void resendReceipt()} disabled={deliveryBusy}>Gửi email</button> : null}{receiptReady && invoicePrintPermission ? <a className={styles.primaryButton} href={`/admin/pos/orders/${order.id}/receipt`}>Xem biên nhận</a> : null}{status === "READY_FOR_PAYMENT" || status === "PARTIALLY_PAID" ? <a className={styles.primaryButton} href={`/admin/pos/orders/${order.id}/payment`}>{status === "PARTIALLY_PAID" ? "Thu số còn lại" : "Tiếp tục thanh toán"}</a> : null}{status === "DRAFT" ? <a className={styles.primaryButton} href={`/admin/pos/orders/${order.id}/payment`}>Tiếp tục chỉnh đơn</a> : null}</div></footer>
    </main>
  );
}

function LoadingState() {
  return <main className={styles.page}><div className={styles.skeletonHeader}><span /><span /><span /></div><div className={styles.skeletonHero}><span /><span /><span /></div><div className={styles.skeletonGrid}><div><span /><span /><span /><span /></div><div><span /><span /><span /></div></div></main>;
}

function ErrorState({ title, detail, onRetry }: { title: string; detail: string; onRetry: () => void }) {
  return <main className={styles.page}><section className={styles.errorState}><span className={styles.errorIcon}>!</span><h1>{title}</h1><p>{detail}</p><div><button className={styles.primaryButton} type="button" onClick={onRetry}>Thử lại</button><a className={styles.secondaryButton} href="/admin/pos/orders">Danh sách đơn hàng</a></div></section></main>;
}

function Lifecycle({ order, history, invoice, timezone }: { order: OrderDetail; history: Json[]; invoice: Json | undefined; timezone: string }) {
  const transition = (toStatus: string) => history.find((item) => String(firstValue(item.toStatus, item.to_status, "")) === toStatus);
  const finalizedAt = firstValue(order.finalizedAt, transition("READY_FOR_PAYMENT")?.createdAt, transition("READY_FOR_PAYMENT")?.created_at);
  const paidAt = firstValue(order.paidAt, (order.payments ?? []).find((payment) => payment.status === "CAPTURED")?.capturedAt);
  const steps = [
    ["Tạo đơn", order.createdAt],
    ["Hoàn thiện giỏ hàng", finalizedAt],
    ["Chờ thanh toán", finalizedAt],
    ["Thanh toán", paidAt],
    ["Phát hành biên nhận", invoice?.issuedAt],
  ];
  const doneCount = order.status === "VOIDED" ? 1 : steps.reduce((count, [, timestamp]) => count + (timestamp ? 1 : 0), 0);
  return <section className={styles.lifecycle} aria-label="Vòng đời đơn hàng">{steps.map(([label, timestamp], index) => <div className={`${styles.lifecycleStep} ${timestamp ? styles.lifecycleDone : ""} ${index + 1 === doneCount ? styles.lifecycleCurrent : ""}`} key={String(label)}><span className={styles.lifecycleDot}>{timestamp ? "✓" : index + 1}</span><div><strong>{label}</strong><small>{timestamp ? dateTime(timestamp, timezone) : "Chưa ghi nhận"}</small></div>{index < steps.length - 1 ? <i /> : null}</div>)}</section>;
}

function LinesCard({ order, staffMap, currency }: { order: OrderDetail; staffMap: Map<string, string>; currency: string }) {
  const lines = order.lines ?? [];
  const grossTotal = lines.reduce((sum, line) => sum + Number(line.grossMinor ?? 0), 0);
  return <section className={styles.card}><div className={styles.cardHeading}><div><span className={styles.sectionKicker}>CHI TIẾT</span><h2>Dịch vụ &amp; sản phẩm</h2></div><span className={styles.countPill}>{lines.length} dòng</span></div><div className={styles.tableWrap} tabIndex={0} aria-label="Bảng dịch vụ và sản phẩm"><table className={styles.dataTable}><thead><tr><th scope="col">Nội dung</th><th scope="col">Nguồn</th><th scope="col">Nhân viên</th><th scope="col">Số lượng</th><th scope="col">Đơn giá</th><th scope="col">Thành tiền</th></tr></thead><tbody>{lines.map((line) => <tr key={line.id}><td><strong>{lineName(line)}</strong>{line.description?.description ? <small>{text(line.description.description)}</small> : null}</td><td><span className={styles.sourceBadge}>{itemSourceLabel(order, line)}</span></td><td>{lineStaffLabel(line, staffMap)}</td><td>{text(line.quantity, "1")}</td><td>{money(line.unitPriceMinor, currency)}</td><td><strong>{money(line.grossMinor, currency)}</strong></td></tr>)}</tbody></table></div><div className={styles.cardFooter}><span>{lines.length} dòng</span><strong>{money(grossTotal, currency)}</strong></div></section>;
}

function DiscountCard({ order, userMap, currency }: { order: OrderDetail; userMap: Map<string, string>; currency: string }) {
  const discounts = order.discounts ?? [];
  if (!discounts.length) return <section className={styles.card}><div className={styles.cardHeading}><h2>Ưu đãi &amp; giảm giá</h2></div><div className={styles.mutedBox}>Đơn hàng không có ưu đãi.</div></section>;
  return <section className={styles.card}><div className={styles.cardHeading}><h2>Ưu đãi &amp; giảm giá</h2><strong className={styles.positiveAmount}>-{money(order.discountMinor, currency)}</strong></div>{discounts.map((discount) => { const actor = firstValue(discount.actorUserId, discount.actor_user_id, discount.createdByUserId); return <div className={styles.detailRow} key={discount.id}><div><strong>{reasonLabel(discount)}</strong><small>{actor ? `Áp dụng bởi ${userMap.get(String(actor)) ?? "nhân viên được phân quyền"}` : "Ưu đãi đã được ghi nhận"}</small>{discount.approvalStatus ? <span className={styles.warningBadge}>{text(discount.approvalStatus)}</span> : null}</div><strong className={styles.positiveAmount}>-{money(discount.amountMinor, currency)}</strong></div>; })}</section>;
}

function TipCard({ tip, staffMap, currency }: { tip: Json | null | undefined; staffMap: Map<string, string>; currency: string }) {
  if (!tip) return <section className={styles.card}><div className={styles.cardHeading}><h2>Tiền tip</h2></div><div className={styles.mutedBox}>Chưa có tiền tip.</div></section>;
  const allocations = Array.isArray(tip.allocations) ? tip.allocations : [];
  const total = Number(tip.amountMinor ?? 0);
  const allocationTotal = allocations.reduce((sum: number, item: Json) => sum + Number(item.amountMinor ?? 0), 0);
  const basis = String(tip.allocationBasis ?? allocations[0]?.allocationBasis ?? "").toUpperCase();
  const helper = basis === "EQUAL" ? "Phân bổ đều." : basis === "MANUAL" ? "Phân bổ thủ công." : basis === "WORK_SECONDS" ? "Phân bổ theo thời gian thực hiện dịch vụ." : "Theo cấu hình phân bổ đã lưu.";
  return <section className={styles.card}><div className={styles.cardHeading}><h2>Tiền tip</h2><strong className={styles.positiveAmount}>{money(total, currency)}</strong></div><p className={styles.helper}>{helper}</p>{allocationTotal !== total ? <div className={styles.warningBox}>Không thể xác minh phân bổ tip. Vui lòng tải lại.</div> : allocations.map((allocation: Json) => <div className={styles.detailRow} key={allocation.id ?? `${allocation.staffId}-${allocation.amountMinor}`}><span>{staffMap.get(String(allocation.staffId)) ?? text(firstValue(allocation.staffName, allocation.displayName), "Nhân viên chưa xác định")}</span><strong>{money(allocation.amountMinor, currency)}</strong></div>)}</section>;
}

function PaymentsCard({ order, currency }: { order: OrderDetail; currency: string }) {
  const payments = order.payments ?? [];
  return <section className={styles.card}><div className={styles.cardHeading}><div><span className={styles.sectionKicker}>FINANCIAL EVIDENCE</span><h2>Giao dịch thanh toán</h2></div><span className={styles.countPill}>{payments.length} giao dịch</span></div><div className={styles.tableWrap} tabIndex={0} aria-label="Bảng giao dịch thanh toán"><table className={styles.dataTable}><thead><tr><th scope="col">Thời gian</th><th scope="col">Phương thức</th><th scope="col">Số tiền</th><th scope="col">Trạng thái</th><th scope="col">Mã tham chiếu</th></tr></thead><tbody>{payments.length ? payments.map((payment) => <tr key={payment.id}><td>{dateTime(firstValue(payment.capturedAt, payment.createdAt), "Asia/Ho_Chi_Minh")}</td><td><strong>{TENDER_LABELS[payment.tenderType] ?? text(payment.tenderType)}</strong>{payment.tenderType === "CARD_EXTERNAL" && (payment.cardBrand || payment.cardLast4) ? <small>{text(payment.cardBrand)} · •••• {text(payment.cardLast4)}</small> : null}{payment.tenderType === "CASH" && payment.cashReceivedMinor != null ? <small>Khách đưa {money(payment.cashReceivedMinor, currency)} · Thừa {money(payment.changeDueMinor, currency)}</small> : null}</td><td><strong>{money(payment.capturedMinor, currency)}</strong></td><td><span className={`${styles.statusBadge} ${payment.status === "CAPTURED" ? styles.status_PAID : payment.status === "FAILED" ? styles.status_VOIDED : styles.statusNeutral}`}>{PAYMENT_STATUS_LABELS[payment.status] ?? text(payment.status)}</span></td><td>{text(payment.paymentReference)}</td></tr>) : <tr><td colSpan={5} className={styles.emptyCell}>Chưa có giao dịch thanh toán.</td></tr>}</tbody></table></div><div className={styles.paymentTotals}><span>Đã thanh toán <strong>{money(order.amountPaidMinor, currency)}</strong></span><span>Còn lại <strong className={Number(order.amountDueMinor) > 0 ? styles.warningText : styles.positiveAmount}>{money(order.amountDueMinor, currency)}</strong></span></div></section>;
}

function ActivityCard({ order, history, invoice, timezone, userMap }: { order: OrderDetail; history: Json[]; invoice: Json | undefined; timezone: string; userMap: Map<string, string> }) {
  const events = useMemo(() => buildActivities(order, history, invoice, userMap), [history, invoice, order, userMap]);
  return <section className={styles.card}><div className={styles.cardHeading}><div><span className={styles.sectionKicker}>AUDIT TRAIL</span><h2>Lịch sử hoạt động</h2></div><span className={styles.mutedText}>{events.length} sự kiện đã lưu</span></div>{events.length ? <ol className={styles.activityList}>{events.map((event) => <li key={event.key}><span className={`${styles.activityDot} ${event.tone ? styles[`activity_${event.tone}`] : ""}`}>{event.type === "PAYMENT" ? "₫" : event.type === "INVOICE" ? "▣" : event.type === "DISCOUNT" ? "%" : event.type === "TIP" ? "T" : "•"}</span><div><strong>{event.label}</strong><small>{dateTime(event.occurredAt, timezone)}{event.detail ? ` · ${event.detail}` : ""}</small></div>{event.amount != null ? <b>{money(event.amount, order.currency)}</b> : null}</li>)}</ol> : <div className={styles.mutedBox}>Chưa có lịch sử hoạt động được ghi nhận.</div>}</section>;
}

type Activity = { key: string; type: string; occurredAt: string; label: string; detail?: string | undefined; amount?: number; tone?: string };
function buildActivities(order: OrderDetail, history: Json[], invoice: Json | undefined, userMap: Map<string, string>): Activity[] {
  const events: Activity[] = [];
  if (order.createdAt) events.push({ key: `created-${order.id}`, type: "ORDER", occurredAt: order.createdAt, label: "Đơn POS được tạo", detail: order.source === "APPOINTMENT" ? "Từ lịch hẹn" : undefined, tone: "pink" });
  history.forEach((item, index) => { const occurredAt = String(firstValue(item.createdAt, item.created_at, "")); if (!occurredAt) return; const to = String(firstValue(item.toStatus, item.to_status, "")); const label = to === "READY_FOR_PAYMENT" ? "Đơn đã sẵn sàng thanh toán" : to === "PARTIALLY_PAID" ? "Đơn được thanh toán một phần" : to === "PAID" ? "Thanh toán đã hoàn tất" : to === "VOIDED" ? "Đơn đã hủy" : `Đơn chuyển sang ${STATUS_LABELS[to] ?? to}`; events.push({ key: `history-${item.id ?? index}`, type: "STATUS", occurredAt, label, detail: text(firstValue(item.note, item.reasonCode, item.reason_code), ""), tone: to === "PAID" ? "green" : "pink" }); });
  (order.discounts ?? []).forEach((discount, index) => { const occurredAt = String(firstValue(discount.createdAt, discount.created_at, "")); if (!occurredAt) return; const actor = firstValue(discount.actorUserId, discount.actor_user_id, discount.createdByUserId); events.push({ key: `discount-${discount.id ?? index}`, type: "DISCOUNT", occurredAt, label: "Áp dụng ưu đãi", detail: actor ? userMap.get(String(actor)) ?? "Nhân viên được phân quyền" : reasonLabel(discount), amount: Number(discount.amountMinor ?? 0), tone: "gold" }); });
  if (order.tip?.createdAt) events.push({ key: `tip-${order.tip.id ?? "active"}`, type: "TIP", occurredAt: order.tip.createdAt, label: "Thêm tiền tip", amount: Number(order.tip.amountMinor ?? 0), tone: "purple" });
  (order.payments ?? []).forEach((payment, index) => { const occurredAt = String(firstValue(payment.capturedAt, payment.createdAt, "")); if (!occurredAt) return; events.push({ key: `payment-${payment.id ?? index}`, type: "PAYMENT", occurredAt, label: payment.status === "CAPTURED" ? "Thanh toán thành công" : `Giao dịch ${PAYMENT_STATUS_LABELS[payment.status] ?? text(payment.status)}`, detail: TENDER_LABELS[payment.tenderType] ?? payment.tenderType, amount: Number(payment.capturedMinor ?? 0), tone: payment.status === "CAPTURED" ? "green" : "pink" }); });
  if (invoice?.issuedAt) events.push({ key: `invoice-${invoice.id}`, type: "INVOICE", occurredAt: invoice.issuedAt, label: `Biên nhận ${text(invoice.invoiceNumber)} được phát hành`, tone: "green" });
  return events.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
}

function SummaryCard({ order, currency }: { order: OrderDetail; currency: string }) {
  return <section className={styles.card}><div className={styles.cardHeading}><h2>Tóm tắt đơn hàng</h2></div><dl className={styles.summaryList}><div><dt>Dịch vụ / Tạm tính</dt><dd>{money(order.subtotalMinor, currency)}</dd></div><div><dt>Giảm giá</dt><dd className={styles.positiveAmount}>-{money(order.discountMinor, currency)}</dd></div><div><dt>Thuế</dt><dd>{money(order.taxMinor, currency)}</dd></div><div><dt>Tip</dt><dd>{money(order.tipMinor, currency)}</dd></div><div className={styles.summaryTotal}><dt>Tổng cộng</dt><dd>{money(order.grandTotalMinor, currency)}</dd></div><div><dt>Đã thanh toán</dt><dd>{money(order.amountPaidMinor, currency)}</dd></div><div><dt>Còn lại</dt><dd className={Number(order.amountDueMinor) > 0 ? styles.warningText : styles.positiveAmount}>{money(order.amountDueMinor, currency)}</dd></div></dl><span className={`${styles.statusBadge} ${statusClass(String(order.status))}`}>{STATUS_LABELS[String(order.status)] ?? String(order.status)}</span></section>;
}

function CustomerCard({ order, currentCustomer, membership, loyaltyPoints, lifetimeSpend }: { order: OrderDetail; currentCustomer: Json; membership: unknown; loyaltyPoints: unknown; lifetimeSpend: unknown }) {
  return <section className={styles.card}><div className={styles.cardHeading}><h2>Khách hàng</h2></div><div className={styles.customerMini}><span className={styles.avatarSmall}>{snapshotName(order.customerSnapshot).slice(0, 1)}</span><div><strong>{snapshotName(order.customerSnapshot)}</strong><div className={styles.badgeRow}>{membership ? <span className={styles.goldBadge}>{text(membership)}</span> : null}{currentCustomer.isReturning || currentCustomer.returningCustomer ? <span className={styles.successBadge}>Khách quay lại</span> : null}</div></div></div><dl className={styles.summaryList}><div><dt>SĐT</dt><dd>{customerPhone(order.customerSnapshot)}</dd></div><div><dt>Email</dt><dd>{customerEmail(order.customerSnapshot)}</dd></div>{loyaltyPoints !== undefined ? <div><dt>Điểm tích lũy</dt><dd>{text(loyaltyPoints)}</dd></div> : null}{lifetimeSpend !== undefined ? <div><dt>Tổng chi tiêu</dt><dd>{money(lifetimeSpend, order.currency)}</dd></div> : null}</dl><div className={styles.inlineActions}><a className={styles.outlineButton} href={`/admin/customers/${order.customerId}`}>Xem hồ sơ</a><a className={styles.outlineButton} href={`/admin/customers/${order.customerId}`}>Liên hệ</a></div></section>;
}

function AppointmentSourceCard({ order, appointment, appointmentHistory, timezone, staffMap }: { order: OrderDetail; appointment: Json | undefined; appointmentHistory: Json[]; timezone: string; staffMap: Map<string, string> }) {
  if (order.source !== "APPOINTMENT" && !order.appointmentId) return <section className={styles.card}><div className={styles.cardHeading}><h2>Nguồn đơn hàng</h2></div><div className={styles.mutedBox}>Đơn hàng độc lập tại quầy.</div></section>;
  const reference = text(firstValue(order.appointmentSnapshot?.reference, order.appointmentSnapshot?.bookingReference, appointment?.reference, appointment?.bookingReference), order.appointmentId ? `#${order.appointmentId.slice(0, 8)}` : "Lịch hẹn");
  const timeFor = (kind: string, keys: string[]) => firstValue(...keys.map((key) => appointment?.[key]), ...keys.map((key) => order.appointmentSnapshot?.[key]), appointmentHistory.find((item) => String(firstValue(item.toStatus, item.to_status, "")).toUpperCase().includes(kind))?.createdAt);
  const staffNames = Array.from(new Set((order.lines ?? []).flatMap((line) => lineStaffLabel(line, staffMap).split(" + ").filter((name) => name !== "Chưa ghi nhận"))));
  return <section className={styles.card}><div className={styles.cardHeading}><h2>Nguồn đơn hàng</h2><span className={styles.sourceBadge}>Từ lịch hẹn</span></div><a className={styles.referenceLink} href={order.appointmentId ? `/admin/appointments/${order.appointmentId}/overview` : "#"}>{reference} ↗</a><dl className={styles.summaryList}><div><dt>Check-in</dt><dd>{timeOnly(timeFor("CHECK", ["checkedInAt", "checkInAt", "arrivalAt"]), timezone)}</dd></div><div><dt>Bắt đầu phục vụ</dt><dd>{timeOnly(timeFor("SERVICE", ["serviceStartedAt", "startedAt", "executionStartedAt"]), timezone)}</dd></div><div><dt>Hoàn thành</dt><dd>{timeOnly(timeFor("COMPLET", ["completedAt", "finishedAt", "checkoutAt"]), timezone)}</dd></div><div><dt>Kỹ thuật viên</dt><dd>{staffNames.length ? staffNames.join(", ") : "Chưa ghi nhận"}</dd></div></dl><a className={styles.outlineButtonFull} href={order.appointmentId ? `/admin/appointments/${order.appointmentId}/overview` : "#"}>Mở lịch hẹn →</a></section>;
}

function CashSessionCard({ payment, session, cashierName, timezone }: { payment: Json; session: Json | undefined; cashierName: string; timezone: string }) {
  if (!session) return <section className={styles.card}><div className={styles.cardHeading}><h2>Phiên thu ngân</h2></div><div className={styles.warningBox}>Không tải được thông tin ca tiền mặt.</div></section>;
  return <section className={styles.card}><div className={styles.cardHeading}><h2>Phiên thu ngân</h2><span className={styles.successBadge}>{text(session.status, "Đang mở")}</span></div><dl className={styles.summaryList}><div><dt>Quầy</dt><dd>{text(firstValue(session.registerCode, session.drawerCode, payment.registerId), "—")}</dd></div><div><dt>Thu ngân</dt><dd>{cashierName}</dd></div><div><dt>Phiên</dt><dd>{text(firstValue(session.sessionCode, session.id), "—")}</dd></div><div><dt>Mở lúc</dt><dd>{dateTime(session.openedAt, timezone)}</dd></div></dl><a className={styles.outlineButtonFull} href={`/admin/pos/cash-sessions/${session.id}`}>Xem phiên thu ngân</a></section>;
}

function ReceiptCard({ invoice, deliveryMessage, canPrint, canDeliver, onResend, deliveryBusy }: { invoice: Json | undefined; deliveryMessage: string; canPrint: boolean; canDeliver: boolean; onResend: () => void; deliveryBusy: boolean }) {
  if (!invoice) return <section className={styles.card}><div className={styles.cardHeading}><h2>Biên nhận</h2></div><div className={styles.mutedBox}>Chưa có bản ghi biên nhận.</div></section>;
  const deliveries = Array.isArray(invoice.deliveries) ? invoice.deliveries : [];
  const latest = deliveries[deliveries.length - 1];
  return <section className={styles.card}><div className={styles.cardHeading}><h2>Biên nhận</h2><span className={`${styles.statusBadge} ${invoice.status === "ISSUED" ? styles.status_PAID : styles.statusNeutral}`}>{invoice.status === "ISSUED" ? "Đã phát hành" : text(invoice.status)}</span></div><strong className={styles.invoiceNumber}>#{text(invoice.invoiceNumber)}</strong><p className={styles.mutedText}>{invoice.issuedAt ? `Phát hành ${dateTime(invoice.issuedAt)}` : "Chưa phát hành"}</p>{latest ? <div className={styles.deliveryLine}><span>Email · {text(latest.destinationRedacted, "địa chỉ đã ẩn")}</span><strong>{DELIVERY_STATUS_LABELS[latest.status] ?? text(latest.status)}</strong></div> : null}<div className={styles.inlineActions}>{canPrint && invoice.status === "ISSUED" ? <a className={styles.outlineButton} href={`/admin/pos/orders/${invoice.orderId}/receipt`}>Xem biên nhận</a> : null}{canDeliver && invoice.status === "ISSUED" ? <button className={styles.outlineButton} type="button" onClick={onResend} disabled={deliveryBusy}>{deliveryBusy ? "Đang gửi…" : "Gửi lại email"}</button> : null}</div>{deliveryMessage ? <p className={styles.inlineMessage} role="status">{deliveryMessage}</p> : null}</section>;
}

function LoyaltyCard({ loyalty, points }: { loyalty: Json | undefined; points: unknown }) {
  const tier = firstValue(loyalty?.tierName, loyalty?.membershipTier, loyalty?.tier);
  return <section className={styles.card}><div className={styles.cardHeading}><h2>Điểm tích lũy</h2>{tier ? <span className={styles.goldBadge}>{text(tier)}</span> : null}</div><div className={styles.loyaltyValue}>{text(points)} <small>điểm</small></div>{loyalty?.availablePoints != null && loyalty?.nextTierThreshold != null ? <div className={styles.progress}><span style={{ width: `${Math.min(100, Number(loyalty.availablePoints) / Math.max(1, Number(loyalty.nextTierThreshold)) * 100)}%` }} /></div> : null}</section>;
}

function ActionsCard({ order, invoice, canPrint, canDeliver, canRefund, onResend, deliveryBusy }: { order: OrderDetail; invoice: Json | undefined; canPrint: boolean; canDeliver: boolean; canRefund: boolean; onResend: () => void; deliveryBusy: boolean }) {
  const paid = order.status === "PAID";
  return <section className={styles.card}><div className={styles.cardHeading}><h2>Thao tác</h2></div>{paid && canPrint && invoice?.status === "ISSUED" ? <a className={styles.actionButton} href={`/admin/pos/orders/${order.id}/receipt`}>Xem biên nhận</a> : null}{paid && canPrint && invoice?.status === "ISSUED" ? <a className={styles.actionButton} href={`/admin/pos/orders/${order.id}/receipt`}>In biên nhận</a> : null}{paid && canDeliver && invoice?.status === "ISSUED" ? <button className={styles.actionButton} type="button" onClick={onResend} disabled={deliveryBusy}>Gửi lại email</button> : null}{order.appointmentId ? <a className={styles.actionButton} href={`/admin/appointments/${order.appointmentId}/overview`}>Mở lịch hẹn gốc</a> : null}{paid && canRefund ? <a className={styles.dangerButton} href="/admin/refunds/new">Yêu cầu hoàn tiền</a> : null}{!paid ? <span className={styles.mutedText}>Thao tác tài chính sẽ mở theo trạng thái đơn hàng.</span> : null}</section>;
}

function CorrectionNotice({ canRefund }: { canRefund: boolean }) {
  return <section className={styles.correction}><span className={styles.correctionIcon}>!</span><div><h2>Cần điều chỉnh giao dịch?</h2><p>Đơn đã thanh toán không thể sửa trực tiếp. Các thay đổi tài chính phải thực hiện qua quy trình hoàn tiền hoặc chứng từ điều chỉnh.</p>{canRefund ? <a href="/admin/refunds/new">Xem quy trình hoàn tiền →</a> : null}</div></section>;
}

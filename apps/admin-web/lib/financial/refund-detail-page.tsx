"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { authorizedFetch, getAuthContext } from "../auth";
import styles from "./refund-detail-page.module.css";

type RefundStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "PROCESSING" | "COMPLETED" | "FAILED" | "UNKNOWN" | "REJECTED" | "CANCELLED";
type AuthContext = Awaited<ReturnType<typeof getAuthContext>>;
type HistoryEvent = { id?: string; from_status?: string | null; to_status: string; actor_type?: string; actor_display_name?: string | null; note?: string | null; reason_code?: string | null; created_at: string };
type RefundDetail = {
  id: string;
  branchId: string;
  invoiceId: string;
  posOrderId: string;
  refundReference: string;
  status: RefundStatus;
  refundKind?: string | null;
  currency: string;
  requestedMinor: number;
  approvedMinor: number | null;
  completedMinor: number;
  serviceRefundMinor: number;
  taxRefundMinor: number;
  tipRefundMinor: number;
  reasonCode: string;
  reasonText: string;
  refundDestination?: string;
  policy?: any;
  approvalReason?: string | null;
  rejectionReason?: string | null;
  version: number;
  requestedAt: string;
  approvedAt?: string | null;
  processingAt?: string | null;
  completedAt?: string | null;
  failedAt?: string | null;
  cancelledAt?: string | null;
  items: any[];
  paymentAllocations: any[];
  creditNote?: any | null;
  context?: {
    branch?: { id: string; name: string | null; code?: string | null; timezone?: string | null; status?: string | null };
    customer?: { id?: string | null; displayName?: string | null; phone?: string | null; email?: string | null };
    invoice?: { id: string; invoiceNumber?: string | null; status?: string | null; currency?: string; subtotalMinor?: number; discountMinor?: number; taxableMinor?: number; taxMinor?: number; tipMinor?: number; totalMinor?: number; paidMinor?: number; issuedAt?: string | null; href: string };
    order?: { id: string; orderNumber?: string | null; status?: string | null; source?: string | null; appointmentId?: string | null; href: string };
    appointment?: { id: string; bookingReference?: string | null; status?: string | null; startAt?: string | null; endAt?: string | null; href: string } | null;
    requester?: { id: string; displayName: string } | null;
    approver?: { id: string; displayName: string } | null;
    processedBy?: { id: string; displayName: string } | null;
    originalPayments?: any[];
    cashEvidence?: any | null;
    remainingRefundableMinor?: number;
    policy?: any;
  };
};

const STATUS_LABEL: Record<string, string> = { DRAFT: "Bản nháp", PENDING_APPROVAL: "Chờ phê duyệt", APPROVED: "Đã duyệt", PROCESSING: "Đang xử lý", COMPLETED: "Hoàn thành", FAILED: "Thất bại", UNKNOWN: "Chưa xác định", REJECTED: "Đã từ chối", CANCELLED: "Đã hủy" };
const STATUS_TONE: Record<string, string> = { DRAFT: "gray", PENDING_APPROVAL: "amber", APPROVED: "blue", PROCESSING: "blue", COMPLETED: "green", FAILED: "red", UNKNOWN: "purple", REJECTED: "gray", CANCELLED: "gray" };
const KIND_LABEL: Record<string, string> = { FULL: "Hoàn toàn bộ", PARTIAL: "Hoàn một phần", TIP_ONLY: "Hoàn tip", MIXED: "Hoàn nhiều khoản", CUSTOMER_CREDIT: "Tín dụng khách hàng" };
const TENDER_LABEL: Record<string, string> = { CASH: "Tiền mặt", CARD_EXTERNAL: "Thẻ", BANK_TRANSFER: "Chuyển khoản", OTHER_EXTERNAL: "Khác" };
const REASON_LABEL: Record<string, string> = { CUSTOMER_REQUEST: "Khách hàng yêu cầu", SERVICE_QUALITY: "Chất lượng dịch vụ", DUPLICATE_CHARGE: "Tính tiền trùng", OTHER: "Lý do khác" };
const FLOW_LABEL: Record<string, string> = { DRAFT: "Tạo yêu cầu", PENDING_APPROVAL: "Gửi phê duyệt", APPROVED: "Phê duyệt", PROCESSING: "Xử lý hoàn tiền", COMPLETED: "Hoàn tất", REJECTED: "Từ chối", CANCELLED: "Hủy yêu cầu", FAILED: "Xử lý thất bại", UNKNOWN: "Provider chưa xác định" };

function unwrap(body: any) { return body?.data; }
async function json(path: string, init?: RequestInit) {
  const response = await authorizedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body?.error?.message ?? "Không thể tải dữ liệu."), { status: response.status, code: body?.error?.code });
  return unwrap(body);
}
function hasPermission(context: AuthContext | undefined, permission: string) { const permissions = context?.supportAccess?.permissions ?? context?.authorization.permissions ?? []; return permissions.includes(permission); }
function money(value: number | null | undefined, currency = "VND") { return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value ?? 0); }
function dateTime(value?: string | null, timezone?: string | null) { if (!value) return "—"; return new Intl.DateTimeFormat("vi-VN", { timeZone: timezone || undefined, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function pick(value: any, ...keys: string[]) { for (const key of keys) if (value?.[key] !== undefined && value?.[key] !== null) return value[key]; return null; }
function itemDescription(item: any) { const snapshot = item.sourceSnapshot ?? item.source_snapshot_json ?? {}; const description = snapshot.description; if (typeof description === "string") return description; if (description?.name) return description.name; if (description?.description) return description.description; return item.itemType === "TIP" || item.item_type === "TIP" ? "Tip" : "Khoản mục hóa đơn"; }
function refundKind(data: RefundDetail) { if (data.refundKind && KIND_LABEL[data.refundKind]) return data.refundKind; if (data.refundDestination === "CUSTOMER_CREDIT") return "CUSTOMER_CREDIT"; if (data.tipRefundMinor > 0 && data.serviceRefundMinor + data.taxRefundMinor === 0) return "TIP_ONLY"; if (data.tipRefundMinor > 0) return "MIXED"; const invoiceTotal = data.context?.invoice?.totalMinor ?? 0; return invoiceTotal > 0 && data.requestedMinor >= invoiceTotal ? "FULL" : "PARTIAL"; }
function statusTone(status: string) { return STATUS_TONE[status] ?? "gray"; }

function Pill({ tone = "gray", children }: { tone?: string; children: ReactNode }) { return <span className={`${styles.pill} ${styles[`pill${tone[0]!.toUpperCase()}${tone.slice(1)}`] ?? styles.pillGray}`}>{children}</span>; }
function IconCircle({ tone = "rose", children }: { tone?: string; children: ReactNode }) { return <span className={`${styles.iconCircle} ${styles[`icon${tone[0]!.toUpperCase()}${tone.slice(1)}`] ?? styles.iconRose}`} aria-hidden="true">{children}</span>; }
function Row({ label, children }: { label: string; children: ReactNode }) { return <div className={styles.row}><dt>{label}</dt><dd>{children}</dd></div>; }
function Card({ title, eyebrow, children, className = "" }: { title: string; eyebrow?: string; children: ReactNode; className?: string | undefined }) { return <section className={`${styles.card} ${className}`}><header className={styles.cardHeader}>{<div>{eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}<h2>{title}</h2></div>}</header>{children}</section>; }
function LinkButton({ href, children, tone = "quiet" }: { href: string; children: ReactNode; tone?: string }) { return <Link className={`${styles.linkButton} ${tone === "danger" ? styles.dangerButton : ""}`} href={href}>{children}<span aria-hidden="true">→</span></Link>; }
function CheckRow({ label, state, detail }: { label: string; state: "ok" | "warn" | "na"; detail?: string | undefined }) { return <div className={styles.checkRow}><span className={`${styles.checkIcon} ${styles[`check${state[0]!.toUpperCase()}${state.slice(1)}`]}`} aria-hidden="true">{state === "ok" ? "✓" : state === "warn" ? "!" : "–"}</span><div><strong>{label}</strong>{detail ? <small>{detail}</small> : null}</div></div>; }

export default function RefundDetailPage({ refundId }: { refundId: string }) {
  const [data, setData] = useState<RefundDetail>();
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [context, setContext] = useState<AuthContext>();
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [evidenceViewed, setEvidenceViewed] = useState(false);
  const [online, setOnline] = useState(true);
  const idempotencyKeys = useRef<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true); setError(""); setHistoryError("");
    const [detailResult, historyResult, authResult] = await Promise.allSettled([
      json(`/v1/refunds/${encodeURIComponent(refundId)}`),
      json(`/v1/refunds/${encodeURIComponent(refundId)}/history`),
      getAuthContext(),
    ]);
    if (detailResult.status === "rejected") setError(detailResult.reason instanceof Error ? detailResult.reason.message : "Không thể tải yêu cầu hoàn tiền.");
    else setData(detailResult.value as RefundDetail);
    if (historyResult.status === "fulfilled") setHistory(Array.isArray(historyResult.value) ? historyResult.value : []);
    else setHistoryError("Không thể tải lịch sử xử lý.");
    if (authResult.status === "fulfilled") setContext(authResult.value);
    if (detailResult.status === "fulfilled" && authResult.status === "fulfilled" && hasPermission(authResult.value, "refund.view_provider_metadata")) {
      try { const result = await json(`/v1/refunds/${encodeURIComponent(refundId)}/attempts`); setAttempts(Array.isArray(result) ? result : []); } catch (reason: any) { if (reason?.status !== 403) setAttempts([]); }
    }
    setLoading(false);
  }, [refundId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const onOnline = () => setOnline(true); const onOffline = () => setOnline(false); setOnline(navigator.onLine); window.addEventListener("online", onOnline); window.addEventListener("offline", onOffline); return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); }; }, []);

  const command = async (action: string, body: Record<string, unknown> = {}) => {
    if (!data || !online) { setError("Đang ngoại tuyến. Thao tác tài chính tạm thời bị khóa."); return; }
    const key = idempotencyKeys.current[action] ?? (idempotencyKeys.current[action] = crypto.randomUUID());
    setBusy(action); setError(""); setNotice("");
    try {
      await json(`/v1/refunds/${encodeURIComponent(refundId)}/${action}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify({ version: data.version, ...body }) });
      setNotice("Đã cập nhật yêu cầu hoàn tiền. Dữ liệu mới nhất đã được tải lại.");
      await load();
    } catch (reason: any) {
      setError(reason?.code === "REFUND_VERSION_CONFLICT" ? "Yêu cầu hoàn tiền vừa được cập nhật bởi người khác. Dữ liệu mới nhất đã được tải lại; vui lòng kiểm tra trước khi tiếp tục." : reason instanceof Error ? reason.message : "Không thể cập nhật yêu cầu hoàn tiền.");
      await load();
    } finally { setBusy(""); }
  };

  const kind = data ? refundKind(data) : "PARTIAL";
  const contextData = data?.context;
  const timezone = contextData?.branch?.timezone;
  const remainingMinor = Math.max((data?.requestedMinor ?? 0) - (data?.completedMinor ?? 0), 0);
  const progress = data?.requestedMinor ? Math.min(100, Math.round((data.completedMinor / data.requestedMinor) * 100)) : 0;
  const historyStatuses = useMemo(() => history.filter((event, index, all) => all.findIndex((item) => item.to_status === event.to_status) === index), [history]);
  const originalPayments = contextData?.originalPayments ?? [];
  const paymentById = useMemo(() => new Map(originalPayments.map((payment: any) => [payment.id, payment])), [originalPayments]);
  const hasCashAllocation = data?.paymentAllocations?.some((allocation) => (allocation.tenderType ?? allocation.tender_type) === "CASH") ?? false;
  const cashEvidence = contextData?.cashEvidence;
  const canApprove = Boolean(data && hasPermission(context, "refund.approve"));
  const canRequest = Boolean(data && hasPermission(context, "refund.request"));
  const canExecuteExternal = Boolean(data && hasPermission(context, "refund.execute_external"));
  const canCancel = Boolean(data && hasPermission(context, "refund.cancel"));
  const canPrintCreditNote = Boolean(data?.creditNote && hasPermission(context, "credit_note.print"));
  const invoiceHref = contextData?.invoice?.href ?? `/admin/financial/invoices?branchId=${encodeURIComponent(data?.branchId ?? "")}&invoiceId=${encodeURIComponent(data?.invoiceId ?? "")}`;

  if (loading && !data) return <main className={styles.page}><div className={styles.container}><div className={styles.skeletonHeader}><span /><span /><span /></div><div className={styles.skeletonHero} /><div className={styles.skeletonGrid}><div /><div /></div></div></main>;
  if (!data) return <main className={styles.page}><div className={styles.container}><div className={styles.errorCard} role="alert"><IconCircle tone="red">!</IconCircle><div><h1>Không thể tải yêu cầu hoàn tiền</h1><p>{error || "Dữ liệu không tồn tại hoặc bạn không có quyền truy cập."}</p><div className={styles.inlineActions}><button className={styles.secondaryButton} onClick={() => void load()}>Thử lại</button><Link className={styles.primaryButton} href="/admin/refunds">Danh sách hoàn tiền</Link></div></div></div></div></main>;

  const transition = (action: string, requiresReason = false) => {
    const reason = decisionReason.trim();
    if (requiresReason && !reason) { setError("Hãy nhập lý do trước khi thực hiện thao tác này."); return; }
    if (action === "retry" && (!evidenceViewed || !window.confirm("Bạn đã xác minh kết quả từ provider và muốn tiếp tục xử lý yêu cầu này?"))) return;
    void command(action, requiresReason ? { reason } : {});
  };
  const actionButtons = (compact = false) => {
    const buttonClass = compact ? styles.footerButton : styles.actionButton;
    if (data.status === "DRAFT") return <><button className={`${buttonClass} ${styles.primaryButton}`} onClick={() => transition("submit")} disabled={Boolean(busy) || !hasPermission(context, "refund.request")}>{busy === "submit" ? "Đang gửi…" : "Gửi phê duyệt"}</button>{canCancel ? <button className={buttonClass} onClick={() => transition("cancel", true)} disabled={Boolean(busy)}>Hủy yêu cầu</button> : null}</>;
    if (data.status === "PENDING_APPROVAL") return <>{canApprove ? <><button className={`${buttonClass} ${styles.primaryButton}`} onClick={() => transition("approve", true)} disabled={Boolean(busy)}>{busy === "approve" ? "Đang duyệt…" : "Phê duyệt"}</button><button className={`${buttonClass} ${styles.dangerButton}`} onClick={() => transition("reject", true)} disabled={Boolean(busy)}>Từ chối</button></> : null}{canCancel ? <button className={buttonClass} onClick={() => transition("cancel", true)} disabled={Boolean(busy)}>Hủy yêu cầu</button> : null}</>;
    if (data.status === "APPROVED") return <Link className={`${buttonClass} ${styles.primaryButton}`} href={`/admin/refunds/${encodeURIComponent(refundId)}/execute`}>Xử lý hoàn tiền <span aria-hidden="true">→</span></Link>;
    if (data.status === "PROCESSING") return <Link className={buttonClass} href={`/admin/refunds/${encodeURIComponent(refundId)}/execute`}>Xem tiến trình xử lý <span aria-hidden="true">→</span></Link>;
    if ((data.status === "UNKNOWN" || data.status === "FAILED") && canExecuteExternal) return evidenceViewed ? <button className={`${buttonClass} ${styles.primaryButton}`} onClick={() => transition("retry")} disabled={Boolean(busy) || !online}>{busy === "retry" ? "Đang xử lý…" : "Tiếp tục sau khi xác minh"}</button> : <button className={buttonClass} onClick={() => setEvidenceViewed(true)} disabled={!online}>Tôi đã xem bằng chứng provider</button>;
    return null;
  };

  return <main className={styles.page}>
    <div className={styles.container}>
      <div className={styles.breadcrumb}><Link href="/admin/financial/invoices">Tài chính</Link><span>/</span><Link href="/admin/refunds">Hoàn tiền</Link><span>/</span><strong>{data.refundReference}</strong></div>
      <header className={styles.header}><div><div className={styles.titleLine}><h1>Chi tiết hoàn tiền</h1><Pill tone={statusTone(data.status)}>{STATUS_LABEL[data.status]}</Pill><Pill tone="rose">{KIND_LABEL[kind]}</Pill></div><p className={styles.subtitle}>Kiểm tra lý do hoàn tiền, trạng thái xử lý, chứng từ liên quan và lịch sử phê duyệt của yêu cầu hoàn tiền.</p></div><div className={styles.headerActions}><Link className={styles.secondaryButton} href="/admin/refunds">← Danh sách hoàn tiền</Link><Link className={styles.secondaryButton} href={invoiceHref}>Mở hóa đơn gốc</Link>{data.creditNote && hasPermission(context, "credit_note.read") ? <Link className={styles.secondaryButton} href={`/admin/credit-notes/${data.creditNote.id}`}>Xem credit note</Link> : null}{contextData?.invoice && canRequest && (contextData.remainingRefundableMinor ?? 0) > 0 ? <Link className={styles.primaryButton} href={`/admin/refunds/new?invoiceId=${encodeURIComponent(data.invoiceId)}`}>＋ Tạo hoàn tiền bổ sung</Link> : null}</div></header>
      {error ? <div className={styles.error} role="alert"><strong>Không thể hoàn tất thao tác</strong><span>{error}</span><button onClick={() => setError("")} aria-label="Đóng thông báo lỗi">Đóng</button></div> : null}
      {notice ? <div className={styles.notice} role="status">✓ {notice}<button onClick={() => setNotice("")} aria-label="Đóng thông báo">Đóng</button></div> : null}
      {!online ? <div className={styles.offline} role="status">Đang ngoại tuyến. Dữ liệu có thể chưa phải mới nhất; thao tác tài chính đã được khóa.</div> : null}

      <section className={styles.heroCard} aria-label="Tóm tắt yêu cầu hoàn tiền">
        <div className={styles.heroIdentity}><IconCircle tone="rose">↺</IconCircle><div><p className={styles.heroReference}>{data.refundReference}</p><h2>{contextData?.customer?.displayName ?? "Khách vãng lai"}</h2><p className={styles.heroPhone}>{contextData?.customer?.phone ?? "Thông tin liên hệ được giới hạn"}</p><div className={styles.pillRow}><Pill tone="amber">{KIND_LABEL[kind]}</Pill>{data.refundDestination === "CUSTOMER_CREDIT" ? <Pill tone="blue">Tín dụng khách hàng</Pill> : null}</div></div></div>
        <dl className={styles.heroFacts}><Row label="Ngày yêu cầu">{dateTime(data.requestedAt, timezone)}</Row><Row label="Người yêu cầu">{contextData?.requester?.displayName ?? "—"}</Row><Row label="Chi nhánh">{contextData?.branch?.name ?? "—"}</Row><Row label="Phương thức">{data.paymentAllocations.length > 1 ? "Nhiều phương thức" : TENDER_LABEL[data.paymentAllocations[0]?.tenderType ?? data.paymentAllocations[0]?.tender_type] ?? "—"}</Row></dl>
        <div className={styles.heroAmount}><span>{data.status === "COMPLETED" ? "Số tiền đã hoàn" : "Số tiền yêu cầu"}</span><strong>{money(data.status === "COMPLETED" ? data.completedMinor : data.requestedMinor, data.currency)}</strong><small>Đã hoàn {money(data.completedMinor, data.currency)}</small></div>
      </section>

      <section className={styles.statusFlow} aria-label="Lịch sử trạng thái hoàn tiền"><div className={styles.flowTrack}>{(historyStatuses.length ? historyStatuses : [{ to_status: data.status, created_at: data.requestedAt }]).map((event, index, events) => <div className={styles.flowStep} key={`${event.to_status}-${event.created_at}-${index}`}><span className={`${styles.flowDot} ${styles[`flow${statusTone(event.to_status)[0]!.toUpperCase()}${statusTone(event.to_status).slice(1)}`]}`}>{event.to_status === "COMPLETED" ? "✓" : index + 1}</span><strong>{FLOW_LABEL[event.to_status] ?? STATUS_LABEL[event.to_status] ?? event.to_status}</strong><small>{dateTime(event.created_at, timezone)}</small>{index < events.length - 1 ? <i /> : null}</div>)}</div>{data.status === "UNKNOWN" ? <div className={styles.warningBanner}><strong>Trạng thái hoàn tiền chưa xác định.</strong><span>Không gửi lại yêu cầu khi chưa xác minh kết quả hiện tại từ provider.</span></div> : null}</section>

      <div className={styles.workspace}><div className={styles.leftColumn}>
        <Card title="Thông tin hoàn tiền"><dl className={styles.detailGrid}><Row label="Mã hoàn tiền">{data.refundReference}</Row><Row label="Loại hoàn">{KIND_LABEL[kind]}</Row><Row label="Trạng thái"><Pill tone={statusTone(data.status)}>{STATUS_LABEL[data.status]}</Pill></Row><Row label="Ngày yêu cầu">{dateTime(data.requestedAt, timezone)}</Row><Row label="Ngày phê duyệt">{dateTime(data.approvedAt, timezone)}</Row><Row label="Phương thức">{data.refundDestination === "CUSTOMER_CREDIT" ? "Tín dụng khách hàng" : data.paymentAllocations.map((allocation) => TENDER_LABEL[allocation.tenderType ?? allocation.tender_type] ?? "Khác").filter(Boolean).join(" + ") || "—"}</Row><Row label="Tiền tệ">{data.currency}</Row><Row label="Còn được hoàn">{money(contextData?.remainingRefundableMinor ?? 0, data.currency)}</Row></dl></Card>
        <Card title="Khoản mục hoàn tiền"><div className={styles.tableWrap}><table><thead><tr><th>Nội dung</th><th>Loại</th><th>Số lượng</th><th>Giá trị gốc</th><th>Giá trị hoàn</th></tr></thead><tbody>{data.items.map((item, index) => <tr key={item.id ?? index}><td><strong>{itemDescription(item)}</strong><small>{item.itemType === "TIP" || item.item_type === "TIP" ? "Khoản tip" : "Snapshot từ hóa đơn gốc"}</small></td><td>{item.itemType === "TIP" || item.item_type === "TIP" ? "Tip" : "Dịch vụ / sản phẩm"}</td><td>{pick(item, "quantity") ?? "—"}</td><td>{money(Number(pick(item, "grossRefundMinor", "gross_refund_minor") ?? pick(item, "totalRefundMinor", "total_refund_minor") ?? 0), data.currency)}</td><td className={styles.money}>{money(Number(pick(item, "totalRefundMinor", "total_refund_minor") ?? 0), data.currency)}</td></tr>)}</tbody></table></div><div className={styles.totalLine}><span>Tổng hoàn</span><strong>{money(data.requestedMinor, data.currency)}</strong></div></Card>
        <div className={styles.twoColumn}><Card title="Lý do hoàn tiền"><Pill tone="rose">{REASON_LABEL[data.reasonCode] ?? data.reasonCode}</Pill><p className={styles.bodyText}>{data.reasonText}</p>{data.tipRefundMinor === 0 ? <Pill tone="gray">Không hoàn tip</Pill> : <Pill tone="purple">Hoàn tip {money(data.tipRefundMinor, data.currency)}</Pill>}</Card><Card title="Phê duyệt hoàn tiền"><div className={styles.personRow}><div className={styles.avatar}>{contextData?.requester?.displayName?.slice(0, 1) ?? "?"}</div><div><small>Người yêu cầu</small><strong>{contextData?.requester?.displayName ?? "—"}</strong><span>{dateTime(data.requestedAt, timezone)}</span></div></div><div className={styles.approvalArrow}>→</div><div className={styles.personRow}><div className={`${styles.avatar} ${styles.avatarGreen}`}>{contextData?.approver?.displayName?.slice(0, 1) ?? "—"}</div><div><small>Người phê duyệt</small><strong>{contextData?.approver?.displayName ?? "Chưa phê duyệt"}</strong><span>{dateTime(data.approvedAt, timezone)}</span></div></div>{data.approvalReason ? <p className={styles.mutedText}>{data.approvalReason}</p> : null}{data.rejectionReason ? <p className={styles.mutedText}>{data.rejectionReason}</p> : null}</Card></div>
        <Card title="Ghi chú liên quan"><p className={styles.bodyText}>{data.reasonText}</p>{history.filter((event) => event.note).map((event) => <div className={styles.noteLine} key={event.id ?? event.created_at}><strong>{event.actor_display_name ?? (event.actor_type === "SYSTEM" ? "Hệ thống" : "Người dùng")}</strong><span>{event.note}</span><small>{dateTime(event.created_at, timezone)}</small></div>)}</Card>
        <Card title="Lịch sử xử lý"><div className={styles.timeline}>{history.length ? history.map((event, index) => <div className={styles.timelineItem} key={event.id ?? `${event.created_at}-${index}`}><span className={styles.timelineDot} /><div><strong>{FLOW_LABEL[event.to_status] ?? STATUS_LABEL[event.to_status] ?? event.to_status}</strong><small>{dateTime(event.created_at, timezone)} · {event.actor_display_name ?? (event.actor_type === "SYSTEM" ? "Hệ thống" : event.actor_type === "PROVIDER" ? "Provider" : "Người dùng")}</small>{event.note ? <p>{event.note}</p> : null}</div></div>) : <p className={styles.mutedText}>Chưa có lịch sử xử lý.</p>}{historyError ? <p className={styles.errorText}>{historyError} <button onClick={() => void load()}>Thử lại</button></p> : null}</div></Card>
      </div><aside className={styles.rightColumn}>
        <Card title="Tóm tắt hoàn tiền" className={styles.summaryCard}><div className={styles.summaryRows}><Row label="Số tiền yêu cầu">{money(data.requestedMinor, data.currency)}</Row><Row label="Số tiền đã hoàn">{money(data.completedMinor, data.currency)}</Row><Row label="Còn lại">{money(remainingMinor, data.currency)}</Row><Row label="Loại">{KIND_LABEL[kind]}</Row><Row label="Trạng thái"><Pill tone={statusTone(data.status)}>{STATUS_LABEL[data.status]}</Pill></Row></div><div className={styles.progressLabel}><span>Tiến độ hoàn tiền</span><strong>{progress}%</strong></div><div className={styles.progress}><i style={{ width: `${progress}%` }} /></div>{data.status === "COMPLETED" ? <div className={styles.completedStamp}>✓ HOÀN TẤT</div> : null}</Card>
        <Card title="Hóa đơn gốc"><div className={styles.documentHero}><IconCircle tone="rose">▤</IconCircle><div><strong>{contextData?.invoice?.invoiceNumber ?? data.invoiceId}</strong><small>{contextData?.invoice?.status ?? "—"} · {money(contextData?.invoice?.totalMinor, data.currency)}</small></div></div><dl className={styles.compactRows}><Row label="Đã thanh toán">{money(contextData?.invoice?.paidMinor, data.currency)}</Row><Row label="Ngày phát hành">{dateTime(contextData?.invoice?.issuedAt, timezone)}</Row></dl><LinkButton href={invoiceHref}>Mở hóa đơn gốc</LinkButton></Card>
        <Card title="Thanh toán & hoàn tiền"><div className={styles.allocationList}>{data.paymentAllocations.map((allocation, index) => { const payment = paymentById.get(allocation.originalPaymentId ?? allocation.original_payment_id); const tender = allocation.tenderType ?? allocation.tender_type; return <div className={styles.allocation} key={allocation.id ?? index}><div><strong>{TENDER_LABEL[tender] ?? tender}</strong><small>{payment?.paymentReference ?? "Thanh toán gốc"}</small></div><div><span>Gốc {money(payment?.capturedMinor ?? 0, data.currency)}</span><strong>{money(Number(allocation.completedMinor ?? allocation.completed_minor ?? 0), data.currency)} đã hoàn</strong></div><Pill tone={allocation.status === "COMPLETED" ? "green" : allocation.status === "UNKNOWN" ? "purple" : "amber"}>{allocation.status === "COMPLETED" ? "Đã hoàn" : allocation.status === "UNKNOWN" ? "UNKNOWN" : allocation.status ?? "Đang xử lý"}</Pill></div>; })}</div>{hasCashAllocation ? <div className={`${styles.evidenceBox} ${cashEvidence?.verified ? styles.evidenceOk : styles.evidenceWarn}`}><strong>{cashEvidence?.verified ? "✓ Đã ghi nhận vào phiên thu ngân" : "! Chưa xác minh chứng cứ tiền mặt"}</strong>{cashEvidence ? <p>{money(cashEvidence.amountMinor, data.currency)} · Phiên #{cashEvidence.cashSessionId.slice(0, 8)} · {dateTime(cashEvidence.occurredAt, timezone)}</p> : <p>Chưa có CASH_REFUND movement hợp lệ.</p>}{cashEvidence?.href ? <Link href={cashEvidence.href}>Mở phiên thu ngân →</Link> : null}</div> : null}</Card>
        {data.creditNote ? <Card title="Chứng từ điều chỉnh"><div className={styles.documentHero}><IconCircle tone="purple">▧</IconCircle><div><strong>{data.creditNote.creditNoteNumber ?? data.creditNote.credit_note_number}</strong><small>{data.creditNote.status} · {money(data.creditNote.totalMinor ?? data.creditNote.total_minor, data.currency)}</small></div></div><div className={styles.inlineActions}>{hasPermission(context, "credit_note.read") ? <Link className={styles.secondaryButton} href={`/admin/credit-notes/${data.creditNote.id}`}>Xem credit note</Link> : null}{canPrintCreditNote ? <a className={styles.secondaryButton} href={`/v1/credit-notes/${data.creditNote.id}/print`} target="_blank" rel="noreferrer">In chứng từ</a> : null}</div></Card> : null}
        <Card title="Chứng từ liên quan"><div className={styles.relatedList}>{contextData?.order ? <LinkButton href={contextData.order.href}>Đơn POS · {contextData.order.orderNumber ?? contextData.order.id.slice(0, 8)}</LinkButton> : null}{contextData?.appointment ? <LinkButton href={contextData.appointment.href}>Lịch hẹn · {contextData.appointment.bookingReference ?? contextData.appointment.id.slice(0, 8)}</LinkButton> : null}{cashEvidence?.href ? <LinkButton href={cashEvidence.href}>Phiên thu ngân</LinkButton> : null}{!contextData?.order && !contextData?.appointment && !cashEvidence ? <p className={styles.mutedText}>Không có chứng từ liên quan khác.</p> : null}</div></Card>
        <Card title="Trạng thái nghiệp vụ"><div className={styles.checkList}><CheckRow label="Yêu cầu đã được phê duyệt" state={history.some((event) => event.to_status === "APPROVED") ? "ok" : "na"} /><CheckRow label="Khoản hoàn đã được thực hiện" state={data.completedMinor > 0 && data.paymentAllocations.some((allocation) => Number(allocation.completedMinor ?? allocation.completed_minor ?? 0) > 0) ? "ok" : "na"} /><CheckRow label="Credit note đã phát hành" state={data.creditNote?.status === "ISSUED" ? "ok" : "na"} /><CheckRow label="Đã hoàn đủ số tiền yêu cầu" state={remainingMinor === 0 ? "ok" : "warn"} detail={remainingMinor > 0 ? `Còn ${money(remainingMinor, data.currency)}` : undefined} /><CheckRow label="Chứng cứ tiền mặt hợp lệ" state={!hasCashAllocation ? "na" : cashEvidence?.verified ? "ok" : "warn"} /></div></Card>
        {(data.status === "UNKNOWN" || data.status === "FAILED") && canExecuteExternal ? <Card title="Bằng chứng provider"><p className={styles.mutedText}>Chỉ hiển thị cho tài khoản có quyền xem metadata provider. Hãy xác minh kết quả trước khi tiếp tục xử lý.</p>{attempts.length ? <div className={styles.attemptList}>{attempts.map((attempt, index) => <div key={attempt.id ?? index}><strong>Lần {attempt.attempt_no ?? attempt.attemptNo ?? index + 1}</strong><span>{attempt.provider} · {attempt.result}</span><small>{dateTime(attempt.occurred_at ?? attempt.occurredAt, timezone)}</small></div>)}</div> : <p className={styles.mutedText}>Không có attempt provider được phép hiển thị.</p>}{evidenceViewed ? <Pill tone="green">Đã đánh dấu đã xem bằng chứng</Pill> : <button className={styles.secondaryButton} onClick={() => setEvidenceViewed(true)}>Đánh dấu đã xác minh</button>}</Card> : null}
      <Card title="Thao tác nhanh"><div className={styles.actionStack}>{actionButtons(false)}{data.status === "COMPLETED" && data.creditNote && hasPermission(context, "credit_note.read") ? <Link className={styles.actionButton} href={`/admin/credit-notes/${data.creditNote.id}`}>Xem credit note</Link> : null}{data.status === "COMPLETED" ? <Link className={styles.actionButton} href={invoiceHref}>Mở hóa đơn gốc</Link> : null}</div>{data.status === "PENDING_APPROVAL" || data.status === "DRAFT" ? <label className={styles.reasonField}><span>Lý do phê duyệt / từ chối / hủy</span><textarea value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} placeholder="Nhập lý do bắt buộc…" maxLength={500} /></label> : null}</Card>
      </aside></div>
    </div>
    <footer className={styles.stickyFooter}><Link className={styles.secondaryButton} href="/admin/refunds">← Danh sách hoàn tiền</Link><div className={styles.footerActions}>{data.status === "COMPLETED" && data.creditNote && hasPermission(context, "credit_note.print") ? <a className={styles.footerButton} href={`/v1/credit-notes/${data.creditNote.id}/print`} target="_blank" rel="noreferrer">In chứng từ</a> : null}{actionButtons(true)}</div></footer>
  </main>;
}

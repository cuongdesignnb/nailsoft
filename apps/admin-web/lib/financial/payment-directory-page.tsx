/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { io } from "socket.io-client";
import {
  activeSession,
  authorizedFetch,
  getActiveBranchId,
  getAuthContext,
  getAuthorizedBranchContext,
} from "../auth";
import styles from "./payment-directory-page.module.css";

type PaymentItem = {
  id: string;
  paymentReference: string;
  orderId: string;
  orderNumber: string;
  orderSource?: string;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  invoiceStatus?: string | null;
  appointmentId?: string | null;
  bookingReference?: string | null;
  branchId: string;
  branchName: string;
  branchCode?: string | null;
  timezone?: string | null;
  registerId?: string | null;
  registerCode?: string | null;
  registerName?: string | null;
  cashSessionId?: string | null;
  cashSessionStatus?: string | null;
  cashBusinessDate?: string | null;
  cashierUserId?: string | null;
  cashierDisplayName?: string | null;
  customerId?: string | null;
  customerDisplayName: string;
  customerPhone?: string | null;
  tenderType: string;
  status: string;
  currency: string;
  requestedMinor: number;
  capturedMinor: number;
  cashReceivedMinor?: number | null;
  changeDueMinor?: number | null;
  provider?: string | null;
  providerTransactionIdSafe?: string | null;
  cardBrand?: string | null;
  cardLast4?: string | null;
  capturedAt?: string | null;
  createdAt: string;
  refundAmountMinor: number;
  refundCount: number;
  hasRefund: boolean;
  latestRefundId?: string | null;
  latestRefundReference?: string | null;
  latestRefundStatus?: string | null;
  reconciliationState: "MATCHED" | "NEEDS_ATTENTION" | "NOT_APPLICABLE";
  reconciliation: {
    cashSessionId?: string | null;
    movementId?: string | null;
    reflectedInExpectedCash?: boolean | null;
  };
  attention?: {
    required: boolean;
    severity: string;
    code: string;
    message: string;
  } | null;
};
type Directory = {
  items: PaymentItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  counts: {
    total: number;
    captured: number;
    processing: number;
    failed: number;
    needsAttention: number;
  };
  periodSummary: {
    capturedMinor: number;
    averageCapturedMinor: number;
    paymentMix: Array<{
      tenderType: string;
      transactionCount: number;
      capturedMinor: number;
      percentage: number;
    }>;
  };
};
type Branch = { id: string; name: string; status?: string };
type Detail = PaymentItem & {
  orderSource?: string;
  appointmentStatus?: string | null;
  branch?: { id?: string; name?: string; code?: string; timezone?: string };
  register?: { id: string; code?: string; name?: string } | null;
  cashier?: { id: string; displayName?: string } | null;
  customer?: { id?: string; displayName?: string; phone?: string | null };
  cashSession?: { id: string; status?: string; businessDate?: string } | null;
  refunds?: Array<{
    id: string;
    refundReference?: string;
    status?: string;
    plannedMinor?: number;
    completedMinor?: number;
    provider?: string;
    createdAt?: string;
  }>;
};
type AuthContext = Awaited<ReturnType<typeof getAuthContext>>;
type Filters = {
  branchId: string;
  search: string;
  tenderType: string;
  status: string;
  reconciliation: string;
  refund: string;
  dateFrom: string;
  dateTo: string;
  sort: string;
  page: number;
  pageSize: number;
};

const EMPTY_FILTERS: Filters = {
  branchId: "",
  search: "",
  tenderType: "",
  status: "",
  reconciliation: "ALL",
  refund: "ANY",
  dateFrom: "",
  dateTo: "",
  sort: "NEWEST",
  page: 1,
  pageSize: 10,
};
const TENDER_LABELS: Record<string, string> = {
  CASH: "Tiền mặt",
  CARD_EXTERNAL: "Thẻ",
  BANK_TRANSFER: "Chuyển khoản",
  OTHER_EXTERNAL: "Khác",
};
const STATUS_LABELS: Record<string, string> = {
  CAPTURED: "Thành công",
  PENDING: "Đang xử lý",
  AUTHORIZED: "Đã xác thực",
  FAILED: "Thất bại",
  CANCELLED: "Đã hủy",
  REVERSED_TECHNICAL: "Đã đảo kỹ thuật",
};

function readFilters(): Filters {
  if (typeof window === "undefined") return EMPTY_FILTERS;
  const params = new URLSearchParams(window.location.search);
  const page = Number(params.get("page"));
  const pageSize = Number(params.get("pageSize"));
  return {
    ...EMPTY_FILTERS,
    branchId: params.get("branchId") ?? getActiveBranchId() ?? "",
    search: params.get("search") ?? "",
    tenderType: params.get("tenderType") ?? "",
    status: params.get("status") ?? "",
    reconciliation: params.get("reconciliation") ?? "ALL",
    refund: params.get("refund") ?? "ANY",
    dateFrom: params.get("dateFrom") ?? "",
    dateTo: params.get("dateTo") ?? "",
    sort: params.get("sort") ?? "NEWEST",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: [10, 20, 50, 100].includes(pageSize) ? pageSize : 10,
  };
}
function toQuery(filters: Filters, includePaging = true) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (!includePaging && (key === "page" || key === "pageSize")) return;
    if (
      value !== "" &&
      value !== undefined &&
      value !== "ALL" &&
      value !== "ANY"
    )
      params.set(key, String(value));
  });
  return params.toString();
}
function refundLabel(item: PaymentItem) {
  if (item.refundAmountMinor > 0)
    return `Hoàn ${money(item.refundAmountMinor, item.currency)}`;
  return item.latestRefundStatus
    ? `Refund · ${item.latestRefundStatus}`
    : "Có refund liên quan";
}
function money(value: number | null | undefined, currency = "VND") {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}
function dateTime(value?: string | null, timezone?: string | null) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: timezone || undefined,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  }
}
function unwrap(body: any) {
  return body?.data;
}
async function json(path: string, init?: RequestInit) {
  const result = await authorizedFetch(path, init);
  const body = await result.json().catch(() => ({}));
  if (!result.ok)
    throw Object.assign(
      new Error(body?.error?.message ?? "Không thể tải dữ liệu."),
      { status: result.status },
    );
  return unwrap(body);
}
function hasPermission(context: AuthContext | undefined, permission: string) {
  const permissions =
    context?.supportAccess?.permissions ??
    context?.authorization.permissions ??
    [];
  return permissions.includes(permission);
}
function statusMeta(status: string): [string, string] {
  if (status === "CAPTURED") return ["Thành công", "green"];
  if (status === "PENDING" || status === "AUTHORIZED")
    return ["Đang xử lý", "amber"];
  if (status === "FAILED") return ["Thất bại", "rose"];
  return [STATUS_LABELS[status] ?? status, "gray"];
}
function Badge({ kind, children }: { kind: string; children: ReactNode }) {
  const normalized = kind
    ? `${kind[0]!.toUpperCase()}${kind.slice(1)}`
    : "Gray";
  return (
    <span
      className={`${styles.badge} ${styles[`badge${normalized}`] ?? styles.badgeGray}`}
    >
      {children}
    </span>
  );
}
function Kpi({
  icon,
  label,
  value,
  meta,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  meta: string;
  tone?: string;
}) {
  return (
    <div className={`${styles.kpi} ${tone ? styles[tone] : ""}`}>
      <div className={styles.kpiIcon}>{icon}</div>
      <div>
        <div className={styles.kpiLabel}>{label}</div>
        <div className={styles.kpiValue}>{value}</div>
        <div className={styles.kpiMeta}>{meta}</div>
      </div>
    </div>
  );
}

function PaymentInspector({
  item,
  detail,
  loading,
  context,
}: {
  item: PaymentItem | undefined;
  detail: Detail | undefined;
  loading: boolean;
  context: AuthContext | undefined;
}) {
  if (!item)
    return (
      <aside className={styles.inspector}>
        <div className={`${styles.card} ${styles.inspectorCard}`}>
          <div className={styles.empty}>
            <strong>Chọn một giao dịch</strong>
            <p>
              Chọn một dòng trong danh sách để xem bằng chứng thanh toán và các
              quan hệ thật.
            </p>
          </div>
        </div>
      </aside>
    );
  const [status, statusKind] = statusMeta(item.status);
  const timezone = detail?.branch?.timezone;
  const customer = detail?.customer;
  return (
    <aside className={styles.inspector}>
      <div className={`${styles.card} ${styles.inspectorCard}`}>
        <div className={styles.inspectorHeader}>
          <div>
            <h2 className={styles.inspectorTitle}>Chi tiết giao dịch</h2>
            <div className={styles.inspectorSub}>{item.paymentReference}</div>
          </div>
          <Badge kind={item.attention ? "rose" : statusKind}>
            {item.attention ? "Cần đối soát" : status}
          </Badge>
        </div>
        <div className={styles.heroAmount}>
          <span>Đã ghi nhận</span>
          <strong>{money(item.capturedMinor, item.currency)}</strong>
          <small>
            {TENDER_LABELS[item.tenderType] ?? item.tenderType} ·{" "}
            {dateTime(item.capturedAt ?? item.createdAt, timezone)}
          </small>
        </div>
        <div className={styles.keyValue}>
          <span>Khách hàng</span>
          <strong>{customer?.displayName ?? item.customerDisplayName}</strong>
        </div>
        <div className={styles.keyValue}>
          <span>Chi nhánh</span>
          <strong>{detail?.branch?.name ?? item.branchName}</strong>
        </div>
        <div className={styles.keyValue}>
          <span>Thu ngân / actor</span>
          <strong>
            {detail?.cashier?.displayName ?? item.cashierDisplayName ?? "—"}
          </strong>
        </div>
        <div className={styles.keyValue}>
          <span>Mã đơn POS</span>
          <strong>{item.orderNumber}</strong>
        </div>
      </div>
      <div className={`${styles.card} ${styles.inspectorCard}`}>
        <h2 className={styles.sectionTitle}>Chi tiết tiền mặt</h2>
        {item.tenderType === "CASH" ? (
          <>
            <div className={styles.keyValue}>
              <span>Số tiền phải thu</span>
              <strong>{money(item.requestedMinor, item.currency)}</strong>
            </div>
            <div className={styles.keyValue}>
              <span>Khách đưa</span>
              <strong>{money(item.cashReceivedMinor, item.currency)}</strong>
            </div>
            <div className={styles.keyValue}>
              <span>Tiền thừa</span>
              <strong className={styles.positive}>
                {money(item.changeDueMinor, item.currency)}
              </strong>
            </div>
            <div className={styles.keyValue}>
              <span>Đã ghi nhận</span>
              <strong>{money(item.capturedMinor, item.currency)}</strong>
            </div>
          </>
        ) : (
          <>
            <div className={styles.keyValue}>
              <span>Phương thức</span>
              <strong>
                {TENDER_LABELS[item.tenderType] ?? item.tenderType}
              </strong>
            </div>
            <div className={styles.keyValue}>
              <span>Nhà cung cấp</span>
              <strong>{item.provider ?? "Ghi nhận ngoài"}</strong>
            </div>
            {item.tenderType === "CARD_EXTERNAL" ? (
              <div className={styles.keyValue}>
                <span>Thẻ</span>
                <strong>
                  {item.cardBrand ?? "Card"} ·•••• {item.cardLast4 ?? "—"}
                </strong>
              </div>
            ) : null}
            <div className={styles.keyValue}>
              <span>Reference an toàn</span>
              <strong>{item.providerTransactionIdSafe ?? "—"}</strong>
            </div>
            <div className={styles.keyValue}>
              <span>Đã ghi nhận</span>
              <strong>{money(item.capturedMinor, item.currency)}</strong>
            </div>
          </>
        )}
        {loading ? <div className={styles.skeleton} /> : null}
      </div>
      <div className={`${styles.card} ${styles.inspectorCard}`}>
        <div className={styles.inspectorHeader}>
          <h2 className={styles.sectionTitle}>Chứng từ liên quan</h2>
          <Badge kind="gray">POS</Badge>
        </div>
        <div className={styles.linkList}>
          <Link
            className={styles.link}
            href={`/admin/pos/orders/${item.orderId}`}
          >
            Đơn POS <span>→</span>
          </Link>
          {item.invoiceId ? (
            <Link
              className={styles.link}
              href={`/admin/financial/invoices?search=${encodeURIComponent(item.invoiceNumber ?? item.orderNumber)}`}
            >
              Hóa đơn · {item.invoiceNumber ?? "xem"} <span>→</span>
            </Link>
          ) : null}
          {item.appointmentId ? (
            <Link
              className={styles.link}
              href={`/admin/appointments/${item.appointmentId}/overview`}
            >
              Lịch hẹn · {item.bookingReference ?? "xem"} <span>→</span>
            </Link>
          ) : null}
          {item.cashSessionId ? (
            <Link
              className={styles.link}
              href={`/admin/pos/cash-sessions/${item.cashSessionId}`}
            >
              Phiên thu ngân <span>→</span>
            </Link>
          ) : null}
          {detail?.refunds?.map((refund) => (
            <Link
              className={styles.link}
              key={refund.id}
              href={`/admin/refunds/${refund.id}`}
            >
              Refund · {refund.refundReference ?? refund.id.slice(0, 8)}{" "}
              <Badge kind={refund.status === "COMPLETED" ? "green" : "amber"}>
                {refund.status ?? "—"}
              </Badge>
            </Link>
          )) ?? null}
        </div>
      </div>
      <div className={`${styles.card} ${styles.inspectorCard}`}>
        <div className={styles.inspectorHeader}>
          <h2 className={styles.sectionTitle}>Bằng chứng thanh toán</h2>
          <Badge kind={statusKind}>{status}</Badge>
        </div>
        <div className={styles.evidenceGrid}>
          <span>Mã giao dịch</span>
          <strong>{item.paymentReference}</strong>
          <span>Capture</span>
          <strong>{money(item.capturedMinor, item.currency)}</strong>
          <span>Thời gian</span>
          <strong>
            {dateTime(item.capturedAt ?? item.createdAt, timezone)}
          </strong>
          <span>Nguồn xác nhận</span>
          <strong>
            {item.tenderType === "CASH"
              ? "Quầy thu ngân"
              : (item.provider ?? "Thanh toán ngoài")}
          </strong>
        </div>
        {item.attention ? (
          <div className={styles.attention}>
            <strong>{item.attention.message}</strong>
            <span>{item.attention.code}</span>
          </div>
        ) : null}
      </div>
      <div className={`${styles.card} ${styles.inspectorCard}`}>
        <div className={styles.inspectorHeader}>
          <h2 className={styles.sectionTitle}>Trạng thái đối soát</h2>
          <Badge
            kind={
              item.reconciliationState === "NEEDS_ATTENTION"
                ? "rose"
                : item.reconciliationState === "MATCHED"
                  ? "green"
                  : "gray"
            }
          >
            {item.reconciliationState === "MATCHED"
              ? "Khớp"
              : item.reconciliationState === "NEEDS_ATTENTION"
                ? "Cần kiểm tra"
                : "Không áp dụng"}
          </Badge>
        </div>
        <p className={styles.reconcileText}>
          {item.tenderType === "CASH"
            ? item.reconciliationState === "MATCHED"
              ? "Đã ghi nhận vào phiên thu ngân và khớp CASH_SALE."
              : "Không thể xác minh CASH_SALE trong phiên thu ngân."
            : "Giao dịch ngoài không làm thay đổi tiền mặt dự kiến."}
        </p>
      </div>
      <div className={`${styles.card} ${styles.inspectorCard}`}>
        <h2 className={styles.sectionTitle}>Thao tác</h2>
        <div className={styles.actionGrid}>
          <Link
            className={styles.button}
            href={`/admin/pos/orders/${item.orderId}`}
          >
            Mở đơn POS
          </Link>
          {item.invoiceId ? (
            <Link
              className={styles.button}
              href={`/admin/pos/orders/${item.orderId}/receipt`}
              target="_blank"
            >
              In biên nhận
            </Link>
          ) : null}
          {item.invoiceId && hasPermission(context, "refund.request") ? (
            <Link
              className={`${styles.button} ${styles.buttonDanger}`}
              href={`/admin/refunds/new?invoiceId=${item.invoiceId}`}
            >
              Yêu cầu hoàn tiền
            </Link>
          ) : null}
        </div>
        <div className={styles.footerNote}>
          Màn này chỉ đọc bằng chứng. Không có retry payment và không tạo
          payment độc lập.
        </div>
      </div>
    </aside>
  );
}

export default function PaymentTransactionDirectoryPage() {
  const [filters, setFilters] = useState<Filters>(readFilters);
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [context, setContext] = useState<AuthContext>();
  const [directory, setDirectory] = useState<Directory>();
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<Detail>();
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const loadContext = async () => {
      try {
        const result = await getAuthorizedBranchContext();
        setContext(result.context);
        setBranches(result.branches);
        if (!filters.branchId && result.branchId)
          setFilters((value) => ({
            ...value,
            branchId: result.branchId ?? "",
            page: 1,
          }));
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Không thể tải thông tin chi nhánh.",
        );
      }
    };
    void loadContext();
    const onBranch = (event: Event) =>
      setFilters((value) => ({
        ...value,
        branchId: (event as CustomEvent<string | undefined>).detail ?? "",
        page: 1,
      }));
    const onPop = () => {
      const next = readFilters();
      setFilters(next);
      setSearchDraft(next.search);
    };
    window.addEventListener("nailsoft:active-branch-change", onBranch);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("nailsoft:active-branch-change", onBranch);
      window.removeEventListener("popstate", onPop);
    };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        setFilters((value) => ({
          ...value,
          search: searchDraft.trim(),
          page: 1,
        })),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [searchDraft]);
  useEffect(() => {
    const query = toQuery(filters);
    const next = `${window.location.pathname}${query ? `?${query}` : ""}`;
    if (`${window.location.pathname}${window.location.search}` !== next)
      window.history.replaceState(null, "", next);
  }, [filters]);
  const directoryPath = useMemo(() => {
    const query = toQuery(filters);
    return `/v1/payments/directory${query ? `?${query}` : ""}`;
  }, [filters]);
  const reload = () => setReloadToken((value) => value + 1);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void json(directoryPath, { signal: controller.signal })
      .then((value) => {
        if (!active) return;
        const next = value as Directory;
        setDirectory(next);
        setSelectedId((current) =>
          current && next.items.some((item) => item.id === current)
            ? current
            : next.items[0]?.id,
        );
      })
      .catch((reason: any) => {
        if (active && reason?.name !== "AbortError")
          setError(
            reason instanceof Error
              ? reason.message
              : "Không thể tải giao dịch thanh toán.",
          );
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
      controller.abort();
    };
  }, [directoryPath, reloadToken]);
  useEffect(() => {
    if (!selectedId) {
      setDetail(undefined);
      return;
    }
    let active = true;
    const controller = new AbortController();
    setDetailLoading(true);
    void json(`/v1/payments/${selectedId}`, { signal: controller.signal })
      .then((value) => active && setDetail(value as Detail))
      .catch((reason: any) => {
        if (active && reason?.name !== "AbortError")
          setError(
            reason instanceof Error
              ? reason.message
              : "Không thể tải chi tiết giao dịch.",
          );
      })
      .finally(() => active && setDetailLoading(false));
    return () => {
      active = false;
      controller.abort();
    };
  }, [selectedId]);
  useEffect(() => {
    const session = activeSession();
    const socket = session.accessToken
      ? io(`${session.api}/scheduling`, {
          auth: { token: session.accessToken },
          transports: ["websocket"],
        })
      : null;
    const onRealtime = () => {
      if (document.visibilityState === "visible") reload();
    };
    socket?.on("pos.order.updated", onRealtime);
    socket?.on("cash_session.updated", onRealtime);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, 15000);
    return () => {
      socket?.disconnect();
      window.clearInterval(timer);
    };
  }, []);
  const update = (key: keyof Filters, value: string | number) =>
    setFilters((current) => ({
      ...current,
      [key]: value,
      ...(key === "pageSize" || key === "sort" ? { page: 1 } : {}),
    }));
  const exportCsv = async () => {
    try {
      const response = await authorizedFetch(
        `/v1/payments/export?${toQuery(filters, false)}`,
      );
      if (!response.ok) throw new Error("Không thể xuất giao dịch.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "payment-transactions.csv";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Không thể xuất giao dịch.",
      );
    }
  };
  const selected = directory?.items.find((item) => item.id === selectedId);
  const totalPages = directory?.pagination.totalPages ?? 1;
  const from =
    directory && directory.pagination.total
      ? (directory.pagination.page - 1) * directory.pagination.pageSize + 1
      : 0;
  const to = directory
    ? Math.min(
        directory.pagination.page * directory.pagination.pageSize,
        directory.pagination.total,
      )
    : 0;
  const currency = selected?.currency ?? "VND";
  const mixTotal =
    directory?.periodSummary.paymentMix.reduce(
      (sum, item) => sum + item.capturedMinor,
      0,
    ) ?? 0;
  return (
    <main className={styles.page}>
      <div className={styles.content}>
        <div className={styles.header}>
          <div>
            <div className={styles.eyebrow}>
              Tài chính / Giao dịch thanh toán
            </div>
            <h1 className={styles.title}>Giao dịch thanh toán</h1>
            <p className={styles.subtitle}>
              Theo dõi khoản thu, phương thức thanh toán và bằng chứng đối soát
              của giao dịch tại salon.
            </p>
          </div>
          <div className={styles.headerActions}>
            <button
              className={styles.button}
              onClick={exportCsv}
              disabled={loading}
            >
              ⇩ Xuất dữ liệu
            </button>
            <button className={styles.button} onClick={reload}>
              ↻ Đối soát / làm mới
            </button>
            <Link
              className={`${styles.button} ${styles.buttonPrimary}`}
              href="/admin/pos/orders?status=READY_FOR_PAYMENT"
            >
              Mở POS / Bán hàng
            </Link>
          </div>
        </div>
        {error ? (
          <div className={styles.notice} role="alert">
            <strong>Không thể hoàn tất thao tác.</strong>
            <span>{error}</span>
            <button className={styles.button} onClick={() => setError("")}>
              Đóng
            </button>
          </div>
        ) : null}
        <section className={styles.kpis} aria-label="Chỉ số giao dịch">
          <Kpi
            icon="▣"
            label="Tổng thu theo kỳ"
            value={money(directory?.periodSummary.capturedMinor, currency)}
            meta={`${directory?.counts.captured ?? 0} giao dịch capture`}
          />
          <Kpi
            icon="✓"
            label="Giao dịch thành công"
            value={String(directory?.counts.captured ?? 0)}
            meta="status = CAPTURED"
            tone="success"
          />
          <Kpi
            icon="◷"
            label="Đang xử lý"
            value={String(directory?.counts.processing ?? 0)}
            meta="PENDING / AUTHORIZED"
            tone="processing"
          />
          <Kpi
            icon="!"
            label="Cần đối soát"
            value={String(directory?.counts.needsAttention ?? 0)}
            meta={
              directory?.counts.failed
                ? `${directory.counts.failed} thất bại · cần kiểm tra`
                : "Evidence anomaly thật"
            }
            tone="attention"
          />
          <Kpi
            icon="◈"
            label="Giá trị trung bình"
            value={money(
              directory?.periodSummary.averageCapturedMinor,
              currency,
            )}
            meta="trên payment CAPTURED"
            tone="average"
          />
        </section>
        <section className={`${styles.card} ${styles.methodCard}`}>
          <div className={styles.sectionHeader}>
            <div>
              <h2 className={styles.sectionTitle}>
                Phương thức thanh toán theo bộ lọc
              </h2>
              <span className={styles.tableMeta}>
                Tỷ trọng tính trên capturedMinor, không dùng tổng đơn.
              </span>
            </div>
            <Badge kind="gray">
              {directory?.periodSummary.paymentMix.length ?? 0} phương thức
            </Badge>
          </div>
          <div className={styles.methodGrid}>
            {directory?.periodSummary.paymentMix.map((method) => (
              <div className={styles.method} key={method.tenderType}>
                <div className={styles.methodTop}>
                  <strong>
                    {TENDER_LABELS[method.tenderType] ?? method.tenderType}
                  </strong>
                  <span>{method.percentage}%</span>
                </div>
                <div className={styles.progress}>
                  <span
                    className={styles[`method${method.tenderType}`] ?? ""}
                    style={{ width: `${Math.min(100, method.percentage)}%` }}
                  />
                </div>
                <div className={styles.methodBottom}>
                  <span>{method.transactionCount} giao dịch</span>
                  <strong>{money(method.capturedMinor, currency)}</strong>
                </div>
              </div>
            ))}
            {!directory?.periodSummary.paymentMix.length ? (
              <div className={styles.noData}>
                Chưa có giao dịch capture trong kỳ lọc.
              </div>
            ) : null}
          </div>
          <span className={styles.tableMeta}>
            Tổng mix: {money(mixTotal, currency)}
          </span>
        </section>
        <div className={styles.workspace}>
          <div className={styles.mainColumn}>
            <section
              className={`${styles.card} ${styles.filters}`}
              aria-label="Bộ lọc giao dịch"
            >
              <div className={styles.filterGrid}>
                <div className={styles.field}>
                  <label htmlFor="payment-search">
                    Tìm mã giao dịch / hóa đơn / đơn POS / khách hàng
                  </label>
                  <input
                    id="payment-search"
                    className={styles.input}
                    value={searchDraft}
                    onChange={(event) => setSearchDraft(event.target.value)}
                    placeholder="Nhập từ khóa tìm kiếm…"
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="payment-branch">Chi nhánh</label>
                  <select
                    id="payment-branch"
                    className={styles.select}
                    value={filters.branchId}
                    onChange={(event) => update("branchId", event.target.value)}
                  >
                    <option value="">Tất cả chi nhánh</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label htmlFor="payment-tender">Phương thức</label>
                  <select
                    id="payment-tender"
                    className={styles.select}
                    value={filters.tenderType}
                    onChange={(event) =>
                      update("tenderType", event.target.value)
                    }
                  >
                    <option value="">Tất cả</option>
                    <option value="CASH">Tiền mặt</option>
                    <option value="BANK_TRANSFER">Chuyển khoản</option>
                    <option value="CARD_EXTERNAL">Thẻ</option>
                    <option value="OTHER_EXTERNAL">Khác</option>
                  </select>
                </div>
                <div className={styles.field}>
                  <label htmlFor="payment-status">Trạng thái capture</label>
                  <select
                    id="payment-status"
                    className={styles.select}
                    value={filters.status}
                    onChange={(event) => update("status", event.target.value)}
                  >
                    <option value="">Tất cả</option>
                    {Object.entries(STATUS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label htmlFor="payment-from">Từ ngày</label>
                  <input
                    id="payment-from"
                    className={styles.dateInput}
                    type="date"
                    value={filters.dateFrom}
                    onChange={(event) => update("dateFrom", event.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="payment-to">Đến ngày</label>
                  <input
                    id="payment-to"
                    className={styles.dateInput}
                    type="date"
                    value={filters.dateTo}
                    onChange={(event) => update("dateTo", event.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="payment-sort">Sắp xếp</label>
                  <select
                    id="payment-sort"
                    className={styles.select}
                    value={filters.sort}
                    onChange={(event) => update("sort", event.target.value)}
                  >
                    <option value="NEWEST">Mới nhất</option>
                    <option value="OLDEST">Cũ nhất</option>
                    <option value="AMOUNT_DESC">Số tiền cao nhất</option>
                    <option value="AMOUNT_ASC">Số tiền thấp nhất</option>
                  </select>
                </div>
              </div>
              <div className={styles.filterLine}>
                <div className={styles.chips}>
                  <button
                    className={`${styles.chip} ${!filters.status && filters.reconciliation === "ALL" && filters.refund === "ANY" ? styles.chipActive : ""}`}
                    onClick={() =>
                      setFilters((value) => ({
                        ...value,
                        status: "",
                        reconciliation: "ALL",
                        refund: "ANY",
                        page: 1,
                      }))
                    }
                  >
                    Tất cả
                  </button>
                  <button
                    className={`${styles.chip} ${filters.status === "CAPTURED" ? styles.chipActive : ""}`}
                    onClick={() => update("status", "CAPTURED")}
                  >
                    Thành công
                  </button>
                  <button
                    className={`${styles.chip} ${filters.status === "PENDING" || filters.status === "AUTHORIZED" ? styles.chipActive : ""}`}
                    onClick={() => update("status", "PENDING")}
                  >
                    Đang xử lý
                  </button>
                  <button
                    className={`${styles.chip} ${filters.reconciliation === "NEEDS_ATTENTION" ? styles.chipActive : ""}`}
                    onClick={() => update("reconciliation", "NEEDS_ATTENTION")}
                  >
                    Cần đối soát
                  </button>
                  <button
                    className={`${styles.chip} ${filters.refund === "HAS_REFUND" ? styles.chipActive : ""}`}
                    onClick={() => update("refund", "HAS_REFUND")}
                  >
                    Có hoàn tiền
                  </button>
                </div>
                <span className={styles.live}>
                  <span /> Cập nhật realtime · 15 giây
                </span>
              </div>
            </section>
            {loading ? (
              <section className={`${styles.card} ${styles.tableCard}`}>
                <div className={styles.tableHeader}>
                  <div className={styles.skeleton} style={{ width: 190 }} />
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <tbody>
                      {Array.from({ length: 6 }, (_, row) => (
                        <tr key={row}>
                          {Array.from({ length: 10 }, (_, cell) => (
                            <td key={cell}>
                              <div className={styles.skeleton} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : (
              <section className={`${styles.card} ${styles.tableCard}`}>
                <div className={styles.tableHeader}>
                  <div>
                    <h2 className={styles.sectionTitle}>Danh sách giao dịch</h2>
                    <div className={styles.tableMeta}>
                      {directory?.pagination.total ?? 0} giao dịch trong bộ lọc
                      hiện tại
                    </div>
                  </div>
                  <span className={styles.tableMeta}>
                    Số tiền = requestedMinor · đã ghi nhận = capturedMinor
                  </span>
                </div>
                {directory?.items.length ? (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          {[
                            "Mã giao dịch",
                            "Thời gian",
                            "Khách hàng",
                            "Phương thức",
                            "Nguồn",
                            "Số tiền",
                            "Đã ghi nhận",
                            "Trạng thái",
                            "Quầy / Thu ngân",
                            "Thao tác",
                          ].map((header) => (
                            <th key={header}>{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {directory.items.map((item) => {
                          const [label, kind] = statusMeta(item.status);
                          return (
                            <tr
                              key={item.id}
                              className={
                                item.id === selectedId ? styles.selected : ""
                              }
                              onClick={() => setSelectedId(item.id)}
                              aria-selected={item.id === selectedId}
                            >
                              <td>
                                <span className={styles.strong}>
                                  {item.paymentReference}
                                </span>
                                <span className={styles.small}>
                                  {item.id.slice(0, 8)}
                                </span>
                              </td>
                              <td>
                                {dateTime(
                                  item.capturedAt ?? item.createdAt,
                                  item.branchName,
                                )}
                              </td>
                              <td>
                                <span className={styles.strong}>
                                  {item.customerDisplayName}
                                </span>
                                {item.customerPhone ? (
                                  <span className={styles.small}>
                                    {item.customerPhone}
                                  </span>
                                ) : null}
                              </td>
                              <td>
                                <Badge
                                  kind={
                                    item.tenderType === "CASH"
                                      ? "green"
                                      : item.tenderType === "CARD_EXTERNAL"
                                        ? "purple"
                                        : "gray"
                                  }
                                >
                                  {TENDER_LABELS[item.tenderType] ??
                                    item.tenderType}
                                </Badge>
                                {item.tenderType === "CARD_EXTERNAL" &&
                                item.cardLast4 ? (
                                  <span className={styles.small}>
                                    {item.cardBrand ?? "Card"} ·••••{" "}
                                    {item.cardLast4}
                                  </span>
                                ) : null}
                              </td>
                              <td>
                                <span className={styles.strong}>POS</span>
                                <span className={styles.small}>
                                  {item.orderNumber}
                                </span>
                              </td>
                              <td className={styles.money}>
                                {money(item.requestedMinor, item.currency)}
                              </td>
                              <td
                                className={`${styles.money} ${styles.strong}`}
                              >
                                {money(item.capturedMinor, item.currency)}
                                {item.cashReceivedMinor != null ? (
                                  <span className={styles.small}>
                                    Khách đưa{" "}
                                    {money(
                                      item.cashReceivedMinor,
                                      item.currency,
                                    )}
                                  </span>
                                ) : null}
                              </td>
                              <td>
                                <Badge kind={item.attention ? "rose" : kind}>
                                  {item.attention ? "Cần đối soát" : label}
                                </Badge>
                                {item.hasRefund ? (
                                  <span className={styles.small}>
                                    {refundLabel(item)}
                                  </span>
                                ) : null}
                              </td>
                              <td>
                                <span className={styles.strong}>
                                  {item.registerCode ??
                                    item.registerName ??
                                    "—"}
                                </span>
                                <span className={styles.small}>
                                  {item.cashierDisplayName ?? "—"}
                                </span>
                              </td>
                              <td>
                                <div
                                  className={styles.rowActions}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <button
                                    className={styles.iconButton}
                                    title="Xem chi tiết"
                                    aria-label="Xem chi tiết"
                                    onClick={() => setSelectedId(item.id)}
                                  >
                                    ◉
                                  </button>
                                  <Link
                                    className={styles.iconButton}
                                    href={`/admin/pos/orders/${item.orderId}`}
                                    title="Mở đơn POS"
                                    aria-label="Mở đơn POS"
                                  >
                                    ↗
                                  </Link>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className={styles.empty}>
                    <strong>Không có giao dịch phù hợp</strong>
                    <p>Không có bản ghi nào phù hợp với bộ lọc hiện tại.</p>
                    <button
                      className={styles.button}
                      onClick={() =>
                        setFilters({
                          ...EMPTY_FILTERS,
                          branchId: filters.branchId,
                        })
                      }
                    >
                      Xóa bộ lọc
                    </button>
                  </div>
                )}
                <div className={styles.pagination}>
                  <span>
                    Hiển thị {from}–{to} trong{" "}
                    {directory?.pagination.total ?? 0} giao dịch
                  </span>
                  <div className={styles.paginationControls}>
                    <button
                      className={styles.pageButton}
                      disabled={filters.page <= 1}
                      onClick={() => update("page", filters.page - 1)}
                    >
                      ‹
                    </button>
                    {Array.from(
                      { length: Math.min(5, totalPages) },
                      (_, index) => {
                        const page = Math.min(
                          Math.max(1, filters.page - 2) + index,
                          totalPages,
                        );
                        return (
                          <button
                            key={page}
                            className={`${styles.pageButton} ${filters.page === page ? styles.pageButtonActive : ""}`}
                            onClick={() => update("page", page)}
                          >
                            {page}
                          </button>
                        );
                      },
                    )}
                    <button
                      className={styles.pageButton}
                      disabled={filters.page >= totalPages}
                      onClick={() => update("page", filters.page + 1)}
                    >
                      ›
                    </button>
                    <select
                      className={styles.select}
                      style={{ width: 90, minHeight: 30 }}
                      value={filters.pageSize}
                      onChange={(event) =>
                        update("pageSize", Number(event.target.value))
                      }
                    >
                      <option value={10}>10 / trang</option>
                      <option value={20}>20 / trang</option>
                      <option value={50}>50 / trang</option>
                      <option value={100}>100 / trang</option>
                    </select>
                  </div>
                </div>
              </section>
            )}
            <section className={styles.summaryGrid}>
              <div className={`${styles.card} ${styles.summary}`}>
                <span className={styles.summaryLabel}>Tổng giao dịch</span>
                <strong>{directory?.counts.total ?? 0}</strong>
              </div>
              <div className={`${styles.card} ${styles.summary}`}>
                <span className={styles.summaryLabel}>Đã capture</span>
                <strong>{directory?.counts.captured ?? 0}</strong>
              </div>
              <div className={`${styles.card} ${styles.summary}`}>
                <span className={styles.summaryLabel}>Đang xử lý</span>
                <strong>{directory?.counts.processing ?? 0}</strong>
              </div>
              <div className={`${styles.card} ${styles.summary}`}>
                <span className={styles.summaryLabel}>Thất bại</span>
                <strong>{directory?.counts.failed ?? 0}</strong>
              </div>
            </section>
          </div>
          <PaymentInspector
            item={selected}
            detail={detail}
            loading={detailLoading}
            context={context}
          />
        </div>
      </div>
    </main>
  );
}

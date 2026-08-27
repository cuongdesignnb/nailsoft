/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authorizedFetch } from "../auth";

export type BenefitState = "loading" | "ready" | "empty" | "error" | "forbidden" | "offline";

export function rows(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

export function localized(value: any, fallback = "-") {
  if (value == null || value === "") return fallback;
  if (typeof value === "string") return value;
  return value["vi-VN"] ?? value["en-US"] ?? value.name ?? value.code ?? fallback;
}

const benefitLabels: Record<string, string> = {
  "Benefits wallet": "Ví quyền lợi",
  "Customer benefit wallet": "Ví quyền lợi khách hàng",
  "Loyalty programs": "Chương trình Loyalty",
  "Loyalty adjustments": "Điều chỉnh Loyalty",
  "Voucher campaigns": "Chiến dịch Voucher",
  "Voucher campaign": "Chiến dịch Voucher",
  "Voucher codes": "Mã Voucher",
  "Customer loyalty ledger": "Lịch sử Loyalty của khách",
  "Membership history": "Lịch sử Membership",
  "Membership tiers": "Hạng Membership",
  "Service package catalog": "Danh mục gói dịch vụ",
  "Package ledger": "Lịch sử gói dịch vụ",
  "Benefit liability": "Nghĩa vụ quyền lợi",
  "customer credit accounts": "tài khoản Store Credit",
  "customer credit balance": "số dư Store Credit",
  "customer credit ledger": "lịch sử Store Credit",
  "loyalty programs": "chương trình Loyalty",
  "loyalty adjustments": "điều chỉnh Loyalty",
  "voucher campaigns": "chiến dịch Voucher",
  "voucher campaign": "chiến dịch Voucher",
  "voucher codes": "mã Voucher",
  "service packages": "gói dịch vụ",
  "package detail": "chi tiết gói dịch vụ",
  "package entitlement": "quyền lợi gói dịch vụ",
  "package entitlements": "quyền lợi gói dịch vụ",
  "entitlement ledger": "lịch sử quyền lợi",
  "ledger entries": "bút toán",
  "customer credit ledger entries": "bút toán Store Credit",
  "gift card ledger entries": "bút toán Gift Card",
};

export function benefitLabel(value: string, fallback = value) {
  return benefitLabels[value] ?? fallback;
}

export function statusLabel(value: any) {
  const raw = String(value ?? "UNKNOWN").toUpperCase();
  const labels: Record<string, string> = {
    ACTIVE: "Đang hoạt động", INACTIVE: "Không hoạt động", ARCHIVED: "Đã lưu trữ", SUSPENDED: "Tạm dừng", PAUSED: "Tạm dừng",
    DRAFT: "Bản nháp", PENDING: "Chờ xử lý", PENDING_APPROVAL: "Chờ phê duyệt", APPROVED: "Đã phê duyệt", SCHEDULED: "Đã lên lịch", RUNNING: "Đang chạy", COMPLETED: "Đã hoàn tất", CANCELLED: "Đã hủy", FAILED: "Thất bại", OPEN: "Đang mở", IN_PROGRESS: "Đang xử lý", RESOLVED: "Đã xử lý", CLOSED: "Đã đóng", TRIAGED: "Đã phân loại", WAITING_CUSTOMER: "Chờ khách", REJECTED: "Đã từ chối", EXPIRED: "Đã hết hạn", DEPLETED: "Đã dùng hết", SUPPRESSED: "Đã chặn", SENT: "Đã gửi", PROCESSING: "Đang gửi", SERVICE_RECOVERY_CREDIT: "Credit chăm sóc khách hàng", MANUAL_CREDIT: "Điều chỉnh tăng", MANUAL_DEBIT: "Điều chỉnh giảm", CUSTOMER_CREDIT: "Store Credit", LOYALTY_POINTS: "Điểm Loyalty", VOUCHER: "Voucher", EMAIL: "Email", CALL: "Cuộc gọi", INTERNAL_NOTE: "Ghi chú nội bộ", FOLLOW_UP: "Follow-up", SERVICE_RECOVERY: "Service Recovery", LOW: "Thấp", MEDIUM: "Trung bình", HIGH: "Cao", CRITICAL: "Khẩn cấp", NET_ORDER_AFTER_DISCOUNT_BEFORE_TIP: "Doanh thu thuần sau giảm giá, trước tip", ROLLING_SPEND: "Chi tiêu theo chu kỳ", LIFETIME_SPEND: "Tổng chi tiêu", VISIT_COUNT: "Số lượt ghé", POINTS_EARNED: "Điểm đã tích", MANUAL: "Thủ công", PERCENT_DISCOUNT: "Giảm giá theo phần trăm", RESTORE_UNIT: "Khôi phục lượt", DO_NOT_RESTORE: "Không khôi phục", MANUAL_REVIEW: "Kiểm tra thủ công"
  };
  return labels[raw] ?? raw.replaceAll("_", " ");
}

export function formatDate(value: any) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(value)));
}

export function formatMoney(value: any, currency = "VND") {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: currency === "VND" ? 0 : 2 }).format(currency === "VND" ? number : number / 100);
}

export function formatInteger(value: any) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Number(value ?? 0));
}

export function safeVoucherCode(value: any) {
  if (value?.maskedCode) return String(value.maskedCode);
  if (value?.codeLast4) return `•••• ${String(value.codeLast4)}`;
  return "Mã đã che";
}

function errorFrom(body: any, fallback: string) {
  return body?.error?.message ?? body?.message ?? fallback;
}

export async function benefitApi(path: string, init?: RequestInit) {
  if (typeof navigator !== "undefined" && !navigator.onLine && init?.method && init.method !== "GET") {
    throw Object.assign(new Error("Cần kết nối mạng. Thay đổi quyền lợi không được xếp hàng khi ngoại tuyến."), { offline: true });
  }
  const response = await authorizedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error(errorFrom(body, "Bạn không có quyền xem khu vực này.")), { forbidden: true, code: body?.error?.code });
  }
  if (!response.ok) throw Object.assign(new Error(errorFrom(body, "Không thể hoàn tất yêu cầu quyền lợi.")), { code: body?.error?.code, status: response.status });
  return body?.data;
}

export function useBenefitResource(path: string | null) {
  const [state, setState] = useState<BenefitState>(path ? "loading" : "empty");
  const [data, setData] = useState<any>();
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState<string | undefined>();
  const load = useCallback(async () => {
    if (!path) { setState("empty"); return; }
    if (typeof navigator !== "undefined" && !navigator.onLine) { setState("offline"); return; }
    setState("loading"); setError(""); setErrorCode(undefined);
    try {
      const value = await benefitApi(path);
      setData(value);
      setState(rows(value).length || (value && !Array.isArray(value)) ? "ready" : "empty");
    } catch (cause: any) {
      if (cause?.offline) setState("offline");
      else if (cause?.forbidden) setState("forbidden");
      else setState("error");
      setError(cause?.message ?? "Không thể hoàn tất yêu cầu quyền lợi.");
      setErrorCode(cause?.code);
    }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { state, data, error, errorCode, load };
}

export function useBenefitMutation() {
  const [state, setState] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [code, setCode] = useState<string | undefined>();
  const intentKeys = useRef<Record<string, string>>({});
  async function submit(path: string, body: unknown) {
    const intent = `${path}:${JSON.stringify(body ?? null)}`;
    const idempotencyKey = intentKeys.current[intent] ?? (intentKeys.current[intent] = crypto.randomUUID());
    setState("submitting"); setMessage(""); setCode(undefined);
    try {
      const value = await benefitApi(path, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify(body) });
      delete intentKeys.current[intent];
      setState("success"); setMessage("Đã hoàn tất thao tác sau khi máy chủ xác nhận.");
      return value;
    } catch (cause: any) {
      setState("error"); setCode(cause?.code); setMessage(cause?.message ?? "Thao tác thất bại. Hãy kiểm tra lỗi và thử lại thủ công.");
      return undefined;
    }
  }
  return { state, message, code, submit };
}

export function BenefitStatePanel({ resource, label, partial = false }: { resource: ReturnType<typeof useBenefitResource>; label: string; partial?: boolean }) {
  if (resource.state === "loading") return <div className="s19-state" role="status" aria-live="polite"><span className="s19-spinner" />Đang tải {benefitLabel(label)}...</div>;
  if (resource.state === "forbidden") return <div className="s19-state s19-state-danger" role="alert"><strong>Bạn không có quyền xem</strong><span>Khu vực quyền lợi này không khả dụng với quyền hiện tại.</span></div>;
  if (resource.state === "offline") return <div className="s19-state" role="alert"><strong>Đang ngoại tuyến</strong><span>Dữ liệu quyền lợi không khả dụng khi mất mạng.</span><button className="s19-button s19-button-secondary" type="button" onClick={() => void resource.load()}>Thử lại</button></div>;
  if (resource.state === "error") return <div className="s19-state s19-state-danger" role="alert"><strong>Không thể tải {benefitLabel(label)}</strong><span>{resource.error}</span><button className="s19-button s19-button-secondary" type="button" onClick={() => void resource.load()}>Thử lại</button></div>;
  if (resource.state === "empty") return <div className="s19-state" role="status"><strong>Chưa có {benefitLabel(label)}</strong><span>Chưa có dữ liệu quyền lợi trong phạm vi hiện tại.</span><button className="s19-button s19-button-secondary" type="button" onClick={() => void resource.load()}>Làm mới</button></div>;
  if (partial) return <div className="s19-notice s19-notice-warning" role="status">Một số khu vực quyền lợi tùy chọn không khả dụng với quyền hiện tại.</div>;
  return null;
}

export function BenefitShell({ title, eyebrow = "CUSTOMER BENEFITS", backHref = "/admin/benefits", children }: { title: string; eyebrow?: string; backHref?: string; children: React.ReactNode }) {
  const titleMap: Record<string, string> = { "Customer credit": "Store Credit", "Stored-value adjustments": "Điều chỉnh Store Credit", "Voucher codes": "Mã Voucher khách hàng", "Voucher campaign detail": "Chi tiết chương trình Voucher", "Voucher campaigns": "Chiến dịch Voucher", "Service package catalog": "Danh mục gói dịch vụ", "Customer package entitlements": "Gói dịch vụ của khách", "Package entitlement detail": "Chi tiết gói dịch vụ", "Membership": "Membership & Hạng thành viên", "Membership tiers": "Các hạng Membership", "Loyalty programs": "Chương trình Loyalty", "Loyalty adjustments": "Điều chỉnh Loyalty", "Gift card products": "Sản phẩm Gift Card", "Gift card issuance": "Phát hành Gift Card", "Benefits wallet": "Ví quyền lợi" };
  const eyebrowMap: Record<string, string> = { "STORED VALUE · DUAL CONTROL": "STORE CREDIT · KIỂM SOÁT KÉP", "STORED VALUE · CUSTOMER CREDIT": "STORE CREDIT · CUSTOMER CREDIT", "CUSTOMER BENEFITS · VOUCHERS": "KHÁCH HÀNG · VOUCHER", "VOUCHERS · LIFECYCLE": "VOUCHER · VÒNG ĐỜI", "STORED VALUE · PRODUCTS": "STORE CREDIT · SẢN PHẨM", "PACKAGE CATALOG": "GÓI DỊCH VỤ", "CUSTOMER BENEFITS": "QUYỀN LỢI KHÁCH HÀNG", "LOYALTY MANAGEMENT": "LOYALTY", "MEMBERSHIP": "MEMBERSHIP", "MEMBERSHIP CATALOG": "DANH MỤC MEMBERSHIP", "CONTROLLED BENEFIT OPERATIONS": "VẬN HÀNH QUYỀN LỢI CÓ KIỂM SOÁT" };
  return <main className="s19-benefit-page"><header className="s19-page-heading"><div><p className="s19-eyebrow">{eyebrowMap[eyebrow] ?? eyebrow}</p><h1>{titleMap[title] ?? title}</h1></div><a className="s19-button s19-button-secondary" href={backHref}>Quay lại</a></header>{children}</main>;
}

export function CustomerBenefitHeader({ customerId, backHref = "/admin/benefits" }: { customerId: string; backHref?: string }) {
  const profile = useBenefitResource(`/v1/customers/${encodeURIComponent(customerId)}`);
  const displayName = profile.data?.profile?.displayName ?? "Hồ sơ khách hàng";
  return <><div className="s19-benefit-customer-header"><div><p className="s19-eyebrow">KHÁCH HÀNG 360</p><h2>{displayName}</h2><p>Quyền lợi và số dư được kiểm soát theo quyền truy cập, lấy từ máy chủ.</p></div><a className="s19-button s19-button-secondary" href={backHref}>Quay lại hồ sơ</a></div>{profile.state === "loading" ? <div className="s19-state" role="status">Đang tải thông tin khách hàng...</div> : profile.state === "forbidden" ? <div className="s19-state s19-state-danger" role="alert"><strong>Không có quyền truy cập</strong><span>Không thể tải thông tin khách hàng với quyền hiện tại.</span></div> : profile.state === "error" ? <div className="s19-state s19-state-danger" role="alert"><strong>Không thể tải thông tin khách hàng</strong><span>{profile.error}</span><button className="s19-button s19-button-secondary" type="button" onClick={() => void profile.load()}>Thử lại</button></div> : null}</>;
}

export function LedgerTable({ entries, emptyLabel = "ledger entries" }: { entries: any[]; emptyLabel?: string }) {
  if (!entries.length) return <p className="s19-helper">Chưa có {benefitLabel(emptyLabel, emptyLabel)}.</p>;
  return <div className="s19-benefit-table-wrap"><table className="s19-benefit-table"><caption className="s19-sr-only">{benefitLabel(emptyLabel, emptyLabel)}</caption><thead><tr><th scope="col">Bút toán</th><th scope="col">Thay đổi</th><th scope="col">Tham chiếu</th><th scope="col">Thời điểm</th></tr></thead><tbody>{entries.map((entry, index) => <tr key={entry.id ?? `${entry.entryType}-${index}`}><td data-label="Bút toán"><strong>{statusLabel(entry.entryType ?? entry.type ?? entry.status)}</strong></td><td data-label="Thay đổi"><span>{entry.pointsDelta != null ? `${entry.pointsDelta} điểm` : entry.availableDelta != null ? `${entry.availableDelta} đơn vị` : entry.unitsDelta != null ? `${entry.unitsDelta} đơn vị` : entry.points_delta != null ? `${entry.points_delta} điểm` : "Đã ghi nhận"}</span></td><td data-label="Tham chiếu">{entry.sourceReference ?? "Mã giao dịch được bảo vệ"}</td><td data-label="Thời điểm">{formatDate(entry.occurredAt ?? entry.createdAt ?? entry.created_at)}</td></tr>)}</tbody></table></div>;
}

export function partialState(resources: Array<ReturnType<typeof useBenefitResource>>) {
  return resources.some((resource) => resource.state === "forbidden" || resource.state === "error") && resources.some((resource) => resource.state === "ready" || resource.state === "empty");
}

export function useCustomerLookup() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const resource = useBenefitResource(submitted ? `/v1/customers?search=${encodeURIComponent(submitted)}&limit=10` : null);
  const results = useMemo(() => rows(resource.data), [resource.data]);
  function search() { setSubmitted(query.trim()); }
  return { query, setQuery, search, resource, results, selectedId: results.length === 1 ? results[0]?.id : undefined };
}

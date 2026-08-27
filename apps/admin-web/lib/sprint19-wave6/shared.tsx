"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button, Card, PageHeader, StatePanel, StatusBadge } from "@nailsoft/ui-web";
import { authorizedFetch } from "../auth";
import type { Wave6Route } from "./routes";

export type AsyncState = "loading" | "ready" | "empty" | "error" | "forbidden" | "offline";
export type Column = { key: string; label: string; money?: boolean; status?: boolean };
export type WorkspaceAction = { label: string; path: (row: any) => string; body?: (row: any) => Record<string, unknown>; idempotencyKey?: (row: any) => string; visible?: (row: any) => boolean };

const WAVE6_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Đang hoạt động", APPROVED: "Đã phê duyệt", CANCELLED: "Đã hủy", COMPLETED: "Đã hoàn tất", CLOSED: "Đã đóng",
  DRAFT: "Bản nháp", FAILED: "Thất bại", FRESH: "Mới cập nhật", HEALTHY: "Ổn định", INACTIVE: "Không hoạt động",
  OPEN: "Đang mở", PAID: "Đã thanh toán", PARTIALLY_PAID: "Thanh toán một phần", PENDING: "Đang chờ", PENDING_APPROVAL: "Chờ phê duyệt",
  POSTED: "Đã ghi sổ", PROCESSING: "Đang xử lý", REBUILDING: "Đang xây dựng lại", REJECTED: "Đã từ chối", STALE: "Đã cũ",
  SUBMITTED: "Đã gửi", SUCCEEDED: "Thành công", UNKNOWN: "Chưa xác định", VOID: "Đã vô hiệu hóa", DEGRADED: "Suy giảm",
  MATCHED: "Đã khớp", UNMATCHED: "Chưa khớp", SUGGESTED: "Đề xuất khớp", EXCLUDED: "Đã loại trừ", HOLD: "Đang giữ",
};

const WAVE6_TITLE_LABELS: Record<string, string> = {
  "Accounting control center": "Trung tâm kiểm soát kế toán", "Books & chart": "Sổ kế toán & hệ thống tài khoản", "Accounting periods": "Kỳ kế toán",
  "Journal workbench": "Sổ nhật ký", "Posting queue": "Hàng đợi ghi sổ", "Open items": "Khoản mục đang mở", "Financial reports": "Báo cáo tài chính",
  "Bank accounts & imports": "Tài khoản ngân hàng & dữ liệu nhập", "Statement lines & matching": "Dòng sao kê & đối soát", "Reconciliation & exceptions": "Đối soát & ngoại lệ",
  "Statement snapshots": "Snapshot sao kê", "Billing overview": "Tổng quan thanh toán gói", "Subscription": "Gói đăng ký", "Plans, entitlements & usage": "Gói, quyền sử dụng & sản lượng",
  "Invoices & history": "Hóa đơn & lịch sử thanh toán", "Invoice detail": "Chi tiết hóa đơn", "Payment methods": "Phương thức thanh toán",
  "Tenant support access": "Quyền hỗ trợ Tenant", "Plan, price & discount catalog": "Danh mục gói, giá & giảm giá", "Tenant directory": "Danh sách Tenant",
  "Tenant detail & lifecycle": "Chi tiết & vòng đời Tenant", "Tenant subscription": "Gói đăng ký Tenant", "Tenant entitlements & usage": "Quyền sử dụng & sản lượng Tenant",
  "Tenant invoices & payments": "Hóa đơn & thanh toán Tenant", "Platform invoice & payment operations": "Vận hành hóa đơn & thanh toán nền tảng",
  "Refund & reconciliation": "Hoàn tiền & đối soát nền tảng", "Dunning & platform reports": "Nhắc thanh toán & báo cáo nền tảng",
  "Platform support access": "Quyền hỗ trợ nền tảng", "Break-glass safety": "Kiểm soát truy cập khẩn cấp", "Analytics command center": "Trung tâm phân tích",
  "Sales analytics": "Phân tích doanh thu", "Booking analytics": "Phân tích lịch hẹn", "Staff analytics": "Phân tích nhân sự", "Data quality, alerts & exports": "Chất lượng dữ liệu, cảnh báo & xuất báo cáo",
  "Payroll runs": "Kỳ chạy bảng lương", "Payroll run detail": "Chi tiết kỳ chạy bảng lương", "Payroll periods": "Kỳ bảng lương",
  "Payouts": "Các khoản chi trả", "Payout detail": "Chi tiết khoản chi trả", "Staff directory": "Danh sách nhân sự",
  "Time clock": "Chấm công", "Timesheet periods": "Kỳ bảng công", "Timesheets": "Bảng công",
  "Billing history": "Lịch sử thanh toán", Plans: "Gói dịch vụ", "Price catalog": "Danh mục giá", "Discount catalog": "Danh mục giảm giá",
  "Payment operations": "Vận hành thanh toán", "Payment intents": "Ý định thanh toán", "Payment reconciliation": "Đối soát thanh toán",
  "Support grants": "Quyền hỗ trợ", "Platform reports": "Báo cáo nền tảng", "Tenant reports": "Báo cáo Tenant",
};

const WAVE6_COLUMN_LABELS: Record<string, string> = {
  id: "Mã bản ghi", tenantId: "Tenant", tenant_id: "Tenant", status: "Trạng thái", version: "Phiên bản", currency: "Tiền tệ",
  code: "Mã", name: "Tên", description: "Mô tả", type: "Loại", state: "Trạng thái", createdAt: "Ngày tạo", created_at: "Ngày tạo",
  updatedAt: "Cập nhật lúc", effectiveFrom: "Có hiệu lực từ", effectiveTo: "Có hiệu lực đến", expiresAt: "Hết hạn lúc", amountMinor: "Số tiền", amount_minor: "Số tiền",
  payrollPeriodId: "Kỳ bảng lương", payroll_period_id: "Kỳ bảng lương", runType: "Loại chạy", run_type: "Loại chạy", calculationVersion: "Phiên bản tính",
  supportUserId: "Nhân sự hỗ trợ", targetTenantId: "Tenant đích", expires_at: "Hết hạn lúc", invoiceNumber: "Số hóa đơn", reference: "Tham chiếu",
  providerReference: "Mã tham chiếu nhà cung cấp", paymentMethod: "Phương thức thanh toán", planId: "Gói", interval: "Chu kỳ", quantity: "Số lượng",
  Plan: "Gói dịch vụ", Name: "Tên", Status: "Trạng thái", Version: "Phiên bản", Renewal: "Gia hạn", From: "Từ ngày", To: "Đến ngày",
  Usage: "Mức sử dụng", Quota: "Hạn mức", Invoice: "Hóa đơn", Total: "Tổng tiền", Due: "Hạn thanh toán", Provider: "Nhà cung cấp",
  Method: "Phương thức", "Masked display": "Hiển thị đã che", Meter: "Chỉ số", Amount: "Số tiền", Active: "Đang hoạt động",
  planName: "Tên gói", planCode: "Mã gói", currentPeriodEnd: "Gia hạn", current_period_end: "Gia hạn", periodStart: "Từ ngày", periodEnd: "Đến ngày",
  methodType: "Phương thức", display: "Hiển thị đã che", startsAt: "Bắt đầu", endsAt: "Kết thúc", starts: "Bắt đầu", ends: "Kết thúc", dueAt: "Hạn thanh toán",
};

const WAVE6_ACTION_LABELS: Record<string, string> = {
  Activate: "Kích hoạt", Approve: "Phê duyệt", Calculate: "Tính toán", Cancel: "Hủy", Close: "Đóng", Deny: "Từ chối",
  Finalize: "Chốt kỳ", Publish: "Phát hành", "Publish version": "Phát hành phiên bản", Reconcile: "Đối soát", Reactivate: "Kích hoạt lại",
  Revoke: "Thu hồi", Submit: "Gửi duyệt", "Request close": "Yêu cầu khóa", "Open period": "Mở kỳ", Pay: "Thanh toán", Save: "Lưu",
};

const WAVE6_TEXT_LABELS: Record<string, string> = {
  "Books, periods, postings and close readiness.": "Sổ, kỳ kế toán, ghi sổ và điều kiện chốt kỳ.",
  "Books and the chart of accounts.": "Sổ kế toán và hệ thống tài khoản.",
  "Dual-control period lifecycle.": "Vòng đời kỳ kế toán có kiểm soát kép.",
  "Balanced journals and immutable posting evidence.": "Bút toán cân đối và bằng chứng ghi sổ bất biến.",
  "Source events waiting for posting.": "Sự kiện nguồn đang chờ ghi sổ.",
  "Tenant-scoped settlement work.": "Công việc tất toán trong phạm vi tenant.",
  "Server-generated statements and report periods.": "Báo cáo do máy chủ tạo và kỳ báo cáo.",
  "Bank accounts and statement import evidence.": "Tài khoản ngân hàng và bằng chứng nhập sao kê.",
  "Review statement lines and existing matches.": "Rà soát dòng sao kê và kết quả đối soát hiện có.",
  "Reconciliation lifecycle and persisted exceptions.": "Vòng đời đối soát và ngoại lệ đã lưu.",
  "Immutable statement snapshot evidence.": "Bằng chứng snapshot sao kê bất biến.",
  "Subscription billing, access and renewal.": "Thanh toán gói đăng ký, quyền truy cập và gia hạn.",
  "Server-authoritative subscription lifecycle.": "Vòng đời gói đăng ký do máy chủ quyết định.",
  "Plan, effective entitlements, quota and usage.": "Gói, quyền sử dụng hiệu lực, hạn mức và mức dùng.",
  "Platform subscription invoices, not salon POS invoices.": "Hóa đơn gói nền tảng, không phải hóa đơn POS salon.",
  "Immutable invoice evidence and collection status.": "Bằng chứng hóa đơn bất biến và trạng thái thu tiền.",
  "Masked provider payment methods.": "Phương thức thanh toán nhà cung cấp đã che.",
  "Scoped support grants with expiry and dual control.": "Quyền hỗ trợ có phạm vi, thời hạn và kiểm soát kép.",
  "Immutable plan and price lifecycle; discounts are read-only.": "Vòng đời gói và bảng giá bất biến; mã giảm giá chỉ đọc.",
  "Global platform tenant directory or scoped support target.": "Danh sách tenant nền tảng hoặc phạm vi hỗ trợ được cấp.",
  "Tenant billing lifecycle without salon operations.": "Vòng đời thanh toán tenant, tách biệt vận hành salon.",
  "Tenant subscription status and plan.": "Trạng thái gói đăng ký và gói của tenant.",
  "Effective server-authoritative entitlements and usage.": "Quyền sử dụng hiệu lực và mức dùng do máy chủ cung cấp.",
  "Target tenant invoices and payment evidence.": "Hóa đơn và bằng chứng thanh toán của tenant đích.",
  "Invoice and payment operations with explicit status.": "Vận hành hóa đơn và thanh toán với trạng thái rõ ràng.",
  "Independent refund approval and unknown-outcome reconciliation.": "Phê duyệt hoàn tiền độc lập và đối soát kết quả chưa xác định.",
  "Read-only delinquency monitoring and SaaS reports.": "Theo dõi công nợ quá hạn và báo cáo SaaS chỉ đọc.",
  "Platform support grant administration and scope.": "Quản trị và phạm vi quyền hỗ trợ nền tảng.",
  "Emergency access is intentionally disabled.": "Quyền truy cập khẩn cấp được tắt có chủ đích.",
  "KPIs, trends, branches, alerts and freshness.": "KPI, xu hướng, chi nhánh, cảnh báo và độ mới dữ liệu.",
  "Server-generated sales and service performance.": "Hiệu quả bán hàng và dịch vụ do máy chủ tổng hợp.",
  "Business-date booking and utilization metrics.": "Chỉ số lịch hẹn và mức sử dụng theo ngày kinh doanh.",
  "Permission-scoped workforce analytics.": "Phân tích nhân sự theo phạm vi quyền.",
  "Projection health, alerts, exports and rebuild evidence.": "Sức khỏe read model, cảnh báo, xuất báo cáo và bằng chứng rebuild.",
  "Plan versions are immutable after publish. Catalog configuration is unavailable during a support session.": "Phiên bản gói là bất biến sau khi phát hành. Không thể cấu hình danh mục trong phiên hỗ trợ.",
  "No create, edit or delete action is exposed for discounts.": "Màn hình này chỉ đọc; không cung cấp thao tác tạo, sửa hoặc xóa mã giảm giá.",
  "Enter integer minor units; no floating-point billing arithmetic is performed in the browser.": "Nhập số nguyên theo đơn vị minor; trình duyệt không tự tính tiền bằng số thực.",
  "Published tenant plans and prices are read from the billing contract.": "Gói và mức giá của tenant được đọc từ hợp đồng thanh toán.",
  "Immutable invoice and collection history.": "Lịch sử hóa đơn và thu tiền bất biến.",
  "Provider and masked method status only; raw card data is never collected in this UI.": "Chỉ hiển thị nhà cung cấp và trạng thái phương thức đã che; màn hình không thu thập dữ liệu thẻ thô.",
  "Usage and quota are effective server projections; the browser does not calculate entitlements.": "Mức sử dụng và hạn mức do máy chủ cung cấp; trình duyệt không tự tính quyền sử dụng.",
  "Platform subscription invoice:": "Hóa đơn gói nền tảng:",
  "This is separate from salon POS invoices.": "Khoản này tách biệt với hóa đơn POS của salon.",
  "Subscription billing overview with renewal and access evidence.": "Tổng quan gói đăng ký, gia hạn và bằng chứng quyền truy cập.",
  "Subscription lifecycle transitions are explicit, idempotent and confirmed by the server.": "Chuyển trạng thái gói đăng ký có lệnh rõ ràng, idempotent và được máy chủ xác nhận.",
  "Downgrade timing and proration are determined by the current billing contract.": "Thời điểm hạ gói và phân bổ chênh lệch được xác định bởi hợp đồng thanh toán hiện tại.",
  "Draft, publish, supersede and retire immutable versions": "Tạo nháp, phát hành, thay thế và ngừng phiên bản bất biến",
  "Plan, access status and renewal at a glance": "Tổng quan gói, quyền truy cập và gia hạn.",
  "Platform billing context only. Customers, appointments, payroll and salon POS are not exposed.": "Chỉ hiển thị bối cảnh thanh toán nền tảng. Không hiển thị khách hàng, lịch hẹn, bảng lương hoặc POS salon.",
  "Global directory for Platform Admin; an active Support Access session is target-tenant only.": "Danh sách tenant toàn nền tảng; phiên hỗ trợ đang hoạt động chỉ được phép trong tenant đích.",
  "Support access is tenant-targeted, time-limited and audited. A support session never grants global tenant or salon operational data.": "Quyền hỗ trợ có tenant đích, thời hạn và nhật ký kiểm tra. Phiên hỗ trợ không cấp quyền dữ liệu vận hành toàn tenant hoặc salon.",
  "Requesters cannot approve their own support grant. Scope, expiry and audit evidence remain server-authoritative.": "Người yêu cầu không thể tự phê duyệt quyền hỗ trợ. Phạm vi, thời hạn và bằng chứng kiểm tra do máy chủ quyết định.",
  "Provider calls happen outside database transactions; UNKNOWN outcomes require reconciliation before retry.": "Lệnh gọi nhà cung cấp nằm ngoài giao dịch cơ sở dữ liệu; kết quả CHƯA XÁC ĐỊNH phải được đối soát trước khi thử lại.",
  "Reconciliation status is read from persisted provider evidence; a timeout is never presented as FAILED.": "Trạng thái đối soát được đọc từ bằng chứng nhà cung cấp đã lưu; timeout không được hiển thị thành THẤT BẠI.",
  "SaaS-only report metrics; salon POS, payroll and customer data are excluded.": "Chỉ số báo cáo SaaS; loại trừ POS salon, bảng lương và dữ liệu khách hàng.",
  "Read-only delinquency monitoring; manual dunning actions are deferred.": "Theo dõi công nợ quá hạn chỉ đọc; thao tác nhắc thanh toán thủ công chưa được cung cấp.",
  "Independent refund approval and cumulative caps remain server-authoritative.": "Phê duyệt hoàn tiền độc lập và hạn mức lũy kế do máy chủ quyết định.",
  "Refund approval is independent from the requester and cumulative caps remain server-authoritative.": "Phê duyệt hoàn tiền phải độc lập với người yêu cầu; hạn mức lũy kế do máy chủ quyết định.",
  "Choose a book before reviewing statement lines.": "Chọn sổ trước khi xem dòng sao kê.",
  "Choose a book before requesting an adjustment or selecting an offset account.": "Chọn sổ trước khi yêu cầu điều chỉnh hoặc chọn tài khoản đối ứng.",
  "A reconciliation must be in matching or review before an adjustment can be requested.": "Đối soát phải ở trạng thái khớp hoặc cần xem xét trước khi tạo yêu cầu điều chỉnh.",
  "The server derives the bank GL account, period and posting rules. Amounts are positive minor units.": "Máy chủ tự xác định tài khoản ngân hàng, kỳ và quy tắc ghi sổ. Số tiền dùng đơn vị minor dương.",
};

const WAVE6_AREA_LABELS: Record<string, string> = {
  accounting: "KẾ TOÁN", banking: "NGÂN HÀNG", "tenant-billing": "THANH TOÁN",
  "platform-catalog": "DANH MỤC NỀN TẢNG", "platform-tenants": "TENANT",
  "platform-payments": "THANH TOÁN NỀN TẢNG", "support-access": "QUYỀN HỖ TRỢ", analytics: "PHÂN TÍCH",
};

export function wave6Title(value: string) { return WAVE6_TITLE_LABELS[value] ?? value; }
export function wave6Text(value: string) { return WAVE6_TEXT_LABELS[value] ?? value; }
export function wave6Area(value: string) { return WAVE6_AREA_LABELS[value] ?? value.toUpperCase(); }
export function wave6Error(value: string) {
  if (/not found|404/i.test(value)) return "Dữ liệu chưa có cho màn hình này.";
  if (/permission denied|forbidden|unauthorized/i.test(value)) return "Bạn không có quyền xem dữ liệu trong phạm vi hiện tại.";
  if (/unable to load|request failed|retry safely/i.test(value)) return "Không thể tải dữ liệu. Hãy thử lại.";
  return wave6Text(value);
}
export function wave6ColumnLabel(value: string) {
  const direct = WAVE6_COLUMN_LABELS[value];
  if (direct) return direct;
  const normalized = value.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  const normalizedLabels: Record<string, string> = {
    "accounting book": "Sổ kế toán", "accounting period": "Kỳ kế toán", "tenant": "Tenant", "slug": "Mã định danh",
    "access mode": "Chế độ truy cập", "subscription": "Gói đăng ký", "subscription status": "Trạng thái gói",
    "created": "Ngày tạo", "issued": "Ngày phát hành", "expires": "Hết hạn", "effective value": "Giá trị hiệu lực",
    "entitlement": "Quyền sử dụng", "source": "Nguồn", "invoice": "Hóa đơn", "amount": "Số tiền",
    "active subscriptions": "Gói đang hoạt động", "invoice total": "Tổng hóa đơn", "collected": "Đã thu",
  };
  if (normalizedLabels[normalized]) return normalizedLabels[normalized];
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
export function wave6ActionLabel(value: string) { return WAVE6_ACTION_LABELS[value] ?? value; }
function wave6Status(value: unknown) { const raw = String(value ?? "UNKNOWN").toUpperCase(); return WAVE6_STATUS_LABELS[raw] ?? raw.replaceAll("_", " "); }
function wave6MetricLabel(value: string) {
  const labels: Record<string, string> = {
    gross_sales_minor: "Doanh thu gộp", net_sales_minor: "Doanh thu thuần",
    payments_collected_minor: "Thanh toán đã thu", refunds_minor: "Hoàn tiền",
    tips_minor: "Tiền tip", tax_collected_minor: "Thuế đã thu",
    discount_minor: "Giảm giá", bookings_created: "Lịch hẹn đã tạo",
    paid_orders: "Đơn đã thanh toán", open_orders: "Đơn đang mở",
  };
  const normalized = value.toLowerCase().trim().replaceAll(" ", "_");
  return labels[normalized] ?? value.replaceAll("_", " ");
}

export function rowsFrom(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  return value == null ? [] : [value];
}

export function valueFrom(row: any, key: string): any {
  return key.split(".").reduce((current, part) => current == null ? undefined : current[part], row);
}

export function formatMinor(value: unknown, currency = "VND") {
  if (value == null || value === "") return "—";
  try {
    const amount = typeof value === "bigint" ? value : BigInt(String(value));
    const divisor = ["VND", "JPY", "KRW"].includes(currency.toUpperCase()) ? 1n : 100n;
    const whole = amount / divisor;
    const remainder = (amount < 0n ? -amount : amount) % divisor;
    if (divisor === 1n) return `${whole.toLocaleString("vi-VN")} ${currency}`;
    return `${whole.toLocaleString("vi-VN")},${remainder.toString().padStart(2, "0")} ${currency}`;
  } catch {
    return String(value);
  }
}

export function formatValue(value: unknown, column?: Column) {
  if (value == null || value === "") return "—";
  const key = column?.key ?? "";
  if (key === "id" || key.endsWith("Id") || key.endsWith("ID") || key.includes("uuid")) return "Mã hệ thống";
  if (column?.money) return formatMinor(value);
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (typeof value === "object") {
    if ("name" in (value as Record<string, unknown>)) return String((value as any).name);
    if ("displayName" in (value as Record<string, unknown>)) return String((value as any).displayName);
    return "Có dữ liệu";
  }
  const keyName = key.toLowerCase();
  if (/(at|date|_at|_date|start|end|from|to|due|renewal|expires)$/.test(keyName) && !Number.isNaN(Date.parse(String(value)))) {
    return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(value)));
  }
  if (keyName === "status" || keyName === "state" || keyName.endsWith("status")) return wave6Status(value);
  if (typeof value === "number") return new Intl.NumberFormat("vi-VN").format(value);
  return String(value);
}

export async function readApi(path: string) {
  const response = await authorizedFetch(path);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error(body.error?.message ?? "Bạn không có quyền xem khu vực này."), { forbidden: true });
  }
  if (!response.ok) throw new Error(body.error?.message ?? "Không thể tải dữ liệu do máy chủ cung cấp.");
  return body.data;
}

export async function commandApi(path: string, payload: Record<string, unknown> = {}, idempotencyKey = crypto.randomUUID()) {
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("Cần kết nối mạng. Thao tác này không được xếp hàng khi ngoại tuyến.");
  const response = await authorizedFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) throw new Error(body.error?.message ?? "Bạn không có quyền thực hiện thao tác này.");
  if (response.status === 409) throw new Error(body.error?.code === "VERSION_CONFLICT" ? "XUNG ĐỘT PHIÊN BẢN: Bản ghi đã thay đổi. Hãy tải lại trước khi thử lại." : body.error?.message ?? "Thao tác đang xung đột với một thay đổi khác.");
  if (!response.ok) throw new Error(body.error?.message ?? "Không thể hoàn tất thao tác.");
  return body.data;
}

export function Status({ value }: { value: unknown }) {
  const text = String(value ?? "UNKNOWN");
  const tone = /FAILED|DENIED|VOID|CANCELLED|UNKNOWN|STALE|DEGRADED/.test(text) ? "danger" : /PENDING|DRAFT|DELAYED|REBUILDING/.test(text) ? "warning" : /SUCCESS|ACTIVE|COMPLETED|POSTED|FRESH|HEALTHY|APPROVED/.test(text) ? "success" : "neutral";
  return <StatusBadge tone={tone}>{wave6Status(text)}</StatusBadge>;
}

export function FreshnessBadge({ value }: { value?: unknown }) {
  return <Status value={value ?? "FRESH"} />;
}

export function ImmutableRecordBadge() { return <StatusBadge tone="info">Bản ghi bất biến</StatusBadge>; }
export function DualControlNotice({ children = "Thao tác phê duyệt cần một người dùng đã xác thực khác." }: { children?: ReactNode }) { return <p className="ns-gallery-banner"><strong>Kiểm soát kép:</strong> {typeof children === "string" ? wave6Text(children) : children}</p>; }
export function VersionConflictPanel() { return <StatePanel state="error" title="Xung đột phiên bản" detail="Bản ghi đã thay đổi trên máy chủ. Hãy tải lại trước khi thử lại." />; }
export function SensitiveReference({ value }: { value?: unknown }) { return <span className="ns-sensitive-reference">{value ? "••••" : "Không hiển thị"}</span>; }

export function WorkspaceNav({ route }: { route: Wave6Route }) {
  void route;
  return null;
}

export function ReadWorkspace({ route, endpoint, columns, description, actions = [], children, transform, summary }: { route: Wave6Route; endpoint: string; columns: Column[]; description?: string; actions?: WorkspaceAction[]; children?: ReactNode; transform?: (value: any) => any; summary?: (value: any) => ReactNode }) {
  const localizedRoute = { ...route, title: wave6Title(route.title) };
  const [state, setState] = useState<AsyncState>("loading");
  const [rows, setRows] = useState<any[]>([]);
  const [raw, setRaw] = useState<any>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setState("loading"); setError("");
    try {
      const value = transform ? transform(await readApi(endpoint)) : await readApi(endpoint);
      setRaw(value); const next = rowsFrom(value); setRows(next); setState(next.length || (value && typeof value === "object" && !Array.isArray(value) ? "ready" : false) ? "ready" : "empty");
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể tải dữ liệu chính thức."); setState(cause?.forbidden ? "forbidden" : (typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error"));
    }
  }, [endpoint, transform]);
  useEffect(() => { void load(); }, [load]);
  async function act(action: WorkspaceAction, row: any) {
    setBusy(true); setError(""); setNotice("");
    try { await commandApi(action.path(row), action.body?.(row) ?? { version: row.version }, action.idempotencyKey?.(row)); setNotice("Đã lưu. Dữ liệu do máy chủ xác nhận đã được tải lại."); await load(); }
    catch (cause: any) { setError(cause?.message ?? "Không thể hoàn tất thao tác."); }
    finally { setBusy(false); }
  }
  return <main className="shell ops-shell">
    <WorkspaceNav route={localizedRoute} />
    <PageHeader eyebrow={`NailSoft · ${wave6Area(route.area)}`} title={localizedRoute.title} description={wave6Text(description ?? route.description)} actions={<Button variant="secondary" onClick={() => void load()} disabled={state === "loading"}>Làm mới</Button>} />
    {notice && <p role="status" className="success">{notice}</p>}
    {state === "loading" && <StatePanel state="loading" title="Đang tải dữ liệu" detail="PostgreSQL vẫn là nguồn dữ liệu chính thức." />}
    {state === "forbidden" && <StatePanel state="forbidden" title="Không có quyền truy cập" detail="Quyền hoặc phạm vi hiện tại không bao gồm khu vực này." onRetry={() => void load()} />}
    {state === "offline" && <StatePanel state="offline" title="Đang ngoại tuyến" detail="Không thể đọc dữ liệu khi mất mạng. Thao tác không được xếp hàng ngoại tuyến." onRetry={() => void load()} />}
    {state === "error" && <StatePanel state="error" title="Không thể tải dữ liệu" detail={wave6Error(error)} onRetry={() => void load()} />}
    {state === "empty" && <StatePanel state="empty" title="Chưa có dữ liệu" detail="Chưa có bản ghi trong phạm vi được cấp quyền." onRetry={() => void load()} />}
    {state === "ready" && <>
      {summary ? summary(raw) : null}
      {error && <p role="alert" className="error">{error}</p>}
      <Card className="ns-table-card"><div className="ns-table-scroll"><table><caption className="sr-only">{localizedRoute.title}</caption><thead><tr>{columns.map((column) => <th key={column.key} scope="col">{wave6ColumnLabel(column.label)}</th>)}{actions.length ? <th scope="col">Thao tác</th> : null}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id ?? row.reference ?? index}>{columns.map((column) => <td key={column.key} data-label={wave6ColumnLabel(column.label)}>{column.status ? <Status value={valueFrom(row, column.key)} /> : formatValue(valueFrom(row, column.key), column)}</td>)}{actions.length ? <td className="actions">{actions.filter((action) => action.visible?.(row) ?? true).map((action) => <Button key={action.label} variant="secondary" disabled={busy} onClick={() => void act(action, row)}>{wave6ActionLabel(action.label)}</Button>)}</td> : null}</tr>)}</tbody></table></div></Card>
    </>}
    {children}
  </main>;
}

export function MetricCards({ values }: { values: Array<{ label: string; value: unknown; money?: boolean }> }) { return <div className="metric-grid">{values.map((item) => <article className="metric-card" key={item.label}><span>{wave6MetricLabel(item.label)}</span><strong>{item.money ? formatMinor(item.value) : String(item.value ?? "—")}</strong></article>)}</div>; }

export function FieldForm({ title, fields, onSubmit, submitLabel = "Lưu", note, initialValues = {} }: { title: string; fields: Array<{ name: string; label: string; type?: string; required?: boolean; readOnly?: boolean; options?: Array<string | { value: string; label: string }> }>; onSubmit: (values: Record<string, string>) => Promise<void>; submitLabel?: string; note?: string; initialValues?: Record<string, string> }) {
  const [values, setValues] = useState<Record<string, string>>(initialValues); const [saving, setSaving] = useState(false); const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); setMessage(""); try { await onSubmit(values); setValues({}); setMessage("Đã lưu sau khi máy chủ xác nhận."); } catch (cause: any) { setMessage(cause?.message ?? "Không thể lưu."); } finally { setSaving(false); } }
  return <Card className="ns-form-card"><h2>{wave6Title(title)}</h2>{note && <p className="hint">{wave6Text(note)}</p>}<form className="form-grid" onSubmit={(event) => void submit(event)} noValidate>{fields.map((field) => <label key={field.name}>{wave6ColumnLabel(field.label)}{field.options ? <select required={field.required} disabled={field.readOnly} value={values[field.name] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}><option value="">Chọn…</option>{field.options.map((option) => { const item = typeof option === "string" ? { value: option, label: wave6Status(option) } : option; return <option key={item.value} value={item.value}>{item.label}</option>; })}</select> : <input required={field.required} readOnly={field.readOnly} type={field.type ?? "text"} value={values[field.name] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))} />}</label>)}<Button type="submit" disabled={saving}>{saving ? "Đang lưu…" : wave6ActionLabel(submitLabel)}</Button>{message && <p role="status">{message}</p>}</form></Card>;
}

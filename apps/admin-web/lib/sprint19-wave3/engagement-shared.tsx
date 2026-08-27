"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useBenefitMutation, useBenefitResource, benefitApi, formatDate, localized, rows, statusLabel } from "./benefit-shared";

export { benefitApi, formatDate, localized, rows, statusLabel, useBenefitMutation, useBenefitResource };

function engagementTitle(title: string) {
  const labels: Record<string, string> = {
    "Message delivery": "Giao nhận Email",
    "Contact suppressions": "Danh sách Email bị chặn",
    "Communication templates": "Mẫu Email",
    "Communication rules": "Quy tắc gửi",
    "Customer segments": "Nhóm khách hàng",
    "Service recovery": "Service Recovery",
    Reviews: "Đánh giá khách hàng",
    "Review requests": "Yêu cầu đánh giá",
    "Review detail": "Chi tiết đánh giá",
  };
  return labels[title] ?? title;
}

export function EngagementShell({ title, eyebrow = "CUSTOMER ENGAGEMENT · EMAIL ONLY", children }: { title: string; eyebrow?: string; children: React.ReactNode }) {
  return <main className="s19-benefit-page s19-engagement-page"><header className="s19-page-heading"><div><p className="s19-eyebrow">{eyebrow === "CUSTOMER ENGAGEMENT · CONTACT SAFETY" ? "KHÁCH HÀNG · AN TOÀN LIÊN HỆ" : "KHÁCH HÀNG · CHỈ EMAIL"}</p><h1>{engagementTitle(title)}</h1><p className="s19-helper">Consent và suppression được kiểm tra bởi máy chủ tại thời điểm gửi. Không suy đoán trạng thái Email khi chưa có bằng chứng từ hệ thống.</p></div><span className="s19-status s19-status-info">Chỉ Email</span></header>{children}</main>;
}

export function EngagementStates({ resource, label }: { resource: ReturnType<typeof useBenefitResource>; label: string }) {
  if (resource.state === "loading") return <div className="s19-state" role="status"><span className="s19-spinner" />Đang tải {label}…</div>;
  if (resource.state === "forbidden") return <div className="s19-state s19-state-danger" role="alert"><strong>Bạn không có quyền xem</strong><span>Khu vực này không khả dụng trong phạm vi quyền hiện tại.</span></div>;
  if (resource.state === "offline") return <div className="s19-state" role="alert"><strong>Đang ngoại tuyến</strong><span>Thay đổi chăm sóc không được xếp hàng khi mất mạng.</span><button className="s19-button s19-button-secondary" onClick={() => void resource.load()}>Thử lại</button></div>;
  if (resource.state === "error") return <div className="s19-state s19-state-danger" role="alert"><strong>Không thể tải {label}</strong><span>{resource.error || "Máy chủ chưa trả về dữ liệu phù hợp."}</span><button className="s19-button s19-button-secondary" onClick={() => void resource.load()}>Thử lại</button></div>;
  if (resource.state === "empty") return <div className="s19-state" role="status"><strong>Chưa có {label}</strong><span>Chưa có dữ liệu trong phạm vi chi nhánh và salon hiện tại.</span><button className="s19-button s19-button-secondary" onClick={() => void resource.load()}>Làm mới</button></div>;
  return null;
}

export function Notice({ mutation }: { mutation: ReturnType<typeof useBenefitMutation> }) {
  if (!mutation.message) return null;
  return <div className={mutation.state === "error" ? "s19-notice s19-notice-danger" : "s19-notice s19-notice-success"} role={mutation.state === "error" ? "alert" : "status"}>{mutation.message}</div>;
}

function safeTableValue(value: any, key: string) {
  if (value == null || value === "") return "-";
  const text = String(value);
  if (/(^|id|uuid)$/i.test(key) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(text)) return "Mã tham chiếu được bảo vệ";
  if (/(at|date|time)$/i.test(key) && !Number.isNaN(new Date(text).getTime())) return formatDate(text);
  return /^[A-Z][A-Z0-9_]+$/.test(text) ? statusLabel(text) : text;
}

export function SafeTable({ data, columns }: { data: any[]; columns: Array<{ key: string; label: string; render?: (row: any) => React.ReactNode }> }) {
  if (!data.length) return <p className="s19-helper">Chưa có dữ liệu phù hợp.</p>;
  return <div className="s19-benefit-table-wrap"><table className="s19-benefit-table"><thead><tr>{columns.map((column) => <th scope="col" key={column.key}>{column.label}</th>)}</tr></thead><tbody>{data.map((row, index) => <tr key={row.id ?? `${row.reference ?? "row"}-${index}`}>{columns.map((column) => <td data-label={column.label} key={column.key}>{column.render ? column.render(row) : safeTableValue(row[column.key], column.key)}</td>)}</tr>)}</tbody></table></div>;
}

export function VersionActions({ mutation, version, actions, onAction }: { mutation: ReturnType<typeof useBenefitMutation>; version?: number; actions: string[]; onAction: (action: string) => void }) {
  const labels: Record<string, string> = { activate: "Kích hoạt", deactivate: "Tắt", pause: "Tạm dừng", resume: "Tiếp tục", cancel: "Hủy", hide: "Ẩn", flag: "Đánh dấu", triage: "Phân loại", start: "Bắt đầu", "wait-customer": "Chờ khách", resolve: "Xử lý xong", close: "Đóng", approve: "Phê duyệt", reject: "Từ chối" };
  return <div className="s19-inline-actions">{actions.map((action) => <button className={action === "cancel" || action === "hide" || action === "flag" || action === "reject" ? "s19-button s19-button-danger s19-button-small" : "s19-button s19-button-secondary s19-button-small"} type="button" disabled={mutation.state === "submitting" || version == null} key={action} onClick={() => onAction(action)}>{labels[action] ?? action.replaceAll("-", " ")}</button>)}</div>;
}

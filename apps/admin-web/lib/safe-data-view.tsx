"use client";

import type { ReactNode } from "react";

export type SafeDataColumn = {
  key: string;
  label: string;
};

const keyLabels: Record<string, string> = {
  id: "Mã tham chiếu",
  status: "Trạng thái",
  version: "Phiên bản",
  createdAt: "Ngày tạo",
  updatedAt: "Cập nhật lúc",
  occurredAt: "Thời điểm",
  branchId: "Chi nhánh",
  customerId: "Khách hàng",
  userId: "Người dùng",
  displayName: "Tên hiển thị",
  legalName: "Tên pháp lý",
  employeeCode: "Mã nhân sự",
  currency: "Tiền tệ",
  amountMinor: "Số tiền",
  totalMinor: "Tổng tiền",
  balanceMinor: "Số dư",
  versionNumber: "Phiên bản",
  startAt: "Bắt đầu",
  endAt: "Kết thúc",
  scheduledAt: "Lịch xử lý",
  approvedAt: "Ngày phê duyệt",
  postedAt: "Ngày ghi sổ",
  description: "Mô tả",
  reason: "Lý do",
  reference: "Tham chiếu",
};

const valueLabels: Record<string, string> = {
  ACTIVE: "Đang hoạt động",
  INACTIVE: "Không hoạt động",
  ENABLED: "Đã bật",
  DISABLED: "Đã tắt",
  PENDING: "Đang chờ",
  PENDING_APPROVAL: "Chờ phê duyệt",
  APPROVED: "Đã phê duyệt",
  SUBMITTED: "Đã gửi",
  POSTED: "Đã ghi sổ",
  COMPLETED: "Đã hoàn tất",
  CANCELLED: "Đã hủy",
  FAILED: "Thất bại",
  REJECTED: "Đã từ chối",
  DRAFT: "Bản nháp",
  OPEN: "Đang mở",
  CLOSED: "Đã đóng",
  VERIFIED: "Đã xác minh",
  FULL_TIME: "Toàn thời gian",
  PART_TIME: "Bán thời gian",
  CONTRACTOR: "Cộng tác viên",
  TEMPORARY: "Tạm thời",
};

export function safeLabel(key: string) {
  return keyLabels[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase());
}

export function safeValue(value: unknown, key?: string): ReactNode {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (Array.isArray(value)) return value.length ? `${value.length} mục` : "Không có";
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const localized = object["vi-VN"] ?? object["en-US"];
    if (typeof localized === "string") return localized;
    if (typeof object.displayName === "string") return object.displayName;
    if (typeof object.name === "string") return object.name;
    if (typeof object.code === "string") return object.code;
    if (typeof object.id === "string") return `#${object.id.slice(0, 8)}`;
    return "Đã có dữ liệu";
  }
  if (typeof value === "string" && valueLabels[value]) return valueLabels[value];
  if (key === "id" && typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)) return `#${value.slice(0, 8)}`;
  if (key && /(At|Date|Time)$/.test(key) && typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
  }
  return String(value);
}

export function safeColumns(rows: unknown[], columns?: SafeDataColumn[]) {
  if (columns?.length) return columns;
  const first = rows.find((row) => row && typeof row === "object") as Record<string, unknown> | undefined;
  if (!first) return [];
  return Object.keys(first)
    .filter((key) => !["payload", "metadata", "raw", "details", "policy"].includes(key))
    .slice(0, 6)
    .map((key) => ({ key, label: safeLabel(key) }));
}

export function SafeDataTable({
  rows,
  columns,
  caption,
  empty = "Chưa có dữ liệu.",
  renderCell,
}: {
  rows: Array<Record<string, unknown>>;
  columns?: SafeDataColumn[];
  caption: string;
  empty?: string;
  renderCell?: (value: unknown, row: Record<string, unknown>, column: SafeDataColumn) => ReactNode;
}) {
  const resolvedColumns = safeColumns(rows, columns);
  if (!resolvedColumns.length) return <p className="ns-safe-empty">{empty}</p>;
  return <div className="ns-safe-table-wrap">
    <table className="ns-safe-table">
      <caption className="sr-only">{caption}</caption>
      <thead><tr>{resolvedColumns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => {
        const key = String(row?.id ?? row?.reference ?? row?.code ?? index);
        return <tr key={key}>{resolvedColumns.map((column) => { const custom = renderCell?.(row?.[column.key], row, column); return <td key={column.key} data-label={column.label}>{custom ?? safeValue(row?.[column.key], column.key)}</td>; })}</tr>;
      })}</tbody>
    </table>
  </div>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { authorizedFetch } from "./auth";
import { SafeDataTable, safeLabel } from "./safe-data-view";

type State = "loading" | "ready" | "empty" | "error" | "forbidden";
const views: Record<string, { title: string; endpoint: string }> = {
  "/admin/assets": { title: "Sổ tài sản cố định", endpoint: "/v1/assets" },
  "/admin/assets/candidates": { title: "Tài sản chờ xác nhận", endpoint: "/v1/assets/candidates" },
  "/admin/assets/capitalization": { title: "Phê duyệt ghi tăng", endpoint: "/v1/assets/capitalization-requests" },
  "/admin/assets/depreciation": { title: "Kỳ khấu hao", endpoint: "/v1/assets/depreciation-runs" },
  "/admin/assets/maintenance": { title: "Lệnh bảo trì", endpoint: "/v1/assets/maintenance-work-orders" },
  "/admin/assets/transfers": { title: "Điều chuyển tài sản", endpoint: "/v1/assets/transfers" },
  "/admin/assets/counts": { title: "Kiểm kê tài sản", endpoint: "/v1/assets/count-sessions" },
  "/admin/assets/inspections": { title: "Kiểm tra tài sản", endpoint: "/v1/assets/inspections" },
  "/admin/assets/impairments": { title: "Suy giảm tài sản", endpoint: "/v1/assets/impairments" },
  "/admin/assets/disposals": { title: "Thanh lý tài sản", endpoint: "/v1/assets/disposals" },
  "/admin/assets/reports": { title: "Báo cáo tài sản", endpoint: "/v1/assets/reports/register" },
};

async function read(path: string) {
  const response = await authorizedFetch(path);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) throw Object.assign(new Error("Bạn không có quyền xem phạm vi tài sản này."), { forbidden: true });
  if (!response.ok) throw new Error(body.error?.message ?? "Không thể tải dữ liệu tài sản.");
  return body.data;
}

function listOf(value: any): any[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

export default function Sprint16Screen() {
  const pathname = usePathname();
  const view = views[pathname] ?? views["/admin/assets"]!;
  const [state, setState] = useState<State>("loading");
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const nextRows = listOf(await read(view.endpoint));
      setRows(nextRows);
      setState(nextRows.length ? "ready" : "empty");
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể tải dữ liệu tài sản.");
      setState(cause?.forbidden ? "forbidden" : "error");
    }
  }, [view.endpoint]);
  useEffect(() => { void load(); }, [load]);

  const columns = useMemo(() => Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
    .filter((key) => !key.toLowerCase().includes("json"))
    .slice(0, 8)
    .map((key) => ({ key, label: safeLabel(key) })), [rows]);

  return <main className="ns-data-workspace">
    <header className="ns-page-header"><div><p className="eyebrow">TÀI SẢN CỐ ĐỊNH</p><h1>{view.title}</h1><p className="hint">Theo dõi tài sản theo chi nhánh, trạng thái phê duyệt và bằng chứng bất biến.</p></div><button className="ns-button ns-button--secondary" onClick={() => void load()}>Làm mới</button></header>
    {state === "loading" && <div className="ns-state" role="status" aria-busy="true"><strong>Đang tải dữ liệu tài sản…</strong><span>Đang đồng bộ từ máy chủ.</span></div>}
    {state === "forbidden" && <div className="ns-state ns-state--danger" role="alert"><strong>Không có quyền truy cập</strong><span>Vai trò hoặc phạm vi chi nhánh hiện tại không cho phép xem màn hình này.</span></div>}
    {state === "error" && <div className="ns-state ns-state--danger" role="alert"><strong>Không thể tải dữ liệu</strong><span>{error}</span><button className="ns-button ns-button--secondary" onClick={() => void load()}>Thử lại</button></div>}
    {state === "empty" && <div className="ns-empty-state"><strong>Chưa có dữ liệu tài sản</strong><span>Hệ thống chưa ghi nhận bản ghi phù hợp với phạm vi hiện tại.</span><button className="ns-button ns-button--secondary" onClick={() => void load()}>Kiểm tra lại</button></div>}
    {state === "ready" && <section className="ns-data-card"><div className="ns-section-heading"><div><p className="eyebrow">SỔ TÀI SẢN</p><h2>{rows.length} bản ghi</h2></div><span className="ns-chip">Dữ liệu theo phạm vi</span></div><SafeDataTable rows={rows} columns={columns} caption={`Danh sách ${view.title}`} /></section>}
    <aside className="ns-data-card ns-data-card--muted"><p className="eyebrow">NGUYÊN TẮC</p><h2>Tài sản cần có bằng chứng trước khi ghi nhận</h2><p>Các thao tác phê duyệt, khấu hao, điều chuyển và thanh lý được xử lý bởi quy trình máy chủ; giao diện không tự tính hoặc sửa số liệu.</p></aside>
  </main>;
}

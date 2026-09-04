/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { authorizedFetch } from "./auth";
import { SafeDataTable, safeLabel } from "./safe-data-view";

type State = "loading" | "ready" | "empty" | "error" | "forbidden";
type View = { title: string; endpoint: string; hint: string; actions?: string[] };

const views: Record<string, View> = {
  "/admin/accounting": { title: "Trung tâm kiểm soát kế toán", endpoint: "/v1/accounting/books", hint: "Theo dõi sổ kế toán, kỳ mở và trạng thái sẵn sàng của dữ liệu tài chính." },
  "/admin/accounting/books": { title: "Sổ kế toán", endpoint: "/v1/accounting/books", hint: "Kích hoạt sổ chỉ được phép khi kỳ kế toán và checklist đã sẵn sàng." },
  "/admin/accounting/periods": { title: "Kỳ kế toán", endpoint: "/v1/accounting/periods", hint: "Đóng hoặc mở lại kỳ kế toán qua lệnh có bằng chứng và phân quyền rõ ràng." },
  "/admin/accounting/journals": { title: "Sổ nhật ký", endpoint: "/v1/accounting/journals", hint: "Gửi, phê duyệt, ghi sổ và đảo bút toán theo từng bước kiểm soát.", actions: ["submit", "approve", "post", "request-reversal"] },
  "/admin/accounting/posting-candidates": { title: "Hàng đợi ghi sổ", endpoint: "/v1/accounting/posting-candidates", hint: "Sự kiện nguồn được ánh xạ và worker xử lý trước khi ghi sổ." },
  "/admin/accounting/reports": { title: "Báo cáo tài chính", endpoint: "/v1/accounting/reports", hint: "Báo cáo chỉ đọc các nhật ký đã ghi sổ trong quyển được chọn." },
  "/admin/accounting/open-items": { title: "Khoản mục đang mở", endpoint: "/v1/accounting/open-items", hint: "Đối soát thanh toán phải cùng quyển, cùng tiền tệ và có nhật ký đã ghi sổ." },
  "/admin/accounting/reconciliation": { title: "Đối soát ngân hàng", endpoint: "/v1/accounting/bank-accounts", hint: "Bản kê và kết quả đối soát được lưu thành bằng chứng bất biến." },
};

const actionLabels: Record<string, string> = {
  submit: "Gửi phê duyệt",
  approve: "Phê duyệt",
  post: "Ghi sổ",
  "request-reversal": "Yêu cầu đảo bút toán",
};

async function read(path: string) {
  const response = await authorizedFetch(path);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) throw Object.assign(new Error("Bạn không có quyền xem phạm vi kế toán này."), { forbidden: true });
  if (!response.ok) throw new Error(body.error?.message ?? "Không thể tải dữ liệu kế toán.");
  return body.data;
}

function listOf(value: any): any[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

export default function Sprint14Screen() {
  const pathname = usePathname();
  const view = views[pathname] ?? views["/admin/accounting"]!;
  const [state, setState] = useState<State>("loading");
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const nextRows = listOf(await read(view.endpoint));
      setRows(nextRows);
      setState(nextRows.length ? "ready" : "empty");
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể tải dữ liệu kế toán.");
      setState(cause?.forbidden ? "forbidden" : "error");
    }
  }, [view.endpoint]);

  useEffect(() => { void load(); }, [load]);

  const columns = useMemo(() => Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
    .filter((key) => !key.toLowerCase().includes("json"))
    .slice(0, 8)
    .map((key) => ({ key, label: safeLabel(key) })), [rows]);

  function runAction(action: string, row: any) {
    setNotice(`${actionLabels[action] ?? action} sẽ được thực hiện qua quy trình kiểm soát của bản ghi ${row?.id ? `#${String(row.id).slice(0, 8)}` : "đã chọn"}.`);
  }

  return <main className="ns-data-workspace">
    <header className="ns-page-header">
      <div><p className="eyebrow">TÀI CHÍNH &amp; KẾ TOÁN</p><h1>{view.title}</h1><p className="hint">{view.hint}</p></div>
      <button className="ns-button ns-button--secondary" onClick={() => void load()}>Làm mới</button>
    </header>
    {notice && <p className="ns-inline-notice" role="status">{notice}</p>}
    {state === "loading" && <div className="ns-state" role="status" aria-busy="true"><strong>Đang tải dữ liệu kế toán…</strong><span>Đang đồng bộ từ máy chủ.</span></div>}
    {state === "forbidden" && <div className="ns-state ns-state--danger" role="alert"><strong>Không có quyền truy cập</strong><span>Vai trò hoặc phạm vi chi nhánh hiện tại không cho phép xem màn hình này.</span></div>}
    {state === "error" && <div className="ns-state ns-state--danger" role="alert"><strong>Không thể tải dữ liệu</strong><span>{error}</span><button className="ns-button ns-button--secondary" onClick={() => void load()}>Thử lại</button></div>}
    {state === "empty" && <div className="ns-empty-state"><strong>Chưa có dữ liệu</strong><span>Hệ thống chưa ghi nhận bản ghi phù hợp với phạm vi hiện tại.</span><button className="ns-button ns-button--secondary" onClick={() => void load()}>Kiểm tra lại</button></div>}
    {state === "ready" && <section className="ns-data-card"><div className="ns-section-heading"><div><p className="eyebrow">DỮ LIỆU NGUỒN</p><h2>{rows.length} bản ghi trong phạm vi hiện tại</h2></div><span className="ns-chip">Chỉ đọc theo phân quyền</span></div><SafeDataTable rows={rows} columns={columns} caption={`Danh sách ${view.title}`} />{view.actions?.length ? <div className="ns-action-row">{rows.slice(0, 1).flatMap((row) => view.actions!.map((action) => <button key={action} className="ns-button ns-button--secondary" onClick={() => runAction(action, row)}>{actionLabels[action] ?? action}</button>))}</div> : null}</section>}
    <aside className="ns-data-card ns-data-card--muted"><p className="eyebrow">KIỂM SOÁT TÀI CHÍNH</p><h2>Nhật ký đã ghi sổ không thể chỉnh sửa</h2><p>Mọi thao tác thay đổi đi qua quy trình được phân quyền, kiểm tra phiên bản và lưu bằng chứng audit/outbox.</p></aside>
  </main>;
}

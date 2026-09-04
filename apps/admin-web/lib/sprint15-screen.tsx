/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { authorizedFetch, getAuthorizedBranchContext, setActiveBranchId } from "./auth";
import { SafeDataTable, safeLabel } from "./safe-data-view";

type State = "loading" | "ready" | "empty" | "error" | "forbidden";
type View = { title: string; endpoint: string; hint: string; create?: "vendor" | "request" };

const views: Record<string, View> = {
  "/admin/procurement": { title: "Trung tâm mua hàng", endpoint: "/v1/procurement/vendors", hint: "Theo dõi nhà cung cấp, yêu cầu mua và bằng chứng phê duyệt." },
  "/admin/procurement/vendors": { title: "Nhà cung cấp", endpoint: "/v1/procurement/vendors", hint: "Tham chiếu thanh toán được bảo vệ; nhà cung cấp tạm giữ không nhận khoản chi mới.", create: "vendor" },
  "/admin/procurement/purchase-requests": { title: "Yêu cầu mua hàng", endpoint: "/v1/procurement/purchase-requests", hint: "Số lượng yêu cầu cần được gửi và phê duyệt độc lập.", create: "request" },
  "/admin/procurement/purchase-orders": { title: "Đơn mua hàng", endpoint: "/v1/procurement/purchase-orders", hint: "Số đơn do máy chủ cấp; bản ghi đã phê duyệt không thể sửa." },
  "/admin/procurement/receipts": { title: "Nhập hàng & dịch vụ", endpoint: "/v1/procurement/receipts", hint: "Nhập từng phần và hạn mức chênh lệch được kiểm soát ở máy chủ." },
  "/admin/procurement/vendor-bills": { title: "Hóa đơn nhà cung cấp", endpoint: "/v1/procurement/vendor-bills", hint: "Kiểm tra hóa đơn trùng và đối chiếu ba bên trước khi ghi nhận." },
  "/admin/procurement/ap": { title: "Công nợ phải trả", endpoint: "/v1/procurement/ap/open-items", hint: "Tuổi nợ, khoản giữ và số còn phải trả lấy từ phân bổ thực tế." },
  "/admin/procurement/payment-proposals": { title: "Đề xuất thanh toán", endpoint: "/v1/procurement/payment-proposals", hint: "Giữ số tiền khoản mở trước khi phê duyệt kép." },
  "/admin/procurement/vendor-payments": { title: "Thanh toán nhà cung cấp", endpoint: "/v1/procurement/vendor-payments", hint: "Worker xử lý nhà cung cấp; kết quả chưa xác định cần được đối soát." },
  "/admin/procurement/credit-notes": { title: "Credit note nhà cung cấp", endpoint: "/v1/procurement/vendor-credit-notes", hint: "Kiểm tra đúng dòng hóa đơn và giới hạn cộng dồn." },
  "/admin/procurement/returns": { title: "Trả hàng nhà cung cấp", endpoint: "/v1/procurement/vendor-returns", hint: "Số lượng trả không vượt quá số lượng đã nhận." },
};

async function read(path: string) {
  const response = await authorizedFetch(path);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) throw Object.assign(new Error("Bạn không có quyền xem phạm vi mua hàng này."), { forbidden: true });
  if (!response.ok) throw new Error(body.error?.message ?? "Không thể hoàn tất yêu cầu.");
  return body.data;
}

function listOf(value: any): any[] { return Array.isArray(value) ? value : value ? [value] : []; }

export default function Sprint15Screen() {
  const pathname = usePathname();
  const view = views[pathname] ?? views["/admin/procurement"]!;
  const [state, setState] = useState<State>("loading");
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});
  const [branchId, setBranchId] = useState<string | undefined>();
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [branchLoading, setBranchLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void getAuthorizedBranchContext().then(({ branches: authorizedBranches, branchId: selected }) => {
      if (cancelled) return;
      setBranches(authorizedBranches);
      setBranchId(selected);
      setBranchLoading(false);
    }).catch(() => { if (!cancelled) setBranchLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const nextRows = listOf(await read(view.endpoint));
      setRows(nextRows);
      setState(nextRows.length ? "ready" : "empty");
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể tải dữ liệu mua hàng.");
      setState(cause?.forbidden ? "forbidden" : "error");
    }
  }, [view.endpoint]);
  useEffect(() => { void load(); }, [load]);

  const columns = useMemo(() => Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
    .filter((key) => !key.toLowerCase().includes("json"))
    .slice(0, 8)
    .map((key) => ({ key, label: safeLabel(key) })), [rows]);
  const fields: Array<[string, string]> = view.create === "vendor"
    ? [["code", "Mã nhà cung cấp"], ["displayName", "Tên hiển thị"], ["legalName", "Tên pháp lý"], ["currency", "Tiền tệ"], ["paymentTermsDays", "Số ngày thanh toán"]]
    : [["description", "Nội dung yêu cầu"], ["quantity", "Số lượng"], ["unitPriceMinor", "Đơn giá (đơn vị nhỏ nhất)"], ["currency", "Tiền tệ"], ["reason", "Lý do"]];

  async function create() {
    if (view.create === "request" && !branchId) { setError("Hãy chọn một chi nhánh được cấp quyền trước khi tạo yêu cầu mua hàng."); return; }
    const payload = view.create === "vendor"
      ? { code: form.code, displayName: form.displayName, legalName: form.legalName || form.displayName, currency: form.currency || "VND", paymentTermsDays: Number(form.paymentTermsDays || 0) }
      : { branchId, currency: form.currency || "VND", reason: form.reason || "Nhu cầu vận hành", lines: [{ description: form.description || "Hạng mục mua hàng", quantity: form.quantity || "1", unitPriceMinor: form.unitPriceMinor || "0" }] };
    const response = await authorizedFetch(view.endpoint, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setError(body.error?.code === "VERSION_CONFLICT" ? "Dữ liệu vừa thay đổi. Hãy tải lại trước khi thử lại." : (body.error?.message ?? "Dữ liệu không hợp lệ.")); return; }
    setNotice("Đã lưu và tải lại dữ liệu từ máy chủ.");
    setForm({});
    await load();
  }

  async function action(row: any, command: string) {
    const response = await authorizedFetch(`${view.endpoint}/${row.id}/${command}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ version: row.version, reason: `Được xác nhận trong màn hình ${view.title}.` }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error?.code === "VERSION_CONFLICT" ? "Dữ liệu vừa thay đổi. Hãy tải lại trước khi thử lại." : (body.error?.message ?? "Không thể thực hiện thao tác."));
    else { setNotice(command === "approve" ? "Đã phê duyệt." : "Đã gửi lệnh xử lý."); setError(""); await load(); }
  }

  return <main className="ns-data-workspace">
    <header className="ns-page-header"><div><p className="eyebrow">MUA HÀNG &amp; CÔNG NỢ</p><h1>{view.title}</h1><p className="hint">{view.hint}</p></div><button className="ns-button ns-button--secondary" onClick={() => void load()}>Làm mới</button></header>
    {branchLoading && <p className="ns-inline-notice" role="status" aria-busy="true">Đang tải chi nhánh được cấp quyền…</p>}
    {!branchLoading && branches.length > 1 && <label className="ns-filter-field"><span>Chi nhánh thao tác</span><select value={branchId ?? ""} onChange={(event) => { const next = event.target.value || undefined; setBranchId(next); setActiveBranchId(next); }}><option value="">Chọn chi nhánh</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
    {notice && <p className="ns-inline-notice" role="status">{notice}</p>}
    {state === "loading" && <div className="ns-state" role="status" aria-busy="true"><strong>Đang tải dữ liệu mua hàng…</strong><span>Đang đồng bộ từ máy chủ.</span></div>}
    {state === "forbidden" && <div className="ns-state ns-state--danger" role="alert"><strong>Không có quyền truy cập</strong><span>Vai trò hoặc phạm vi chi nhánh hiện tại không cho phép xem màn hình này.</span></div>}
    {state === "error" && <div className="ns-state ns-state--danger" role="alert"><strong>Không thể tải dữ liệu</strong><span>{error}</span><button className="ns-button ns-button--secondary" onClick={() => void load()}>Thử lại</button></div>}
    {state === "empty" && <div className="ns-empty-state"><strong>Chưa có dữ liệu</strong><span>Hệ thống chưa ghi nhận bản ghi phù hợp với phạm vi hiện tại.</span><button className="ns-button ns-button--secondary" onClick={() => void load()}>Kiểm tra lại</button></div>}
    {state === "ready" && <section className="ns-data-card"><div className="ns-section-heading"><div><p className="eyebrow">DỮ LIỆU NGUỒN</p><h2>{rows.length} bản ghi</h2></div><span className="ns-chip">Theo phạm vi chi nhánh</span></div><SafeDataTable rows={rows} columns={columns} caption={`Danh sách ${view.title}`} renderCell={(value) => value === "SUBMITTED" || value === "PENDING_APPROVAL" ? <span className="ns-status ns-status--warning">{value === "SUBMITTED" ? "Chờ phê duyệt" : "Đang chờ"}</span> : undefined} />{rows.slice(0, 1).map((row) => <div className="ns-action-row" key={row.id}>{row.status === "SUBMITTED" && pathname === "/admin/procurement/purchase-requests" && <button className="ns-button ns-button--secondary" onClick={() => void action(row, "approve")}>Phê duyệt</button>}{row.status === "PENDING_APPROVAL" && pathname === "/admin/procurement/vendor-payments" && <button className="ns-button ns-button--secondary" onClick={() => void action(row, "approve")}>Phê duyệt</button>}{row.status === "APPROVED" && pathname === "/admin/procurement/vendor-payments" && <button className="ns-button ns-button--secondary" onClick={() => void action(row, "process")}>Đưa vào xử lý</button>}</div>)}</section>}
    {view.create && <section className="ns-data-card"><div className="ns-section-heading"><div><p className="eyebrow">TẠO BẢN GHI</p><h2>{view.create === "vendor" ? "Thêm nhà cung cấp" : "Tạo yêu cầu mua hàng"}</h2></div></div><div className="ns-form-grid">{fields.map(([name, label]) => <label className="ns-filter-field" key={name}><span>{label}</span><input value={form[name] ?? ""} onChange={(event) => setForm({ ...form, [name]: event.target.value })} required={name === "code" || name === "displayName" || name === "description"} /></label>)}</div><button className="ns-button ns-button--primary" onClick={() => void create()}>Lưu bản ghi</button></section>}
    <aside className="ns-data-card ns-data-card--muted"><p className="eyebrow">KIỂM SOÁT</p><h2>Luôn kiểm tra bằng chứng trước khi chi</h2><p>Mọi lệnh đều được giới hạn theo tenant/chi nhánh, có idempotency key, kiểm tra phiên bản, audit và outbox. Gọi nhà cung cấp nằm ngoài transaction cơ sở dữ liệu.</p></aside>
  </main>;
}

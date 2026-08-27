/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { authorizedFetch, getAuthorizedBranchContext, setActiveBranchId } from "./auth";

type AsyncState = "loading" | "ready" | "empty" | "error" | "forbidden";
type Branch = { id: string; name: string };
type ProcurementView = { title: string; endpoint: string; kind: string; description: string; create?: "vendor" | "request" };

const views: Record<string, ProcurementView> = {
  "/admin/procurement": { title: "Procurement control center", endpoint: "/v1/procurement/vendors", kind: "vendors", description: "One workspace for supplier, purchasing, AP and payment controls." },
  "/admin/procurement/vendors": { title: "Vendors", endpoint: "/v1/procurement/vendors", kind: "vendors", description: "Supplier directory with masked payment references and lifecycle controls.", create: "vendor" },
  "/admin/procurement/purchase-requests": { title: "Purchase requests", endpoint: "/v1/procurement/purchase-requests", kind: "requests", description: "Request spend with branch context, version checks and independent approval.", create: "request" },
  "/admin/procurement/purchase-orders": { title: "Purchase orders", endpoint: "/v1/procurement/purchase-orders", kind: "orders", description: "Server-numbered orders remain immutable after approval." },
  "/admin/procurement/receipts": { title: "Goods and service receipts", endpoint: "/v1/procurement/receipts", kind: "receipts", description: "Partial receipt and tolerance caps are enforced by the API." },
  "/admin/procurement/vendor-bills": { title: "Vendor bills", endpoint: "/v1/procurement/vendor-bills", kind: "bills", description: "Duplicate invoice and three-way match safeguards remain server-authoritative." },
  "/admin/procurement/ap": { title: "Accounts payable", endpoint: "/v1/procurement/ap/open-items", kind: "ap", description: "Open balances and holds are derived from AP allocations." },
  "/admin/procurement/payment-proposals": { title: "Payment proposals", endpoint: "/v1/procurement/payment-proposals", kind: "proposals", description: "Reserve open-item amounts before dual-control payment approval." },
  "/admin/procurement/vendor-payments": { title: "Vendor payments", endpoint: "/v1/procurement/vendor-payments", kind: "payments", description: "Worker-owned provider processing and reconciliation evidence." },
  "/admin/procurement/credit-notes": { title: "Vendor credit notes", endpoint: "/v1/procurement/vendor-credit-notes", kind: "credits", description: "Exact bill-line eligibility and cumulative caps protect AP." },
  "/admin/procurement/returns": { title: "Vendor returns", endpoint: "/v1/procurement/vendor-returns", kind: "returns", description: "Return quantities and branch scope are checked by the existing workflow." },
};

const columns: Record<string, string[]> = {
  vendors: ["code", "displayName", "currency", "status", "version"],
  requests: ["requestNumber", "branchId", "currency", "requestedTotalMinor", "status", "version"],
  orders: ["poNumber", "branchId", "vendorId", "currency", "totalMinor", "status", "version"],
  receipts: ["receiptNumber", "branchId", "status", "version", "createdAt"],
  bills: ["billNumber", "branchId", "vendorName", "currency", "totalMinor", "status", "version"],
  ap: ["billNumber", "branchId", "vendorName", "outstandingMinor", "dueDate", "status"],
  proposals: ["proposalNumber", "branchId", "vendorName", "currency", "totalMinor", "status", "version"],
  payments: ["paymentReference", "branchId", "vendorName", "currency", "amountMinor", "status", "version"],
  credits: ["creditNoteNumber", "branchId", "vendorName", "currency", "amountMinor", "status", "version"],
  returns: ["branchId", "vendorName", "purchaseOrderNumber", "reason", "status", "version"],
};

export function isWave5ProcurementPath(pathname: string) {
  return Object.keys(views).some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function listOf(value: any): any[] { return Array.isArray(value) ? value : value == null ? [] : [value]; }
function procurementStatus(value: any) {
  const labels: Record<string, string> = { ACTIVE: "Đang hoạt động", INACTIVE: "Không hoạt động", DRAFT: "Bản nháp", SUBMITTED: "Đã gửi", PENDING_APPROVAL: "Chờ phê duyệt", APPROVED: "Đã phê duyệt", RECEIVED: "Đã nhận", MATCHED: "Đã khớp", OPEN: "Đang mở", HOLD: "Đang giữ", POSTED: "Đã ghi sổ", PAID: "Đã thanh toán", CANCELLED: "Đã hủy", COMPLETED: "Đã hoàn tất", FAILED: "Thất bại" };
  const raw = String(value ?? "").toUpperCase();
  return labels[raw] ?? String(value).replaceAll("_", " ");
}
function display(value: any, key = "", currency = "VND") {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (typeof value === "object") { const candidate = value.displayName ?? value.name ?? value.code; if (typeof candidate === "object") return candidate?.["vi-VN"] ?? candidate?.["en-US"] ?? Object.values(candidate ?? {})[0] ?? "—"; return candidate ?? "—"; }
  const normalized = key.replaceAll("_", " ").toLowerCase();
  if (normalized.endsWith(" id") || key === "id") return "Mã hệ thống";
  if (normalized === "status" || normalized === "state") return procurementStatus(value);
  if (normalized.includes("minor") || normalized === "amount") {
    try { return `${new Intl.NumberFormat("vi-VN").format(Number(value))} ${currency}`; } catch { return String(value); }
  }
  if (normalized.endsWith("at") || normalized.endsWith("date")) {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(date);
  }
  return String(value);
}
function procurementTitle(value: string) { const labels: Record<string, string> = { "Procurement control center": "Trung tâm kiểm soát mua hàng", Vendors: "Nhà cung cấp", "Purchase requests": "Đề nghị mua hàng", "Purchase orders": "Đơn mua hàng", "Goods and service receipts": "Phiếu nhận hàng & dịch vụ", "Vendor bills": "Hóa đơn nhà cung cấp", "Accounts payable": "Công nợ phải trả", "Payment proposals": "Đề xuất thanh toán", "Vendor payments": "Thanh toán nhà cung cấp", "Vendor credit notes": "Credit Note nhà cung cấp", "Vendor returns": "Trả hàng nhà cung cấp" }; return labels[value] ?? value; }
function procurementDescription(value: string) { const labels: Record<string, string> = { "One workspace for supplier, purchasing, AP and payment controls.": "Một không gian cho nhà cung cấp, mua hàng, công nợ phải trả và kiểm soát thanh toán.", "Supplier directory with masked payment references and lifecycle controls.": "Danh sách nhà cung cấp với tham chiếu thanh toán được che và kiểm soát vòng đời.", "Request spend with branch context, version checks and independent approval.": "Tạo đề nghị chi tiêu theo chi nhánh, kiểm tra phiên bản và phê duyệt độc lập.", "Server-numbered orders remain immutable after approval.": "Đơn mua hàng do máy chủ cấp số sẽ bất biến sau khi phê duyệt.", "Partial receipt and tolerance caps are enforced by the API.": "API kiểm soát nhận hàng từng phần và hạn mức dung sai.", "Duplicate invoice and three-way match safeguards remain server-authoritative.": "Kiểm soát hóa đơn trùng và đối chiếu ba bên do máy chủ quyết định.", "Open balances and holds are derived from AP allocations.": "Số dư mở và trạng thái giữ được suy ra từ phân bổ công nợ.", "Reserve open-item amounts before dual-control payment approval.": "Giữ số tiền khoản mở trước khi phê duyệt thanh toán theo kiểm soát kép.", "Worker-owned provider processing and reconciliation evidence.": "Worker xử lý nhà cung cấp và lưu bằng chứng đối soát.", "Exact bill-line eligibility and cumulative caps protect AP.": "Điều kiện theo dòng hóa đơn và hạn mức cộng dồn bảo vệ công nợ.", "Return quantities and branch scope are checked by the existing workflow.": "Quy trình hiện tại kiểm tra số lượng trả và phạm vi chi nhánh." }; return labels[value] ?? value; }
function procurementColumnTitle(value: string) { const labels: Record<string, string> = { code: "Mã", displayName: "Tên hiển thị", legalName: "Tên pháp lý", currency: "Tiền tệ", status: "Trạng thái", version: "Phiên bản", requestNumber: "Số đề nghị", branchId: "Chi nhánh", requestedTotalMinor: "Tổng đề nghị", poNumber: "Số đơn mua", vendorId: "Nhà cung cấp", totalMinor: "Tổng tiền", receiptNumber: "Số phiếu nhận", createdAt: "Ngày tạo", billNumber: "Số hóa đơn", vendorName: "Nhà cung cấp", outstandingMinor: "Còn phải trả", dueDate: "Hạn thanh toán", proposalNumber: "Số đề xuất", paymentReference: "Tham chiếu thanh toán", amountMinor: "Số tiền", creditNoteNumber: "Số Credit Note", purchaseOrderNumber: "Số đơn mua", reason: "Lý do" }; return labels[value] ?? value.replace(/[A-Z]/g, (letter) => ` ${letter}`).replace(/^./, (letter) => letter.toUpperCase()); }
function procurementActionLabel(value: string) { const labels: Record<string, string> = { submit: "Gửi duyệt", approve: "Phê duyệt", reject: "Từ chối", send: "Gửi nhà cung cấp", receive: "Tiếp nhận", accept: "Xác nhận", hold: "Giữ lại", "release-hold": "Bỏ giữ", process: "Xử lý", post: "Ghi sổ", apply: "Áp dụng", cancel: "Hủy", dispatch: "Điều phối", complete: "Hoàn tất" }; return labels[value] ?? value; }

async function read(path: string) {
  const response = await authorizedFetch(path);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) throw Object.assign(new Error("Bạn không có quyền xem phạm vi mua hàng này."), { forbidden: true });
  if (!response.ok) throw new Error(body.error?.message ?? "Không thể hoàn tất yêu cầu.");
  return body.data;
}

function actionFor(view: ProcurementView, row: any) {
  const version = row.version == null ? {} : { version: row.version };
  const transitions: Record<string, Array<[string, string, Record<string, unknown>]>> = {
    requests: [["DRAFT", "submit", version], ["SUBMITTED", "approve", { ...version, reason: "Approved in procurement workspace" }], ["SUBMITTED", "reject", { ...version, reason: "Rejected in procurement workspace" }]],
    orders: [["DRAFT", "submit", version], ["PENDING_APPROVAL", "approve", { ...version, reason: "Approved in procurement workspace" }], ["APPROVED", "send", version]],
    receipts: [["DRAFT", "receive", version], ["RECEIVED", "accept", version]],
    bills: [["MATCHED", "approve", version], ["APPROVED", "post", version]],
    ap: [["OPEN", "hold", { reason: "Held in AP workspace" }], ["HOLD", "release-hold", { reason: "Released in AP workspace" }]],
    proposals: [["DRAFT", "submit", version], ["PENDING_APPROVAL", "approve", { ...version, reason: "Approved in procurement workspace" }], ["DRAFT", "cancel", { ...version, reason: "Cancelled in procurement workspace" }]],
    payments: [["PENDING_APPROVAL", "approve", { ...version, reason: "Approved in procurement workspace" }], ["APPROVED", "process", version]],
    credits: [["DRAFT", "submit", version], ["SUBMITTED", "approve", { ...version, reason: "Approved in procurement workspace" }], ["APPROVED", "post", version], ["POSTED", "apply", version]],
    returns: [["DRAFT", "submit", version], ["PENDING_APPROVAL", "approve", { ...version, reason: "Approved in procurement workspace" }], ["APPROVED", "dispatch", version], ["DISPATCHED", "complete", version]],
  };
  return (transitions[view.kind] ?? []).filter(([status]) => status === row.status).map(([, command, body]) => ({ command, body }));
}

export default function Sprint19Wave5Procurement({ pathname }: { pathname: string }) {
  const route = Object.keys(views).sort((left, right) => right.length - left.length).find((key) => pathname === key || pathname.startsWith(`${key}/`)) ?? "/admin/procurement";
  const view = views[route]!;
  const [state, setState] = useState<AsyncState>("loading");
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [branchId, setBranchId] = useState<string | undefined>();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchLoading, setBranchLoading] = useState(true);
  const [form, setForm] = useState<Record<string, string>>({});
  const intentKeys = useRef<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void getAuthorizedBranchContext().then(({ branches: authorizedBranches, branchId: selected }) => {
      if (cancelled) return;
      setBranches(authorizedBranches);
      setBranchId(selected);
      setBranchLoading(false);
    }).catch((e: any) => { if (!cancelled) { setError(e.message); setState(e.forbidden ? "forbidden" : "error"); setBranchLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    setState("loading"); setError("");
    try { const value = listOf(await read(view.endpoint)); setRows(value); setState(value.length ? "ready" : "empty"); }
    catch (e: any) { setError(e.message); setState(e.forbidden ? "forbidden" : "error"); }
  }, [view.endpoint]);
  useEffect(() => { void load(); }, [load]);

  async function command(row: any, commandName: string, body: Record<string, unknown>) {
    if (!navigator.onLine) { setNotice("Cần có kết nối mạng. Thao tác mua hàng không được xếp hàng khi ngoại tuyến."); return; }
    setBusy(true); setError(""); setNotice("");
    const intent = `${row.id}:${commandName}`;
    const key = intentKeys.current[intent] ?? (intentKeys.current[intent] = crypto.randomUUID());
    try {
      const response = await authorizedFetch(`${view.endpoint}/${row.id}/${commandName}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error?.code === "VERSION_CONFLICT" ? "Bản ghi vừa thay đổi. Hãy tải lại trước khi thử lại." : (result.error?.message ?? "Không thể hoàn tất thao tác an toàn."));
      delete intentKeys.current[intent];
      setNotice(`Đã xác nhận thao tác “${procurementActionLabel(commandName)}” và làm mới dữ liệu.`); await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (view.create === "request" && !branchId) { setError("Chọn chi nhánh được cấp quyền trước khi tạo đề nghị mua hàng."); return; }
    const payload = view.create === "vendor"
      ? { code: form.code, displayName: form.displayName, legalName: form.legalName || form.displayName, currency: form.currency || "VND", paymentTermsDays: Number(form.paymentTermsDays || 0) }
      : { branchId, currency: form.currency || "VND", reason: form.reason || "Operational procurement", lines: [{ description: form.description || "Procurement item", quantity: form.quantity || "1", unitPriceMinor: form.unitPriceMinor || "0" }] };
    setBusy(true); setError("");
    const intent = "create";
    const key = intentKeys.current[intent] ?? (intentKeys.current[intent] = crypto.randomUUID());
    try {
      const response = await authorizedFetch(view.endpoint, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error?.message ?? "Validation failed.");
      delete intentKeys.current[intent];
      setNotice("Đã tạo sau khi máy chủ xác nhận."); setForm({}); await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  const visibleColumns = columns[view.kind] ?? [];
  const fields: Array<[string, string]> = view.create === "vendor"
    ? [["code", "Mã nhà cung cấp"], ["displayName", "Tên hiển thị"], ["legalName", "Tên pháp lý"], ["currency", "Tiền tệ"], ["paymentTermsDays", "Số ngày thanh toán"]]
    : [["description", "Nội dung mua hàng"], ["quantity", "Số lượng"], ["unitPriceMinor", "Đơn giá (VND)"], ["currency", "Tiền tệ"], ["reason", "Lý do"]];

  return <main className="shell ops-shell">
    <section className="card">
      <p className="eyebrow">NailSoft · MUA HÀNG</p>
      <div className="title-row"><div><h1>{procurementTitle(view.title)}</h1><p className="hint">{procurementDescription(view.description)}</p></div><button onClick={() => void load()} disabled={state === "loading"}>Làm mới</button></div>
      {branchLoading && <p role="status" aria-busy="true">Đang tải chi nhánh được cấp quyền…</p>}
      {!branchLoading && branches.length > 1 && <label>Chi nhánh đang làm việc<select aria-label="Chi nhánh đang làm việc" value={branchId ?? ""} onChange={(event) => { const next = event.target.value || undefined; setBranchId(next); setActiveBranchId(next); }}><option value="">Chọn chi nhánh được cấp quyền</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
      {notice && <p role="status" className="notice">{notice}</p>}
      {state === "loading" && <p role="status" aria-busy="true">Đang tải dữ liệu mua hàng…</p>}
      {state === "forbidden" && <div role="alert" className="state"><h2>Không có quyền truy cập</h2><p>Vai trò hoặc phạm vi chi nhánh hiện tại không cho phép xem khu vực này.</p><button onClick={() => void load()}>Thử lại</button></div>}
      {state === "error" && <div role="alert" className="state"><h2>Không thể tải dữ liệu mua hàng</h2><p>{error}</p><button onClick={() => void load()}>Thử lại</button></div>}
      {state === "empty" && <div className="state"><h2>Chưa có bản ghi</h2><p>Chưa có dữ liệu trong phạm vi được cấp quyền.</p><button onClick={() => void load()}>Thử lại</button></div>}
      {error && state !== "error" && <p role="alert">{error}</p>}
      {state === "ready" && <div className="table-wrap"><table><thead><tr>{visibleColumns.map((column) => <th key={column}>{procurementColumnTitle(column)}</th>)}<th>Thao tác</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id ?? index}>{visibleColumns.map((column) => <td key={column} data-label={procurementColumnTitle(column)}>{display(row[column], column, row.currency ?? "VND")}</td>)}<td>{actionFor(view, row).map((action) => <button key={action.command} disabled={busy} onClick={() => void command(row, action.command, action.body)}>{procurementActionLabel(action.command)}</button>)}</td></tr>)}</tbody></table></div>}
    </section>
    {view.create && <section className="card"><h2>{view.create === "vendor" ? "Thêm nhà cung cấp" : "Tạo đề nghị mua hàng"}</h2>{view.create === "request" && !branchId && !branchLoading && <p role="alert">Chọn chi nhánh được cấp quyền trước khi gửi đề nghị.</p>}<form className="form-grid" onSubmit={(event) => void create(event)}>{fields.map(([name, label]) => <label key={name}>{procurementColumnTitle(label)}<input value={form[name] ?? ""} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} required={name === "code" || name === "displayName" || name === "description"} /></label>)}<button type="submit" disabled={busy || (view.create === "request" && !branchId)}>Tạo</button></form></section>}
    <aside className="card"><h2>Kiểm soát quy trình</h2><p>Thao tác dùng khóa idempotency, kiểm tra phiên bản, phân quyền tenant/chi nhánh, bằng chứng audit và outbox bền vững. Gọi nhà cung cấp do worker xử lý.</p></aside>
  </main>;
}

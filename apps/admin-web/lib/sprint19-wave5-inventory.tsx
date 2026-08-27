/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { io } from "socket.io-client";
import { activeSession, authorizedFetch, getAuthorizedBranchContext, setActiveBranchId } from "./auth";

type AsyncState = "loading" | "ready" | "empty" | "error" | "forbidden";
type Branch = { id: string; name: string };
type Screen = { title: string; endpoint: string; branchScoped?: boolean; kind: string; description: string };

const ACTIVE_BRANCH = "__ACTIVE_BRANCH__";
const screens: Record<string, Screen> = {
  "/admin/inventory": { title: "Inventory control center", endpoint: "/v1/inventory/stock?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "stock", description: "Server-authoritative on-hand, reserved and available quantities." },
  "/admin/inventory/items": { title: "Inventory items", endpoint: "/v1/inventory/items", kind: "items", description: "Manage active consumables and retail items without editing stock balances directly." },
  "/admin/inventory/locations": { title: "Stock locations", endpoint: "/v1/inventory/locations?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "locations", description: "Branch-scoped stock rooms and operational locations." },
  "/admin/inventory/stock": { title: "Stock availability", endpoint: "/v1/inventory/stock?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "stock", description: "Server-authoritative on-hand, reserved and available quantities." },
  "/admin/inventory/lots": { title: "Lot and expiry", endpoint: "/v1/inventory/lots?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "lots", description: "Traceable lot status and expiry visibility." },
  "/admin/inventory/alerts": { title: "Inventory alerts", endpoint: "/v1/inventory/alerts?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "alerts", description: "Review and acknowledge operational stock alerts." },
  "/admin/inventory/suppliers": { title: "Inventory suppliers", endpoint: "/v1/inventory/suppliers", kind: "suppliers", description: "Supplier directory used by inventory purchasing workflows." },
  "/admin/inventory/purchase-orders": { title: "Inventory purchase orders", endpoint: "/v1/inventory/purchase-orders?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "purchaseOrders", description: "Inventory purchase orders remain separate from Procurement purchase orders." },
  "/admin/inventory/receipts": { title: "Goods receipts", endpoint: "/v1/inventory/receipts?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "receipts", description: "Receive and post goods through the inventory receipt lifecycle." },
  "/admin/inventory/transfers": { title: "Stock transfers", endpoint: "/v1/inventory/transfers?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "transfers", description: "Request, approve, ship and receive stock across authorized branches." },
  "/admin/inventory/adjustments": { title: "Stock adjustments", endpoint: "/v1/inventory/adjustments?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "adjustments", description: "Review reasoned adjustments with version checks and approval." },
  "/admin/inventory/counts": { title: "Blind stock counts", endpoint: "/v1/inventory/counts?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "counts", description: "Count first, review variance later; expected stock stays hidden before review." },
  "/admin/inventory/service-recipes": { title: "Service material recipes", endpoint: "/v1/inventory/service-recipes?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "recipes", description: "Define branch-scoped service material consumption." },
  "/admin/inventory/reports": { title: "Inventory ledger", endpoint: "/v1/inventory/ledger?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "ledger", description: "Append-only inventory movement history." },
  "/admin/inventory/valuation": { title: "Inventory valuation", endpoint: "/v1/inventory/reports/valuation?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "valuation", description: "Cost and valuation data is permission-gated by the API." },
};

export function isWave5InventoryPath(pathname: string) {
  return Object.keys(screens).some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

async function read(path: string, init?: RequestInit) {
  const response = await authorizedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) throw Object.assign(new Error("Bạn không có quyền xem phạm vi kho này."), { forbidden: true });
  if (!response.ok) throw new Error(`${body.error?.code ?? "REQUEST_FAILED"}: ${body.error?.message ?? "Hãy thử lại an toàn."}`);
  return body.data;
}

function rowsOf(value: any): any[] { return Array.isArray(value) ? value : value == null ? [] : [value]; }
const INVENTORY_VALUE_LABELS: Record<string, string> = {
  ACTIVE: "Đang hoạt động", INACTIVE: "Không hoạt động", ARCHIVED: "Đã lưu trữ", OPEN: "Đang mở", ACKNOWLEDGED: "Đã xác nhận",
  DRAFT: "Bản nháp", SUBMITTED: "Đã gửi duyệt", APPROVED: "Đã phê duyệt", POSTED: "Đã ghi nhận", REQUESTED: "Đã yêu cầu",
  IN_TRANSIT: "Đang vận chuyển", RECEIVED: "Đã nhận", COUNTING: "Đang kiểm kê", REVIEW: "Đang rà soát", COMPLETED: "Đã hoàn tất",
  CONSUMABLE: "Vật tư tiêu hao", RETAIL: "Hàng bán lẻ", BOTH: "Vật tư và hàng bán", STOCKROOM: "Kho hàng", SHELF: "Kệ hàng",
  REFRIGERATED: "Kho mát", LOW_STOCK: "Sắp hết hàng", OUT_OF_STOCK: "Hết hàng", EXPIRING: "Sắp hết hạn", PHYSICAL_CORRECTION: "Điều chỉnh thực tế",
  RECEIPT: "Nhập hàng", ISSUE: "Xuất hàng", TRANSFER: "Điều chuyển", ADJUSTMENT: "Điều chỉnh",
};
function text(value: any, key = "") {
  if (value == null || value === "") return "—";
  const normalizedKey = key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").toLowerCase();
  if (key === "id" || key.endsWith("Id") || key.endsWith("ID") || normalizedKey.endsWith(" id") || normalizedKey.endsWith(" uuid")) return "Mã hệ thống";
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (typeof value === "object") { const candidate = value.displayName ?? value.name ?? value.code ?? value.sku; if (typeof candidate === "object") return candidate?.["vi-VN"] ?? candidate?.["en-US"] ?? Object.values(candidate ?? {})[0] ?? "Có dữ liệu"; return candidate ?? "Có dữ liệu"; }
  if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)) return "Mã hệ thống";
  const mapped = INVENTORY_VALUE_LABELS[String(value).toUpperCase()];
  if (mapped) return mapped;
  if (/(at|date|start|end|from|to|due)$/.test(normalizedKey) && !Number.isNaN(Date.parse(String(value)))) return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(value)));
  if (typeof value === "number") return new Intl.NumberFormat("vi-VN").format(value);
  return String(value);
}
function titleFor(key: string) { const labels: Record<string, string> = { id: "Mã bản ghi", sku: "Mã SKU", name: "Tên", onHand: "Tồn kho", reserved: "Đang giữ", available: "Khả dụng", expiryDate: "Ngày hết hạn", lotId: "Lô hàng", lotStatus: "Trạng thái lô", locationId: "Vị trí kho", sourceLocationId: "Vị trí nguồn", destinationLocationId: "Vị trí đích", locationType: "Loại vị trí", status: "Trạng thái", severity: "Mức độ", alertType: "Loại cảnh báo", createdAt: "Ngày tạo", code: "Mã", itemType: "Loại hàng", quantityPrecision: "Độ chính xác", poNumber: "Số đơn mua", currency: "Tiền tệ", totalMinor: "Tổng tiền", receiptNumber: "Số phiếu nhận", receivedAt: "Ngày nhận", transferNumber: "Số phiếu chuyển", sourceBranchId: "Chi nhánh nguồn", destinationBranchId: "Chi nhánh đích", reasonCode: "Lý do", quantityDelta: "Chênh lệch số lượng", blind: "Kiểm đếm mù", serviceId: "Dịch vụ", branchId: "Chi nhánh", entryType: "Loại biến động", occurredAt: "Thời gian", totalCostMinor: "Tổng giá vốn", generatedAt: "Thời điểm tạo" }; return labels[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (v) => v.toUpperCase()); }
function inventoryTitle(value: string) {
  const labels: Record<string, string> = {
    "Inventory control center": "Trung tâm kiểm soát kho", "Inventory items": "Danh mục hàng hóa",
    "Stock locations": "Vị trí kho", "Stock availability": "Tình trạng tồn kho", "Lot and expiry": "Lô và hạn dùng",
    "Inventory alerts": "Cảnh báo tồn kho", "Inventory suppliers": "Nhà cung cấp kho", "Inventory purchase orders": "Đơn mua hàng tồn kho",
    "Goods receipts": "Phiếu nhập hàng", "Stock transfers": "Điều chuyển kho", "Stock adjustments": "Điều chỉnh tồn kho",
    "Blind stock counts": "Kiểm kê mù", "Service material recipes": "Định mức vật tư dịch vụ", "Inventory ledger": "Sổ biến động kho",
    "Inventory valuation": "Định giá tồn kho",
  };
  return labels[value] ?? value;
}
function inventoryDescription(value: string) {
  const labels: Record<string, string> = {
    "Server-authoritative on-hand, reserved and available quantities.": "Số lượng tồn, đang giữ và khả dụng do máy chủ xác nhận.",
    "Manage active consumables and retail items without editing stock balances directly.": "Quản lý vật tư và hàng bán mà không sửa trực tiếp số dư tồn kho.",
    "Branch-scoped stock rooms and operational locations.": "Quản lý khu vực kho theo chi nhánh.",
    "Traceable lot status and expiry visibility.": "Theo dõi lô hàng và hạn dùng có thể truy vết.",
    "Review and acknowledge operational stock alerts.": "Theo dõi và xác nhận cảnh báo vận hành.",
    "Supplier directory used by inventory purchasing workflows.": "Danh sách nhà cung cấp dùng trong quy trình mua hàng tồn kho.",
    "Inventory purchase orders remain separate from Procurement purchase orders.": "Đơn mua hàng tồn kho được quản lý riêng với đơn mua hàng của Mua hàng.",
    "Receive and post goods through the inventory receipt lifecycle.": "Tiếp nhận và ghi nhận hàng theo vòng đời phiếu nhập kho.",
    "Request, approve, ship and receive stock across authorized branches.": "Yêu cầu, phê duyệt, xuất và nhận hàng giữa các chi nhánh được cấp quyền.",
    "Review reasoned adjustments with version checks and approval.": "Rà soát điều chỉnh có lý do, kiểm tra phiên bản và phê duyệt.",
    "Count first, review variance later; expected stock stays hidden before review.": "Kiểm kê trước, rà soát chênh lệch sau; số tồn kỳ vọng được giữ kín trước khi duyệt.",
    "Define branch-scoped service material consumption.": "Thiết lập định mức vật tư dịch vụ theo chi nhánh.",
    "Append-only inventory movement history.": "Lịch sử biến động kho chỉ ghi thêm.",
    "Cost and valuation data is permission-gated by the API.": "Dữ liệu giá vốn và định giá được API kiểm soát theo quyền.",
  };
  return labels[value] ?? value;
}

const columns: Record<string, string[]> = {
  items: ["sku", "name", "status", "itemType", "quantityPrecision"],
  locations: ["code", "name", "locationType", "status"],
  stock: ["sku", "name", "onHand", "reserved", "available", "expiryDate", "lotStatus", "locationType"],
  lots: ["lotId", "expiryDate", "status"],
  alerts: ["severity", "alertType", "status", "createdAt"],
  suppliers: ["code", "name", "status"],
  purchaseOrders: ["poNumber", "status", "currency", "totalMinor", "createdAt"],
  receipts: ["receiptNumber", "status", "receivedAt", "createdAt"],
  transfers: ["transferNumber", "status", "sourceBranchId", "destinationBranchId", "createdAt"],
  adjustments: ["reasonCode", "status", "quantityDelta", "version", "createdAt"],
  counts: ["status", "blind", "version", "createdAt"],
  recipes: ["serviceId", "name", "status", "branchId"],
  ledger: ["entryType", "quantityDelta", "reasonCode", "occurredAt"],
  valuation: ["branchId", "onHand", "totalCostMinor", "generatedAt"],
};

const surfaceCopy: Record<string, { eyebrow: string; title: string; description: string }> = {
  items: { eyebrow: "DANH MỤC HÀNG HÓA", title: "Danh mục hàng hóa", description: "Thông tin mặt hàng và đơn vị cơ bản do máy chủ quản lý; số dư tồn chỉ thay đổi qua nghiệp vụ kho." },
  locations: { eyebrow: "CẤU TRÚC KHO", title: "Vị trí kho", description: "Khu vực lưu trữ theo chi nhánh, dùng làm nguồn cho nhập hàng, điều chuyển và kiểm kê." },
  stock: { eyebrow: "SỐ DƯ TỒN KHO", title: "Tồn kho khả dụng", description: "Đối chiếu tồn thực tế, lượng đang giữ và số lượng có thể cấp phát từ projection của máy chủ." },
  lots: { eyebrow: "TRUY VẾT LÔ HÀNG", title: "Lô và hạn dùng", description: "Theo dõi lô, hạn dùng và trạng thái lô để operator xử lý theo dữ liệu đã ghi nhận." },
  alerts: { eyebrow: "CẢNH BÁO VẬN HÀNH", title: "Cảnh báo tồn kho", description: "Các cảnh báo thiếu hàng, hết hàng hoặc sắp hết hạn được xác nhận từ nguồn kho." },
  suppliers: { eyebrow: "ĐỐI TÁC CUNG ỨNG", title: "Nhà cung cấp", description: "Danh mục nhà cung cấp được dùng trong quy trình mua hàng và tiếp nhận hàng hóa." },
  purchaseOrders: { eyebrow: "ĐƠN MUA HÀNG", title: "Đơn mua hàng tồn kho", description: "Theo dõi vòng đời đơn mua hàng tồn kho và chỉ thực hiện chuyển trạng thái qua lệnh máy chủ." },
  receipts: { eyebrow: "TIẾP NHẬN HÀNG", title: "Phiếu nhập hàng", description: "Phiếu nhập và bằng chứng ghi nhận hàng nhận vào kho theo chi nhánh được cấp quyền." },
  transfers: { eyebrow: "ĐIỀU CHUYỂN NỘI BỘ", title: "Điều chuyển kho", description: "Theo dõi yêu cầu, phê duyệt, xuất và nhận hàng giữa các chi nhánh được phép." },
  adjustments: { eyebrow: "ĐIỀU CHỈNH CÓ KIỂM SOÁT", title: "Điều chỉnh tồn kho", description: "Mọi điều chỉnh cần lý do, phiên bản và quy trình phê duyệt; không sửa số dư trực tiếp." },
  counts: { eyebrow: "KIỂM KÊ MÙ", title: "Kiểm kê mù", description: "Operator nhập số đếm trước, sau đó hệ thống mới mở phần rà soát chênh lệch kỳ vọng." },
  recipes: { eyebrow: "ĐỊNH MỨC DỊCH VỤ", title: "Vật tư theo dịch vụ", description: "Định mức tiêu hao theo dịch vụ và chi nhánh, làm nguồn cho xuất kho vận hành." },
  ledger: { eyebrow: "SỔ BIẾN ĐỘNG KHO", title: "Lịch sử biến động", description: "Dòng nhập, xuất, điều chuyển và điều chỉnh bất biến do máy chủ ghi nhận." },
  valuation: { eyebrow: "GIÁ VỐN & ĐỊNH GIÁ", title: "Định giá tồn kho", description: "Số liệu giá vốn và định giá chỉ hiển thị khi API cho phép theo quyền tài chính." },
};

function actionFor(kind: string, row: any): Array<{ label: string; path: string; body?: Record<string, unknown> | undefined }> {
  const version = row.version == null ? undefined : { version: row.version };
  if (kind === "items" && row.status === "ACTIVE") return [{ label: "Lưu trữ", path: `/v1/inventory/items/${row.id}/archive`, body: version }];
  if (kind === "items" && row.status === "ARCHIVED") return [{ label: "Kích hoạt", path: `/v1/inventory/items/${row.id}/activate`, body: version }];
  if (kind === "alerts" && row.status === "OPEN") return [{ label: "Xác nhận", path: `/v1/inventory/alerts/${row.id}/acknowledge` }];
  if (kind === "purchaseOrders" && row.status === "DRAFT") return [{ label: "Gửi duyệt", path: `/v1/inventory/purchase-orders/${row.id}/submit`, body: version }];
  if (kind === "purchaseOrders" && row.status === "SUBMITTED") return [{ label: "Phê duyệt", path: `/v1/inventory/purchase-orders/${row.id}/approve`, body: version }];
  if (kind === "receipts" && row.status === "DRAFT") return [{ label: "Ghi nhận", path: `/v1/inventory/receipts/${row.id}/post`, body: version }];
  if (kind === "transfers" && row.status === "DRAFT") return [{ label: "Tạo yêu cầu", path: `/v1/inventory/transfers/${row.id}/request`, body: version }];
  if (kind === "transfers" && row.status === "REQUESTED") return [{ label: "Phê duyệt", path: `/v1/inventory/transfers/${row.id}/approve`, body: version }];
  if (kind === "transfers" && row.status === "APPROVED") return [{ label: "Xuất kho", path: `/v1/inventory/transfers/${row.id}/ship`, body: version }];
  if (kind === "transfers" && row.status === "IN_TRANSIT") return [{ label: "Nhận hàng", path: `/v1/inventory/transfers/${row.id}/receive`, body: version }];
  if (kind === "adjustments" && row.status === "PENDING") return [{ label: "Phê duyệt", path: `/v1/inventory/adjustments/${row.id}/approve`, body: { ...version, reason: "Đã kiểm tra trong màn hình kho" } }];
  if (kind === "adjustments" && row.status === "APPROVED") return [{ label: "Ghi nhận", path: `/v1/inventory/adjustments/${row.id}/post`, body: version }];
  if (kind === "counts" && row.status === "DRAFT") return [{ label: "Bắt đầu kiểm kê", path: `/v1/inventory/counts/${row.id}/start`, body: version }];
  if (kind === "counts" && row.status === "COUNTING") return [{ label: "Bắt đầu kiểm tra", path: `/v1/inventory/counts/${row.id}/start-review`, body: version }];
  if (kind === "counts" && ["REVIEW", "SUBMITTED"].includes(row.status)) return [{ label: "Phê duyệt", path: `/v1/inventory/counts/${row.id}/approve`, body: version }];
  if (kind === "counts" && row.status === "APPROVED") return [{ label: "Ghi nhận", path: `/v1/inventory/counts/${row.id}/post`, body: version }];
  return [];
}

export default function Sprint19Wave5Inventory({ pathname }: { pathname: string }) {
  const route = Object.keys(screens).sort((left, right) => right.length - left.length).find((key) => pathname === key || pathname.startsWith(`${key}/`)) ?? "/admin/inventory/stock";
  const screen = screens[route]!;
  const [branchId, setBranchId] = useState<string | undefined>();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchState, setBranchState] = useState<AsyncState>("loading");
  const [state, setState] = useState<AsyncState>("loading");
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [itemOptions, setItemOptions] = useState<any[]>([]);
  const [uomOptions, setUomOptions] = useState<any[]>([]);
  const [locationOptions, setLocationOptions] = useState<any[]>([]);
  const intentKeys = useRef<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void getAuthorizedBranchContext().then(({ branches: authorizedBranches, branchId: selected }) => {
      if (cancelled) return;
      setBranches(authorizedBranches);
      setBranchId(selected);
      setBranchState("ready");
    }).catch((e) => { if (!cancelled) { setError(e.message); setBranchState(e.forbidden ? "forbidden" : "error"); } });
    return () => { cancelled = true; };
  }, []);

  const endpoint = screen.branchScoped && !branchId ? undefined : screen.endpoint.replace(ACTIVE_BRANCH, encodeURIComponent(branchId ?? ""));
  const load = useCallback(async () => {
    if (!endpoint) { setRows([]); setState("empty"); return; }
    setState("loading"); setError("");
    try { const nextRows = rowsOf(await read(endpoint)); setRows(nextRows); setState(nextRows.length ? "ready" : "empty"); }
    catch (e: any) { setError(e.message); setState(e.forbidden ? "forbidden" : "error"); }
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const session = activeSession();
    if (!session.accessToken) return;
    const socket = io(`${session.api}/scheduling`, { auth: { token: session.accessToken }, transports: ["websocket"] });
    const refresh = () => void load();
    ["inventory.updated", "inventory.alerts.updated", "pos.order.updated"].forEach((event) => socket.on(event, refresh));
    return () => { socket.disconnect(); };
  }, [load]);
  useEffect(() => {
    const locationsPromise = branchId
      ? read(`/v1/inventory/locations?branchId=${encodeURIComponent(branchId)}`).catch(() => [])
      : Promise.resolve([]);
    void Promise.all([read("/v1/inventory/items").catch(() => []), read("/v1/inventory/uoms").catch(() => []), locationsPromise]).then(([items, uoms, locations]) => {
      setItemOptions(rowsOf(items));
      setUomOptions(rowsOf(uoms));
      setLocationOptions(rowsOf(locations));
    });
  }, [branchId]);

  async function run(path: string, body: Record<string, unknown> = {}) {
    if (!navigator.onLine) { setNotice("Cần có kết nối mạng. Thao tác kho không được xếp hàng khi ngoại tuyến."); return; }
    setBusy(true); setNotice("");
    const key = intentKeys.current[path] ?? (intentKeys.current[path] = crypto.randomUUID());
    try {
      await read(path, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body) });
      delete intentKeys.current[path];
      setNotice("Đã lưu sau khi máy chủ xác nhận; dữ liệu tồn kho đã được làm mới.");
      await load();
    } catch (e: any) { setNotice(e.message); } finally { setBusy(false); }
  }

  const visibleColumns = columns[screen.kind] ?? [];
  const needsBranch = Boolean(screen.branchScoped);
  return <main className="shell ops-shell">
    <section className="card">
      <p className="eyebrow">NAILSOFT · KHO HÀNG</p>
      <div className="title-row"><div><h1>{inventoryTitle(screen.title)}</h1><p className="hint">{inventoryDescription(screen.description)}</p></div><button onClick={() => void load()} disabled={state === "loading"}>Làm mới</button></div>
      {branchState === "loading" && <p role="status" aria-busy="true">Đang tải các chi nhánh được cấp quyền…</p>}
      {branchState === "forbidden" && <p role="alert">Không có quyền truy cập ngữ cảnh chi nhánh.</p>}
      {branches.length > 1 && <label>Chi nhánh đang chọn<select aria-label="Chi nhánh đang chọn" value={branchId ?? ""} onChange={(event) => { const next = event.target.value || undefined; setBranchId(next); setActiveBranchId(next); }}><option value="">Chọn chi nhánh được cấp quyền</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
      {needsBranch && !branchId && branchState === "ready" && <p role="alert">Chọn chi nhánh được cấp quyền để xem màn hình này. Máy chủ vẫn là nguồn xác thực cuối cùng.</p>}
      {notice && <p role="status" className="notice">{notice}</p>}
      {state === "loading" && <div role="status" aria-busy="true" className="skeleton">Đang tải dữ liệu kho đã được xác nhận…</div>}
      {state === "forbidden" && <div role="alert" className="state"><h2>Không có quyền truy cập</h2><p>Vai trò hoặc phạm vi chi nhánh hiện tại không bao gồm màn hình kho này.</p><button onClick={() => void load()}>Thử lại</button></div>}
      {state === "error" && <div role="alert" className="state"><h2>Không thể tải dữ liệu kho</h2><p>{error}</p><button onClick={() => void load()}>Thử lại</button></div>}
      {state === "empty" && <div className="state"><h2>Chưa có dữ liệu</h2><p>Chưa có bản ghi trong phạm vi được cấp quyền.</p><button onClick={() => void load()}>Thử lại</button></div>}
      {state === "ready" && <InventorySurface kind={screen.kind} rows={rows} columns={visibleColumns} busy={busy} run={run} />}
    </section>
    {(["items", "locations", "suppliers", "adjustments", "transfers", "counts"].includes(screen.kind)) && <InventoryCreate kind={screen.kind} branchId={branchId} branches={branches} items={itemOptions} uoms={uomOptions} locations={locationOptions} run={run} />}
  </main>;
}

function InventorySurface({ kind, rows, columns, busy, run }: { kind: string; rows: any[]; columns: string[]; busy: boolean; run: (path: string, body?: Record<string, unknown>) => Promise<void> }) {
  const copy = surfaceCopy[kind] ?? surfaceCopy.stock!;
  return <section className="ns-inventory-surface" aria-labelledby={`inventory-surface-${kind}`}>
    <div className="ns-inventory-surface-head"><div><p className="eyebrow">{copy.eyebrow}</p><h2 id={`inventory-surface-${kind}`}>{copy.title}</h2><p>{copy.description}</p></div><span className="ns-data-badge">Dữ liệu server</span></div>
    <InventoryTable rows={rows} kind={kind} columns={columns} busy={busy} run={run} />
  </section>;
}

function InventoryTable({ rows, kind, columns, busy, run }: { rows: any[]; kind: string; columns: string[]; busy: boolean; run: (path: string, body?: Record<string, unknown>) => Promise<void> }) {
  if (!rows.length) return null;
  return <div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column} scope="col">{titleFor(column)}</th>)}<th scope="col">Thao tác</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id ?? `${kind}-${index}`}>{columns.map((column) => <td key={column} data-label={titleFor(column)}>{text(row[column], column)}</td>)}<td>{actionFor(kind, row).map((action) => <button key={action.path} disabled={busy} onClick={() => void run(action.path, action.body)}>{action.label}</button>)}</td></tr>)}</tbody></table></div>;
}

function InventoryCreate({ kind, branchId, branches, items, uoms, locations, run }: { kind: string; branchId?: string | undefined; branches: Branch[]; items: any[]; uoms: any[]; locations: any[]; run: (path: string, body?: Record<string, unknown> | undefined) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const value = (name: string) => form[name] ?? "";
  const set = (name: string, next: string) => setForm((current) => ({ ...current, [name]: next }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (["locations", "adjustments", "transfers", "counts"].includes(kind) && !branchId) return;
    const body: Record<string, unknown> = kind === "items"
      ? { sku: value("sku"), name: { "vi-VN": value("name"), "en-US": value("name") }, baseUomId: value("uomId"), itemType: value("itemType") || "CONSUMABLE", trackLot: true, trackExpiry: true, quantityPrecision: 3, currency: "VND" }
      : kind === "locations"
        ? { branchId, code: value("code"), name: value("name"), locationType: value("locationType") || "STOCKROOM" }
        : kind === "suppliers"
          ? { code: value("code"), name: value("name"), contact: { email: value("email") || undefined } }
          : kind === "adjustments"
            ? { branchId, locationId: value("locationId"), itemId: value("itemId"), quantityDelta: value("quantityDelta"), reasonCode: value("reasonCode") || "PHYSICAL_CORRECTION", note: value("note") }
            : kind === "transfers"
              ? { sourceBranchId: branchId, destinationBranchId: value("destinationBranchId"), sourceLocationId: value("sourceLocationId"), destinationLocationId: value("destinationLocationId"), lines: [{ itemId: value("itemId"), quantity: value("quantity") }] }
              : { branchId, locationId: value("locationId"), blind: true, items: [{ itemId: value("itemId"), lotId: value("lotId") || null }] };
    const endpoint = { items: "/v1/inventory/items", locations: "/v1/inventory/locations", suppliers: "/v1/inventory/suppliers", adjustments: "/v1/inventory/adjustments", transfers: "/v1/inventory/transfers", counts: "/v1/inventory/counts" }[kind]!;
    await run(endpoint, body); setForm({}); setOpen(false);
  }
  const option = (name: string, label: string, values: any[]) => <label>{label}<select name={name} value={value(name)} onChange={(event) => set(name, event.target.value)} required><option value="">Chọn {label.toLowerCase()}</option>{values.map((entry) => <option key={entry.id} value={entry.id}>{typeof entry.name === "object" ? entry.name?.["vi-VN"] ?? entry.name?.["en-US"] ?? entry.code ?? entry.sku ?? "Mã hệ thống" : entry.name ?? entry.code ?? entry.sku ?? "Mã hệ thống"}</option>)}</select></label>;
  return <section className="card"><div className="title-row"><h2>Thao tác vận hành</h2><button onClick={() => setOpen((current) => !current)}>{open ? "Đóng" : "Tạo mới"}</button></div>{open && <form className="form-grid" onSubmit={(event) => void submit(event)}>{kind === "items" && <><label>SKU<input required value={value("sku")} onChange={(event) => set("sku", event.target.value)} /></label><label>Tên hàng<input required value={value("name")} onChange={(event) => set("name", event.target.value)} /></label>{option("uomId", "Đơn vị cơ bản", uoms)}</>}{kind === "locations" && <><label>Mã vị trí<input required value={value("code")} onChange={(event) => set("code", event.target.value)} /></label><label>Tên vị trí<input required value={value("name")} onChange={(event) => set("name", event.target.value)} /></label></>}{kind === "suppliers" && <><label>Mã nhà cung cấp<input required value={value("code")} onChange={(event) => set("code", event.target.value)} /></label><label>Tên nhà cung cấp<input required value={value("name")} onChange={(event) => set("name", event.target.value)} /></label><label>Email<input type="email" value={value("email")} onChange={(event) => set("email", event.target.value)} /></label></>}{kind === "adjustments" && <>{option("itemId", "Mặt hàng", items)}{option("locationId", "Vị trí kho", locations)}<label>Chênh lệch số lượng<input required value={value("quantityDelta")} onChange={(event) => set("quantityDelta", event.target.value)} /></label><label>Lý do<input required value={value("note")} onChange={(event) => set("note", event.target.value)} /></label></>}{kind === "transfers" && <>{option("destinationBranchId", "Chi nhánh đích", branches.filter((branch) => branch.id !== branchId))}{option("itemId", "Mặt hàng", items)}{option("sourceLocationId", "Vị trí nguồn", locations)}{option("destinationLocationId", "Vị trí đích", locations)}<label>Số lượng<input required value={value("quantity")} onChange={(event) => set("quantity", event.target.value)} /></label></>}{kind === "counts" && <>{option("itemId", "Mặt hàng", items)}{option("locationId", "Vị trí kho", locations)}</>}<button type="submit">Gửi thao tác</button></form>}</section>;
}

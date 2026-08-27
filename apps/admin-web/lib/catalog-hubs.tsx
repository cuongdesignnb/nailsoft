/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authorizedFetch } from "./auth";

type CatalogKind = "categories" | "services" | "skills" | "resource-types" | "resources";
type AsyncState = "loading" | "ready" | "empty" | "error" | "forbidden";

const catalogMeta: Record<CatalogKind, { title: string; eyebrow: string; description: string; endpoint: string; createLabel: string }> = {
  categories: {
    title: "Nhóm dịch vụ",
    eyebrow: "DANH MỤC · NHÓM DỊCH VỤ",
    description: "Chuẩn hoá cách phân loại dịch vụ để đội ngũ và khách hàng luôn nhìn thấy cùng một cấu trúc.",
    endpoint: "/v1/service-categories",
    createLabel: "Thêm nhóm dịch vụ",
  },
  services: {
    title: "Danh mục dịch vụ",
    eyebrow: "DANH MỤC · DỊCH VỤ",
    description: "Quản lý tên hiển thị, thời lượng và nhóm dịch vụ đang được cung cấp tại salon.",
    endpoint: "/v1/services?status=ACTIVE&page=1&pageSize=50",
    createLabel: "Thêm dịch vụ",
  },
  skills: {
    title: "Kỹ năng nhân sự",
    eyebrow: "DANH MỤC · KỸ NĂNG",
    description: "Khai báo kỹ năng thực tế để Availability Engine phân công đúng nhân sự.",
    endpoint: "/v1/skills",
    createLabel: "Thêm kỹ năng",
  },
  "resource-types": {
    title: "Loại tài nguyên",
    eyebrow: "DANH MỤC · TÀI NGUYÊN",
    description: "Định nghĩa các loại phòng, bàn hoặc tài nguyên được dùng trong vận hành.",
    endpoint: "/v1/resource-types",
    createLabel: "Thêm loại tài nguyên",
  },
  resources: {
    title: "Tài nguyên chi nhánh",
    eyebrow: "VẬN HÀNH · TÀI NGUYÊN",
    description: "Theo dõi tài nguyên theo từng chi nhánh, sức chứa và trạng thái sẵn sàng.",
    endpoint: "/v1/resources",
    createLabel: "Thêm tài nguyên",
  },
};

function unwrap(body: any): any[] {
  const value = body?.data ?? body;
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.rows)) return value.rows;
  return value ? [value] : [];
}

function unwrapOne(body: any) {
  const value = body?.data ?? body;
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function idOf(row: any, index = 0) {
  return String(row?.id ?? row?.serviceId ?? row?.categoryId ?? row?.resourceId ?? index);
}

function localized(value: any) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value["vi-VN"] ?? value.vi ?? value.en ?? value["en-US"] ?? Object.values(value)[0] ?? "—";
  return value == null ? "—" : String(value);
}

function statusLabel(value: any) {
  const key = String(value ?? "").toUpperCase();
  return ({
    ACTIVE: "Đang hoạt động",
    INACTIVE: "Không hoạt động",
    ARCHIVED: "Đã lưu trữ",
    DRAFT: "Bản nháp",
    PUBLISHED: "Đã công bố",
  } as Record<string, string>)[key] ?? (value ? String(value).replaceAll("_", " ") : "Chưa phân loại");
}

function statusTone(value: any) {
  const key = String(value ?? "").toUpperCase();
  if (["ACTIVE", "PUBLISHED"].includes(key)) return "is-good";
  if (["DRAFT", "INACTIVE"].includes(key)) return "is-warning";
  if (["ARCHIVED"].includes(key)) return "is-muted";
  return "is-neutral";
}

function dateValue(value: any) {
  if (!value) return "—";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function rowName(kind: CatalogKind, row: any) {
  if (kind === "services") return localized(row.name) || row.code || "Dịch vụ";
  return localized(row.name) || row.displayName || row.code || "Bản ghi danh mục";
}

function rowCode(row: any) {
  return row?.code ?? row?.slug ?? "—";
}

function formTitle(kind: CatalogKind) {
  return catalogMeta[kind].createLabel;
}

function CatalogCreateForm({ kind }: { kind: CatalogKind }) {
  const meta = catalogMeta[kind];
  const [branches, setBranches] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [resourceTypes, setResourceTypes] = useState<any[]>([]);
  const [values, setValues] = useState<Record<string, string>>({ defaultDurationMin: "60", capacity: "1" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const intentKey = useRef<string | undefined>(undefined);

  useEffect(() => {
    const needsBranches = kind === "resources";
    const needsCategories = kind === "services";
    const needsTypes = kind === "resources";
    void Promise.all([
      needsBranches ? authorizedFetch("/v1/branches").then(async (response) => unwrap(await response.json().catch(() => ({})))) : Promise.resolve([]),
      needsCategories ? authorizedFetch("/v1/service-categories").then(async (response) => unwrap(await response.json().catch(() => ({})))) : Promise.resolve([]),
      needsTypes ? authorizedFetch("/v1/resource-types").then(async (response) => unwrap(await response.json().catch(() => ({})))) : Promise.resolve([]),
    ]).then(([branchRows, categoryRows, typeRows]) => {
      setBranches(branchRows);
      setCategories(categoryRows);
      setResourceTypes(typeRows);
    }).catch(() => undefined);
  }, [kind]);

  function update(name: string, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const intent = intentKey.current ?? crypto.randomUUID();
    intentKey.current = intent;
    const body: Record<string, unknown> = { ...values };
    if (body.name) body.name = { "vi-VN": String(body.name), "en-US": String(body.name) };
    for (const key of ["defaultDurationMin", "capacity"]) {
      if (body[key] !== undefined && body[key] !== "") body[key] = Number(body[key]);
    }
    try {
      const response = await authorizedFetch(meta.endpoint.split("?")[0] ?? meta.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": intent },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error?.message ?? "Không thể tạo bản ghi.");
      intentKey.current = undefined;
      setValues({ defaultDurationMin: "60", capacity: "1" });
      setNotice("Bản ghi đã được tạo và máy chủ đã xác nhận.");
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể tạo bản ghi.");
    } finally {
      setBusy(false);
    }
  }

  const common = [
    ["name", "Tên hiển thị", "text"],
    ["code", "Mã nội bộ", "text"],
  ] as const;

  return <main className="shell ops-shell catalog-hub"><header className="catalog-header"><div><p className="eyebrow">{meta.eyebrow}</p><h1>{formTitle(kind)}</h1><p className="hint">{meta.description}</p></div><a className="catalog-link" href={`/admin/catalog/${kind === "categories" ? "categories" : kind}`}>Quay lại danh sách</a></header><form className="catalog-create-form" onSubmit={submit}>{error ? <p className="catalog-notice is-danger" role="alert">{error}</p> : null}{notice ? <p className="catalog-notice is-success" role="status">{notice}</p> : null}<div className="catalog-form-grid">{common.map(([name, label, type]) => <label key={name}>{label}<input required value={values[name] ?? ""} onChange={(event) => update(name, event.target.value)} type={type} /></label>)}{kind === "services" ? <><label>Nhóm dịch vụ<select required value={values.categoryId ?? ""} onChange={(event) => update("categoryId", event.target.value)}><option value="">Chọn nhóm dịch vụ</option>{categories.map((row) => <option key={idOf(row)} value={idOf(row)}>{rowName("categories", row)}</option>)}</select></label><label>Thời lượng (phút)<input required min={1} type="number" value={values.defaultDurationMin ?? "60"} onChange={(event) => update("defaultDurationMin", event.target.value)} /></label></> : null}{kind === "resources" ? <><label>Chi nhánh<select required value={values.branchId ?? ""} onChange={(event) => update("branchId", event.target.value)}><option value="">Chọn chi nhánh được cấp quyền</option>{branches.map((row) => <option key={idOf(row)} value={idOf(row)}>{row.name ?? row.code ?? "Chi nhánh"}</option>)}</select></label><label>Loại tài nguyên<select required value={values.resourceTypeId ?? ""} onChange={(event) => update("resourceTypeId", event.target.value)}><option value="">Chọn loại tài nguyên</option>{resourceTypes.map((row) => <option key={idOf(row)} value={idOf(row)}>{rowName("resource-types", row)}</option>)}</select></label><label>Sức chứa<input required min={1} type="number" value={values.capacity ?? "1"} onChange={(event) => update("capacity", event.target.value)} /></label></> : null}</div><p className="catalog-helper">Các lựa chọn liên quan được tải từ API; không nhập UUID trực tiếp. Bản ghi chỉ được tạo sau khi máy chủ kiểm tra phạm vi và quyền.</p><div className="catalog-create-actions"><a className="catalog-link" href={`/admin/catalog/${kind === "categories" ? "categories" : kind}`}>Hủy</a><button type="submit" disabled={busy}>{busy ? "Đang tạo…" : meta.createLabel}</button></div></form></main>;
}

function CatalogList({ kind }: { kind: CatalogKind }) {
  const meta = catalogMeta[kind];
  const [state, setState] = useState<AsyncState>("loading");
  const [rows, setRows] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const response = await authorizedFetch(meta.endpoint);
      const body = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403) throw Object.assign(new Error("Bạn không có quyền xem danh mục này."), { forbidden: true });
      if (!response.ok) throw new Error(body?.error?.message ?? "Không thể tải dữ liệu danh mục.");
      const values = unwrap(body);
      setRows(values);
      setSelectedId((current) => current ?? (values[0] ? idOf(values[0], 0) : null));
      setState(values.length ? "ready" : "empty");
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể tải dữ liệu danh mục.");
      setState(cause?.forbidden ? "forbidden" : "error");
    }
  }, [meta.endpoint]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("vi-VN");
    if (!needle) return rows;
    return rows.filter((row) => JSON.stringify(row).toLocaleLowerCase("vi-VN").includes(needle));
  }, [query, rows]);
  const selected = filtered.find((row, index) => idOf(row, index) === selectedId) ?? filtered[0] ?? null;
  const stats = useMemo(() => [
    ["Bản ghi trong phạm vi", String(rows.length)],
    ["Đang hoạt động", String(rows.filter((row) => String(row.status ?? "ACTIVE").toUpperCase() === "ACTIVE").length)],
    ["Có mã nội bộ", String(rows.filter((row) => row.code).length)],
    [kind === "services" ? "Thời lượng đã khai báo" : "Cập nhật gần đây", kind === "services" ? String(rows.filter((row) => row.defaultDurationMin != null).length) : String(rows.filter((row) => row.updatedAt || row.createdAt).length)],
  ], [kind, rows]);

  async function archive(row: any) {
    const id = idOf(row);
    if (!id || busyId) return;
    setBusyId(id);
    setError("");
    setNotice("");
    const endpoint = kind === "categories" ? `/v1/service-categories/${encodeURIComponent(id)}/archive` : kind === "services" ? `/v1/services/${encodeURIComponent(id)}/archive` : kind === "skills" ? `/v1/skills/${encodeURIComponent(id)}/archive` : kind === "resources" ? `/v1/resources/${encodeURIComponent(id)}/archive` : "";
    if (!endpoint) { setBusyId(""); return; }
    try {
      const response = await authorizedFetch(endpoint, { method: "POST", headers: { "idempotency-key": crypto.randomUUID(), "content-type": "application/json" }, body: JSON.stringify({ version: row.version }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error?.message ?? "Không thể lưu trữ bản ghi.");
      setNotice("Trạng thái đã được cập nhật từ máy chủ.");
      await load();
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể lưu trữ bản ghi.");
    } finally {
      setBusyId("");
    }
  }

  return <main className="shell ops-shell catalog-hub"><header className="catalog-header"><div><p className="eyebrow">{meta.eyebrow}</p><h1>{meta.title}</h1><p className="hint">{meta.description}</p></div><a className="catalog-primary-link" href={`/admin/catalog/${kind}/new`}>{meta.createLabel}</a></header><nav className="catalog-tabs" aria-label="Danh mục vận hành">{(Object.keys(catalogMeta) as CatalogKind[]).map((item) => <a className={item === kind ? "is-active" : ""} key={item} href={`/admin/catalog/${item}`}>{catalogMeta[item].title}</a>)}</nav><section className="catalog-kpis">{stats.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong><small>{kind === "services" && label === "Thời lượng đã khai báo" ? "Sẵn sàng cho Availability" : "Theo dữ liệu API"}</small></article>)}</section><div className="catalog-layout"><section className="catalog-main"><div className="catalog-toolbar"><label className="catalog-search">Tìm trong danh mục<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tên, mã hoặc thuộc tính" /></label><span className="catalog-count">{filtered.length} / {rows.length} bản ghi</span></div>{notice ? <p className="catalog-notice is-success" role="status">{notice}</p> : null}{state === "loading" ? <div className="catalog-state" role="status" aria-busy="true">Đang tải dữ liệu danh mục…</div> : null}{state === "forbidden" ? <div className="catalog-state" role="alert"><h2>Không có quyền truy cập</h2><p>Vai trò hiện tại không được phép xem danh mục này.</p></div> : null}{state === "error" ? <div className="catalog-state" role="alert"><h2>Không thể tải dữ liệu</h2><p>{error}</p><button onClick={() => void load()}>Thử lại</button></div> : null}{state === "empty" ? <div className="catalog-state"><h2>Chưa có bản ghi</h2><p>Hãy tạo bản ghi đầu tiên khi domain đã sẵn sàng.</p><a className="catalog-primary-link" href={`/admin/catalog/${kind}/new`}>{meta.createLabel}</a></div> : null}{state === "ready" ? <div className="catalog-table-wrap"><table><caption className="sr-only">{meta.title}</caption><thead><tr><th scope="col">Tên hiển thị</th><th scope="col">Mã nội bộ</th><th scope="col">Thông tin chính</th><th scope="col">Trạng thái</th><th scope="col">Thao tác</th></tr></thead><tbody>{filtered.map((row, index) => { const id = idOf(row, index); const selectedRow = id === selectedId; return <tr key={id} aria-selected={selectedRow} className={selectedRow ? "is-selected" : ""} onClick={() => setSelectedId(id)}><td><strong>{rowName(kind, row)}</strong><small>Thông tin danh mục từ máy chủ</small></td><td><span className="catalog-code">{rowCode(row)}</span></td><td>{kind === "services" ? `${row.defaultDurationMin ?? "—"} phút` : kind === "resources" ? `Sức chứa ${row.capacity ?? "—"}` : row.categoryId ? "Có nhóm dịch vụ" : row.branchId ? "Có chi nhánh" : dateValue(row.updatedAt ?? row.createdAt)}</td><td><span className={`catalog-status ${statusTone(row.status)}`}>{statusLabel(row.status ?? "ACTIVE")}</span></td><td><div className="catalog-row-actions">{kind === "services" ? <a href={`/admin/catalog/services/${encodeURIComponent(id)}`} onClick={(event) => event.stopPropagation()}>Mở chi tiết</a> : null}{["ACTIVE", "PUBLISHED"].includes(String(row.status ?? "ACTIVE").toUpperCase()) && kind !== "resource-types" ? <button type="button" disabled={busyId === id} onClick={(event) => { event.stopPropagation(); void archive(row); }}>{busyId === id ? "Đang lưu…" : "Lưu trữ"}</button> : null}</div></td></tr>; })}</tbody></table></div> : null}</section><aside className="catalog-inspector"><p className="catalog-inspector-kicker">BẢN GHI ĐANG CHỌN</p>{selected ? <><h2>{rowName(kind, selected)}</h2><p className="catalog-inspector-sub">{catalogMeta[kind].title} · {statusLabel(selected.status ?? "ACTIVE")}</p><dl>{[["Mã nội bộ", rowCode(selected)], ["Phiên bản", selected.version ?? "—"], ["Chi nhánh", selected.branchName ?? (selected.branchId ? "Mã hệ thống" : "Toàn salon")], [kind === "services" ? "Thời lượng" : "Cập nhật", kind === "services" ? `${selected.defaultDurationMin ?? "—"} phút` : dateValue(selected.updatedAt ?? selected.createdAt)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>)}</dl><div className="catalog-inspector-note"><strong>Nguồn dữ liệu</strong><span>API danh mục · quyền và phạm vi do máy chủ kiểm tra.</span></div>{kind === "services" ? <a className="catalog-primary-link catalog-full" href={`/admin/catalog/services/${encodeURIComponent(idOf(selected))}`}>Xem chi tiết dịch vụ</a> : null}</> : <div className="catalog-state is-compact"><h2>Chọn một bản ghi</h2><p>Thông tin chi tiết sẽ xuất hiện ở đây.</p></div>}</aside></div></main>;
}

function ServiceDetailHub({ id }: { id: string }) {
  const [state, setState] = useState<AsyncState>("loading");
  const [service, setService] = useState<any>(null);
  const [related, setRelated] = useState<Record<string, any[]>>({});
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const paths = ["", "/prices", "/skills", "/resources", "/addons"];
      const responses = await Promise.all(paths.map((suffix) => authorizedFetch(`/v1/services/${encodeURIComponent(id)}${suffix}`)));
      const bodies = await Promise.all(responses.map((response) => response.json().catch(() => ({}))));
      if (responses[0]?.status === 401 || responses[0]?.status === 403) throw Object.assign(new Error("Bạn không có quyền xem chi tiết dịch vụ."), { forbidden: true });
      if (!responses[0]?.ok) throw new Error(bodies[0]?.error?.message ?? "Không thể tải chi tiết dịch vụ.");
      setService(unwrapOne(bodies[0]));
      setRelated({ prices: unwrap(bodies[1]), skills: unwrap(bodies[2]), resources: unwrap(bodies[3]), addons: unwrap(bodies[4]) });
      setState("ready");
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể tải chi tiết dịch vụ.");
      setState(cause?.forbidden ? "forbidden" : "error");
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  const name = localized(service?.name) || "Chi tiết dịch vụ";
  return <main className="shell ops-shell catalog-hub"><header className="catalog-header"><div><p className="eyebrow">DANH MỤC · CHI TIẾT DỊCH VỤ</p><h1>{name}</h1><p className="hint">Chi tiết cấu hình được tổng hợp từ dịch vụ và các quan hệ đã lưu trong hệ thống.</p></div><a className="catalog-link" href="/admin/catalog/services">Quay lại danh mục</a></header>{state === "loading" ? <div className="catalog-state" role="status" aria-busy="true">Đang tải chi tiết dịch vụ…</div> : null}{state === "forbidden" || state === "error" ? <div className="catalog-state" role="alert"><h2>{state === "forbidden" ? "Không có quyền truy cập" : "Không thể tải dữ liệu"}</h2><p>{error}</p><button onClick={() => void load()}>Thử lại</button></div> : null}{state === "ready" && service ? <><section className="catalog-detail-hero"><div><p className="catalog-inspector-kicker">DỊCH VỤ ĐANG XEM</p><h2>{name}</h2><p>{rowCode(service)} · {statusLabel(service.status ?? "ACTIVE")}</p></div><div className="catalog-detail-badge">{service.defaultDurationMin ?? "—"} phút</div></section><section className="catalog-detail-grid"><article><p className="catalog-inspector-kicker">THÔNG TIN CHUNG</p><dl><div><dt>Mã nội bộ</dt><dd>{rowCode(service)}</dd></div><div><dt>Thời lượng</dt><dd>{service.defaultDurationMin ?? "—"} phút</dd></div><div><dt>Phiên bản</dt><dd>{service.version ?? "—"}</dd></div><div><dt>Cập nhật</dt><dd>{dateValue(service.updatedAt ?? service.createdAt)}</dd></div></dl></article>{(["prices", "skills", "resources", "addons"] as const).map((key) => <article key={key}><p className="catalog-inspector-kicker">{({ prices: "BẢNG GIÁ", skills: "KỸ NĂNG", resources: "TÀI NGUYÊN", addons: "DỊCH VỤ BỔ SUNG" } as Record<string, string>)[key]}</p><strong className="catalog-detail-number">{related[key]?.length ?? 0}</strong><span className="catalog-detail-copy">mục được trả về từ API</span>{related[key]?.length ? <ul className="catalog-mini-list">{related[key].slice(0, 5).map((item, index) => <li key={idOf(item, index)}>{localized(item.name) || item.code || item.displayName || "Bản ghi liên quan"}</li>)}</ul> : <p className="catalog-detail-empty">Chưa có dữ liệu liên quan.</p>}</article>)}</section><div className="catalog-safety-note"><strong>Thay đổi có kiểm soát</strong><span>Giá, kỹ năng và tài nguyên được quản lý bởi domain tương ứng; màn hình này chỉ đọc dữ liệu đã được máy chủ xác nhận.</span></div></> : null}</main>;
}

export default function CatalogHub({ pathname }: { pathname: string }) {
  const serviceDetail = pathname.match(/^\/admin\/catalog\/services\/([^/]+)$/);
  if (serviceDetail && serviceDetail[1] !== "new") return <ServiceDetailHub id={serviceDetail[1]!} />;
  const isCreate = pathname.endsWith("/new");
  const pathParts = pathname.split("/").filter(Boolean);
  const slug = isCreate ? pathParts.at(-2) ?? "services" : pathParts.at(-1) ?? "services";
  const kind = (Object.prototype.hasOwnProperty.call(catalogMeta, slug) ? slug : "services") as CatalogKind;
  return isCreate ? <CatalogCreateForm kind={kind} /> : <CatalogList kind={kind} />;
}

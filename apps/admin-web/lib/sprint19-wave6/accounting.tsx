"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useState } from "react";
import { Button, Card, PageHeader, StatePanel } from "@nailsoft/ui-web";
import {
  FieldForm,
  Status,
  commandApi,
  formatMinor,
  readApi,
  rowsFrom,
  wave6Area,
  wave6Error,
  type AsyncState,
  type Column,
} from "./shared";
import type { Wave6Route } from "./routes";

type Resource = { state: AsyncState; rows: any[]; raw: any; error: string; reload: () => void };

function valueFrom(row: any, ...keys: string[]) {
  for (const key of keys) {
    const value = key.split(".").reduce((current, part) => current == null ? undefined : current[part], row);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function textFrom(value: any, fallback = "Chưa có dữ liệu") {
  if (value && typeof value === "object") return String(value.name ?? value.code ?? value.label ?? fallback);
  return value == null || value === "" ? fallback : String(value);
}

function dateFrom(value: any) {
  if (!value) return "—";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function moneyFrom(value: any, row: any, fallbackCurrency = "VND") {
  return formatMinor(value, String(valueFrom(row, "currency", "functionalCurrency", "functional_currency") ?? fallbackCurrency));
}

function useResource(endpoint: string | null): Resource {
  const [state, setState] = useState<AsyncState>(endpoint ? "loading" : "empty");
  const [rows, setRows] = useState<any[]>([]);
  const [raw, setRaw] = useState<any>(null);
  const [error, setError] = useState("");
  const reload = useCallback(() => {
    if (!endpoint) {
      setState("empty");
      setRows([]);
      setRaw(null);
      return;
    }
    setState("loading");
    setError("");
    void readApi(endpoint).then((value) => {
      setRaw(value);
      const next = rowsFrom(value);
      setRows(next);
      setState(next.length || (value && typeof value === "object" && !Array.isArray(value)) ? "ready" : "empty");
    }).catch((cause: any) => {
      setError(wave6Error(cause?.message ?? "Không thể tải dữ liệu kế toán."));
      setState(cause?.forbidden ? "forbidden" : (typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error"));
    });
  }, [endpoint]);
  useEffect(() => { reload(); }, [reload]);
  return { state, rows, raw, error, reload };
}

function useBookContext() {
  const resource = useResource("/v1/accounting/books");
  const [bookId, setBookId] = useState("");
  useEffect(() => {
    setBookId((current) => resource.rows.some((book) => String(book.id) === current) ? current : resource.rows.length === 1 ? String(resource.rows[0]?.id ?? "") : "");
  }, [resource.rows]);
  return { ...resource, bookId, selectBook: setBookId };
}

function AccountingFrame({ route, title, description, children, onReload, loading = false }: { route: Wave6Route; title: string; description: string; children: React.ReactNode; onReload?: () => void; loading?: boolean }) {
  return <main className="shell ops-shell ns-accounting-resource">
    <PageHeader eyebrow={`NailSoft · ${wave6Area(route.area)}`} title={title} description={description} actions={onReload ? <Button variant="secondary" onClick={onReload} disabled={loading}>Làm mới</Button> : undefined} />
    {children}
  </main>;
}

function BookSelector({ books, bookId, onChange }: { books: any[]; bookId: string; onChange: (value: string) => void }) {
  return <Card className="ns-accounting-book-selector"><label htmlFor="accounting-book-select">Sổ kế toán<select id="accounting-book-select" value={bookId} onChange={(event) => onChange(event.target.value)}><option value="">Chọn sổ được cấp quyền…</option>{books.map((book) => <option key={String(book.id)} value={String(book.id)}>{textFrom(valueFrom(book, "name"), textFrom(valueFrom(book, "code"), "Sổ kế toán"))}</option>)}</select></label><p className="hint">Dữ liệu chỉ được đọc trong sổ kế toán mà phiên hiện tại được cấp quyền.</p></Card>;
}

function ResourceState({ resource, title, emptyDetail, onRetry }: { resource: Resource; title: string; emptyDetail: string; onRetry: () => void }) {
  if (resource.state === "loading") return <StatePanel state="loading" title={`Đang tải ${title.toLowerCase()}`} detail="Dữ liệu kế toán được đọc trực tiếp từ máy chủ." />;
  if (resource.state === "forbidden") return <StatePanel state="forbidden" title="Không có quyền truy cập" detail={resource.error} onRetry={onRetry} />;
  if (resource.state === "offline") return <StatePanel state="offline" title="Đang ngoại tuyến" detail="Dữ liệu kế toán có thể chưa phải mới nhất. Không xếp hàng thao tác khi mất mạng." onRetry={onRetry} />;
  if (resource.state === "error") return <StatePanel state="error" title={`Không thể tải ${title.toLowerCase()}`} detail={resource.error} onRetry={onRetry} />;
  if (resource.state === "empty") return <StatePanel state="empty" title={`Chưa có ${title.toLowerCase()}`} detail={emptyDetail} />;
  return null;
}

function SourceTable({ title, rows, columns, currency = "VND" }: { title: string; rows: any[]; columns: Column[]; currency?: string }) {
  return <Card className="ns-accounting-resource-table"><header><div><p className="eyebrow">BẰNG CHỨNG TỪ API</p><h2>{title}</h2><p>{rows.length} bản ghi trong phạm vi được cấp quyền.</p></div><span className="ns-accounting-scope">Nguồn máy chủ</span></header><div className="ns-accounting-resource-scroll"><table><caption className="sr-only">{title}</caption><thead><tr>{columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? row.reference ?? index)}>{columns.map((column) => { const value = valueFrom(row, column.key); return <td key={column.key} data-label={column.label}>{column.status ? <Status value={value} /> : column.money ? moneyFrom(value, row, currency) : /At$|Date$|_at$|_on$|date/i.test(column.key) ? dateFrom(value) : /Id$|_id$|^id$/i.test(column.key) ? <span className="ns-sensitive-reference" title={String(value ?? "")}>{value ? "Mã hệ thống" : "—"}</span> : textFrom(value, "—")}</td>; })}</tr>)}</tbody></table></div></Card>;
}

function BooksWorkspace({ route }: { route: Wave6Route }) {
  const resource = useBookContext();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  async function activate(row: any) {
    setBusy(String(row.id)); setMessage("");
    try { await commandApi(`/v1/accounting/books/${row.id}/activate`, { version: row.version }, `accounting-book:activate:${row.id}:${row.version ?? 0}`); await resource.reload(); setMessage("Sổ đã được máy chủ xác nhận và tải lại."); }
    catch (cause: any) { setMessage(cause?.message ?? "Không thể kích hoạt sổ."); }
    finally { setBusy(""); }
  }
  return <AccountingFrame route={route} title="Sổ kế toán & hệ thống tài khoản" description="Quản lý các sổ chức năng, tiền tệ và trạng thái cấu hình trước khi ghi nhận nghiệp vụ." onReload={resource.reload} loading={resource.state === "loading"}>
    {resource.state !== "loading" && resource.state !== "error" && resource.state !== "forbidden" && resource.state !== "offline" && resource.rows.length > 0 && <BookSelector books={resource.rows} bookId={resource.bookId} onChange={resource.selectBook} />}
    <ResourceState resource={resource} title="sổ kế toán" emptyDetail="Chưa có sổ kế toán trong tenant hiện tại." onRetry={resource.reload} />
    {message && <p role="status" className="ns-gallery-banner">{message}</p>}
    {(resource.state === "ready" || resource.state === "empty") && <><section className="ns-accounting-resource-kpis"><article><span>Tổng số sổ</span><strong>{resource.rows.length}</strong><small>Đọc từ accounting_books</small></article><article><span>Đang hoạt động</span><strong>{resource.rows.filter((row) => String(valueFrom(row, "status") ?? "").toUpperCase() === "ACTIVE").length}</strong><small>Trạng thái máy chủ</small></article><article><span>Cấu hình chưa hoàn tất</span><strong>{resource.rows.filter((row) => String(valueFrom(row, "configurationStatus", "configuration_status") ?? "").toUpperCase() !== "ACTIVE").length}</strong><small>Cần rà soát trước khi dùng</small></article></section><FieldForm title="Tạo sổ kế toán" fields={[{ name: "code", label: "Mã sổ", required: true }, { name: "name", label: "Tên sổ", required: true }, { name: "currency", label: "Tiền tệ chức năng", required: true }, { name: "timezone", label: "Múi giờ", required: true }]} onSubmit={async (values) => { await commandApi("/v1/accounting/books", { code: values.code, name: values.name, functionalCurrency: values.currency, timezone: values.timezone }, `accounting-book:create:${values.code}:${values.currency}`); await resource.reload(); }} note="Tạo sổ không tự kích hoạt posting. Máy chủ còn kiểm tra kỳ, hệ thống tài khoản và checklist cấu hình." /><SourceTable title="Danh mục sổ kế toán" rows={resource.rows} columns={[{ key: "code", label: "Mã sổ" }, { key: "name", label: "Tên sổ" }, { key: "functionalCurrency", label: "Tiền tệ" }, { key: "status", label: "Trạng thái", status: true }, { key: "configurationStatus", label: "Cấu hình", status: true }, { key: "postingMode", label: "Chế độ ghi sổ" }]} /><Card className="ns-accounting-resource-note"><strong>Kiểm soát kích hoạt</strong><p>Sổ chỉ được kích hoạt khi máy chủ xác nhận kỳ kế toán, hệ thống tài khoản và checklist sẵn sàng.</p><div>{resource.rows.filter((row) => ["DRAFT", "CONFIGURING"].includes(String(valueFrom(row, "status") ?? "").toUpperCase())).map((row) => <span key={row.id}><span>{textFrom(valueFrom(row, "name", "code"), "Sổ kế toán")}</span><Button variant="secondary" disabled={busy === String(row.id)} onClick={() => void activate(row)}>{busy === String(row.id) ? "Đang kiểm tra…" : "Kích hoạt"}</Button></span>)}</div></Card>{resource.state === "ready" && resource.bookId && <AccountsContent context={resource} />}</>}
  </AccountingFrame>;
}

function BookScoped({ route, title, description, children }: { route: Wave6Route; title: string; description: string; children: (context: ReturnType<typeof useBookContext>) => React.ReactNode }) {
  const context = useBookContext();
  return <AccountingFrame route={route} title={title} description={description} onReload={context.reload} loading={context.state === "loading"}>
    {context.state !== "loading" && context.state !== "error" && context.state !== "forbidden" && context.state !== "offline" && context.rows.length > 0 && <BookSelector books={context.rows} bookId={context.bookId} onChange={context.selectBook} />}
    <ResourceState resource={context} title="sổ kế toán" emptyDetail="Tạo hoặc cấp quyền cho một sổ kế toán trước khi mở màn hình này." onRetry={context.reload} />
    {context.state === "ready" && !context.bookId && <StatePanel state="empty" title="Chọn sổ kế toán" detail="Chọn một sổ được cấp quyền để tải dữ liệu đúng phạm vi." />}
    {context.state === "ready" && context.bookId ? children(context) : null}
  </AccountingFrame>;
}

function AccountsContent({ context }: { context: ReturnType<typeof useBookContext> }) {
  const resource = useResource(`/v1/accounting/accounts?bookId=${encodeURIComponent(context.bookId)}`);
  const [message, setMessage] = useState("");
  async function deactivate(row: any) { setMessage(""); try { await commandApi(`/v1/accounting/accounts/${row.id}/deactivate`, { version: row.version, reason: "Ngừng sử dụng theo kiểm soát kế toán" }, `accounting-account:deactivate:${row.id}:${row.version ?? 0}`); await resource.reload(); } catch (cause: any) { setMessage(cause?.message ?? "Không thể ngừng tài khoản."); } }
  return <><ResourceState resource={resource} title="tài khoản kế toán" emptyDetail="Sổ này chưa có tài khoản kế toán trong phạm vi được cấp quyền." onRetry={resource.reload} />{message && <p className="error" role="alert">{message}</p>}{(resource.state === "ready" || resource.state === "empty") && <><section className="ns-accounting-resource-kpis"><article><span>Tổng tài khoản</span><strong>{resource.rows.length}</strong><small>Trong sổ đã chọn</small></article><article><span>Đang sử dụng</span><strong>{resource.rows.filter((row) => valueFrom(row, "active") !== false).length}</strong><small>Được phép hạch toán</small></article><article><span>Đã ngừng</span><strong>{resource.rows.filter((row) => valueFrom(row, "active") === false).length}</strong><small>Không nhận nghiệp vụ mới</small></article></section><FieldForm title="Thêm tài khoản kế toán" fields={[{ name: "bookId", label: "Sổ kế toán", required: true, readOnly: true }, { name: "code", label: "Mã tài khoản", required: true }, { name: "name", label: "Tên tài khoản", required: true }, { name: "accountType", label: "Loại tài khoản", required: true, options: ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE", "CONTRA_ASSET", "CONTRA_LIABILITY", "CONTRA_REVENUE"] }]} initialValues={{ bookId: context.bookId }} onSubmit={async (values) => { await commandApi("/v1/accounting/accounts", { bookId: context.bookId, code: values.code, name: values.name, accountType: values.accountType }, `accounting-account:create:${context.bookId}:${values.code}`); await resource.reload(); }} note="Không nhập ID sổ thủ công; sổ đang chọn được gửi cùng lệnh máy chủ." /><SourceTable title="Hệ thống tài khoản" rows={resource.rows} columns={[{ key: "code", label: "Mã tài khoản" }, { key: "name", label: "Tên tài khoản" }, { key: "accountType", label: "Loại" }, { key: "controlClass", label: "Nhóm kiểm soát" }, { key: "active", label: "Hoạt động" }, { key: "version", label: "Phiên bản" }]} /><Card className="ns-accounting-resource-note"><strong>Thao tác được kiểm soát</strong><p>Tài khoản đã ngừng không bị xóa khỏi lịch sử. Chỉ tài khoản đang hoạt động mới có thể nhận nghiệp vụ mới.</p><div>{resource.rows.filter((row) => valueFrom(row, "active") !== false).slice(0, 12).map((row) => <span key={row.id}><span>{textFrom(valueFrom(row, "code", "name"), "Tài khoản")}</span><Button variant="secondary" onClick={() => void deactivate(row)}>Ngừng sử dụng</Button></span>)}</div></Card></>}
  </>;
}

function PeriodsWorkspace({ route }: { route: Wave6Route }) { return <BookScoped route={route} title="Kỳ kế toán" description="Theo dõi vòng đời kỳ, yêu cầu khóa và phê duyệt mở lại theo kiểm soát kép.">{(context) => <PeriodsContent context={context} />}</BookScoped>; }

function PeriodsContent({ context }: { context: ReturnType<typeof useBookContext> }) {
  const resource = useResource(`/v1/accounting/periods?bookId=${encodeURIComponent(context.bookId)}`);
  const [message, setMessage] = useState("");
  const transitions: Record<string, Array<{ label: string; target: string }>> = { FUTURE: [{ label: "Mở kỳ", target: "open" }], OPEN: [{ label: "Khóa mềm", target: "soft-close" }], SOFT_CLOSED: [{ label: "Yêu cầu khóa", target: "request-close" }], PENDING_CLOSE: [{ label: "Phê duyệt khóa", target: "approve-close" }], CLOSED: [{ label: "Yêu cầu mở lại", target: "request-reopen" }], REOPEN_PENDING: [{ label: "Phê duyệt mở lại", target: "approve-reopen" }] };
  async function transition(row: any, target: string) { setMessage(""); try { await commandApi(`/v1/accounting/periods/${row.id}/${target}`, { version: row.version, reason: `Thao tác kỳ kế toán: ${target}` }, `accounting-period:${target}:${row.id}:${row.version ?? 0}`); await resource.reload(); } catch (cause: any) { setMessage(cause?.message ?? "Không thể chuyển trạng thái kỳ."); } }
  return <><ResourceState resource={resource} title="kỳ kế toán" emptyDetail="Sổ này chưa có kỳ kế toán." onRetry={resource.reload} />{message && <p className="error" role="alert">{message}</p>}{(resource.state === "ready" || resource.state === "empty") && <><section className="ns-accounting-resource-kpis"><article><span>Tổng kỳ</span><strong>{resource.rows.length}</strong><small>Do máy chủ trả về</small></article><article><span>Đang mở</span><strong>{resource.rows.filter((row) => ["OPEN", "REOPENED"].includes(String(valueFrom(row, "state", "status") ?? "").toUpperCase())).length}</strong><small>Có thể ghi sổ</small></article><article><span>Chờ phê duyệt</span><strong>{resource.rows.filter((row) => ["PENDING_CLOSE", "REOPEN_PENDING"].includes(String(valueFrom(row, "state", "status") ?? "").toUpperCase())).length}</strong><small>Kiểm soát kép</small></article></section><FieldForm title="Tạo kỳ kế toán" fields={[{ name: "bookId", label: "Sổ kế toán", required: true, readOnly: true }, { name: "code", label: "Mã kỳ", required: true }, { name: "startsOn", label: "Bắt đầu", required: true, type: "date" }, { name: "endsOn", label: "Kết thúc", required: true, type: "date" }, { name: "yearNo", label: "Năm tài chính", type: "number" }]} initialValues={{ bookId: context.bookId }} onSubmit={async (values) => { await commandApi("/v1/accounting/periods", { bookId: context.bookId, code: values.code, startsOn: values.startsOn, endsOn: values.endsOn, yearNo: values.yearNo ? Number(values.yearNo) : undefined }, `accounting-period:create:${context.bookId}:${values.code}`); await resource.reload(); }} note="Kỳ mới bắt đầu ở trạng thái FUTURE; việc mở và khóa kỳ vẫn theo state machine máy chủ." /><SourceTable title="Vòng đời kỳ kế toán" rows={resource.rows} columns={[{ key: "code", label: "Mã kỳ" }, { key: "startsOn", label: "Từ ngày" }, { key: "endsOn", label: "Đến ngày" }, { key: "state", label: "Trạng thái", status: true }, { key: "version", label: "Phiên bản" }]} /><Card className="ns-accounting-resource-note"><strong>Kiểm soát kép và phiên bản</strong><p>Yêu cầu khóa/mở lại cần lý do và người phê duyệt độc lập. Trạng thái không hợp lệ sẽ bị máy chủ từ chối.</p><div>{resource.rows.flatMap((row) => { const state = String(valueFrom(row, "state", "status") ?? "").toUpperCase(); return (transitions[state] ?? []).map((action) => <span key={`${row.id}:${action.target}`}><span>{textFrom(valueFrom(row, "code"), "Kỳ kế toán")}</span><Button variant="secondary" onClick={() => void transition(row, action.target)}>{action.label}</Button></span>); })}</div></Card></>}
  </>;
}

function JournalsWorkspace({ route }: { route: Wave6Route }) { return <BookScoped route={route} title="Sổ nhật ký" description="Tạo bút toán cân bằng, gửi duyệt, ghi sổ và theo dõi lịch sử bất biến theo kỳ.">{(context) => <JournalsContent context={context} />}</BookScoped>; }

function JournalsContent({ context }: { context: ReturnType<typeof useBookContext> }) {
  const resource = useResource(`/v1/accounting/journals?bookId=${encodeURIComponent(context.bookId)}`);
  const periods = useResource(`/v1/accounting/periods?bookId=${encodeURIComponent(context.bookId)}`);
  const accounts = useResource(`/v1/accounting/accounts?bookId=${encodeURIComponent(context.bookId)}`);
  const [message, setMessage] = useState("");
  async function transition(row: any, target: string) { setMessage(""); try { await commandApi(`/v1/accounting/journals/${row.id}/${target}`, { version: row.version, reason: `Thao tác sổ nhật ký: ${target}` }, `accounting-journal:${target}:${row.id}:${row.version ?? 0}`); await resource.reload(); } catch (cause: any) { setMessage(cause?.message ?? "Không thể chuyển trạng thái sổ nhật ký."); } }
  const options = (state: string) => state === "DRAFT" ? [{ label: "Gửi duyệt", target: "submit" }] : state === "PENDING_APPROVAL" ? [{ label: "Phê duyệt", target: "approve" }, { label: "Từ chối", target: "reject" }] : state === "APPROVED" ? [{ label: "Ghi sổ", target: "post" }] : state === "POSTED" ? [{ label: "Yêu cầu đảo bút toán", target: "request-reversal" }] : [];
  const accountOptions = accounts.rows.map((row) => ({ value: String(row.id), label: `${textFrom(valueFrom(row, "code"), "Mã tài khoản")} · ${textFrom(valueFrom(row, "name"), "Tài khoản")}` }));
  const periodOptions = periods.rows.filter((row) => ["OPEN", "REOPENED"].includes(String(valueFrom(row, "state", "status") ?? "").toUpperCase())).map((row) => ({ value: String(row.id), label: textFrom(valueFrom(row, "code"), "Kỳ đang mở") }));
  return <><ResourceState resource={resource} title="sổ nhật ký" emptyDetail="Chưa có sổ nhật ký trong sổ kế toán này." onRetry={resource.reload} />{message && <p className="error" role="alert">{message}</p>}{resource.state === "ready" && <><section className="ns-accounting-resource-kpis"><article><span>Tổng nhật ký</span><strong>{resource.rows.length}</strong><small>Giới hạn tải theo API hiện tại</small></article><article><span>Chờ phê duyệt</span><strong>{resource.rows.filter((row) => valueFrom(row, "state") === "PENDING_APPROVAL").length}</strong><small>Người tạo không tự phê duyệt</small></article><article><span>Đã ghi sổ</span><strong>{resource.rows.filter((row) => valueFrom(row, "state") === "POSTED").length}</strong><small>Không sửa trực tiếp</small></article></section>{periods.state === "ready" && accounts.state === "ready" && <FieldForm title="Tạo bút toán cân bằng" fields={[{ name: "bookId", label: "Sổ kế toán", required: true, readOnly: true }, { name: "periodId", label: "Kỳ đang mở", required: true, options: periodOptions }, { name: "accountingDate", label: "Ngày hạch toán", required: true, type: "date" }, { name: "currency", label: "Tiền tệ", required: true, readOnly: true }, { name: "debitAccountId", label: "Tài khoản ghi nợ", required: true, options: accountOptions }, { name: "creditAccountId", label: "Tài khoản ghi có", required: true, options: accountOptions }, { name: "amountMinor", label: "Số tiền (minor)", required: true, type: "number" }]} initialValues={{ bookId: context.bookId, currency: textFrom(valueFrom(context.rows.find((book) => String(book.id) === context.bookId), "functionalCurrency", "functional_currency", "currency"), "VND") }} onSubmit={async (values) => { await commandApi("/v1/accounting/journals", { bookId: context.bookId, periodId: values.periodId, journalType: "MANUAL", accountingDate: values.accountingDate, currency: values.currency, lines: [{ accountId: values.debitAccountId, debitMinor: values.amountMinor, creditMinor: "0" }, { accountId: values.creditAccountId, debitMinor: "0", creditMinor: values.amountMinor }] }, `accounting-journal:create:${context.bookId}:${values.periodId}:${values.debitAccountId}:${values.creditAccountId}:${values.amountMinor}`); await resource.reload(); }} note="Bút toán chỉ được tạo khi có hai tài khoản thật và tổng ghi nợ bằng tổng ghi có. Gửi duyệt và ghi sổ là các bước riêng." />}</>}{(resource.state === "ready" || resource.state === "empty") && <><SourceTable title="Nhật ký kế toán" rows={resource.rows} columns={[{ key: "journalNumber", label: "Số nhật ký" }, { key: "journalType", label: "Loại" }, { key: "accountingDate", label: "Ngày hạch toán" }, { key: "currency", label: "Tiền tệ" }, { key: "state", label: "Trạng thái", status: true }, { key: "version", label: "Phiên bản" }]} /><Card className="ns-accounting-resource-note"><strong>Thao tác theo state machine</strong><p>Không có nút bắt đầu hoặc hoàn tất giả trên trình duyệt. Mỗi chuyển trạng thái đều dùng version và được máy chủ xác nhận.</p><div>{resource.rows.flatMap((row) => options(String(valueFrom(row, "state") ?? "").toUpperCase()).map((action) => <span key={`${row.id}:${action.target}`}><span>{textFrom(valueFrom(row, "journalNumber", "journalType"), "Sổ nhật ký")}</span><Button variant="secondary" onClick={() => void transition(row, action.target)}>{action.label}</Button></span>))}</div></Card></>}</>;
}

function PostingWorkspace({ route }: { route: Wave6Route }) {
  return <BookScoped route={route} title="Hàng đợi ghi sổ" description="Rà soát sự kiện nguồn đang chờ ghi sổ; mọi bằng chứng và trạng thái đều do Accounting Service cung cấp.">
    {(context) => <PostingContent context={context} />}
  </BookScoped>;
}

function PostingContent({ context }: { context: ReturnType<typeof useBookContext> }) {
  const resource = useResource(`/v1/accounting/posting-candidates?bookId=${encodeURIComponent(context.bookId)}`);
  return <>
    <ResourceState resource={resource} title="hàng đợi ghi sổ" emptyDetail="Không có sự kiện nguồn đang chờ ghi sổ trong sổ này." onRetry={resource.reload} />
    {(resource.state === "ready" || resource.state === "empty") && <>
      <section className="ns-accounting-resource-kpis">
        <article><span>Tổng sự kiện</span><strong>{resource.rows.length}</strong><small>Giới hạn theo API</small></article>
        <article><span>Đang chờ</span><strong>{resource.rows.filter((row) => ["PENDING", "PROCESSING"].includes(String(valueFrom(row, "state", "status") ?? "").toUpperCase())).length}</strong><small>Chưa hoàn tất</small></article>
        <article><span>Đã xử lý</span><strong>{resource.rows.filter((row) => ["POSTED", "IGNORED", "REVERSED"].includes(String(valueFrom(row, "state", "status") ?? "").toUpperCase())).length}</strong><small>Giữ lại bằng chứng</small></article>
      </section>
      <SourceTable title="Sự kiện nguồn chờ ghi sổ" rows={resource.rows} columns={[{ key: "sourceType", label: "Nguồn" }, { key: "sourceEventType", label: "Loại sự kiện" }, { key: "sourceId", label: "Tham chiếu" }, { key: "periodId", label: "Kỳ" }, { key: "state", label: "Trạng thái", status: true }, { key: "createdAt", label: "Ngày tạo" }]} />
      <Card className="ns-accounting-resource-note"><strong>Không ghi sổ thủ công từ bảng</strong><p>Hàng đợi giữ evidence và generation key của source event. Việc tạo source posting phải đi qua contract tương ứng, không nhận UUID tuỳ ý từ giao diện.</p><a className="ns-button ns-button--secondary" href="/admin/accounting/journals">Mở sổ nhật ký</a></Card>
    </>}
  </>;
}

function OpenItemsWorkspace({ route }: { route: Wave6Route }) { return <BookScoped route={route} title="Khoản mục đang mở" description="Theo dõi số dư chưa tất toán và phân bổ vào journal đã ghi sổ bằng chứng thực tế.">{(context) => <OpenItemsContent context={context} />}</BookScoped>; }

function OpenItemsContent({ context }: { context: ReturnType<typeof useBookContext> }) {
  const resource = useResource(`/v1/accounting/open-items?bookId=${encodeURIComponent(context.bookId)}`);
  const journals = useResource(`/v1/accounting/journals?bookId=${encodeURIComponent(context.bookId)}&state=POSTED`);
  const [selected, setSelected] = useState(""); const [amount, setAmount] = useState(""); const [journalId, setJournalId] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const openRows = resource.rows.filter((row) => !["SETTLED", "CLOSED"].includes(String(valueFrom(row, "state", "status") ?? "").toUpperCase()));
  const selectedRow = openRows.find((row) => String(row.id) === selected);
  const journalOptions = journals.rows.filter((row) => String(valueFrom(row, "state", "status") ?? "").toUpperCase() === "POSTED" && (!selectedRow || String(valueFrom(row, "currency")) === String(valueFrom(selectedRow, "currency"))));
  useEffect(() => { setSelected((current) => openRows.some((row) => String(row.id) === current) ? current : String(openRows[0]?.id ?? "")); }, [resource.rows]);
  async function allocate() { if (!selected || !journalId || !amount) return; setBusy(true); setMessage(""); try { await commandApi(`/v1/accounting/open-items/${selected}/allocate`, { amountMinor: amount, settlementJournalId: journalId }, `accounting-open-item:allocate:${selected}:${journalId}:${amount}`); await resource.reload(); setMessage("Phân bổ đã được máy chủ xác nhận và tải lại."); } catch (cause: any) { setMessage(cause?.message ?? "Không thể phân bổ khoản mục."); } finally { setBusy(false); } }
  return <><ResourceState resource={resource} title="khoản mục đang mở" emptyDetail="Không có khoản mục đang mở trong sổ này." onRetry={resource.reload} />{message && <p className="ns-gallery-banner" role="status">{message}</p>}{(resource.state === "ready" || resource.state === "empty") && <><section className="ns-accounting-resource-kpis"><article><span>Tổng khoản mục</span><strong>{resource.rows.length}</strong><small>Do API trả về</small></article><article><span>Còn mở</span><strong>{openRows.length}</strong><small>Chưa tất toán hết</small></article><article><span>Journal đã ghi sổ</span><strong>{journals.rows.length}</strong><small>Dùng làm bằng chứng phân bổ</small></article></section><SourceTable title="Khoản mục chưa tất toán" rows={resource.rows} columns={[{ key: "counterpartyName", label: "Đối tác" }, { key: "documentNumber", label: "Chứng từ" }, { key: "originalMinor", label: "Giá trị gốc", money: true }, { key: "settledMinor", label: "Đã tất toán", money: true }, { key: "currency", label: "Tiền tệ" }, { key: "dueOn", label: "Hạn" }, { key: "state", label: "Trạng thái", status: true }, { key: "version", label: "Phiên bản" }]} /><Card className="ns-accounting-allocation"><p className="eyebrow">PHÂN BỔ CÓ BẰNG CHỨNG</p><h2>Phân bổ vào journal đã ghi sổ</h2><p>Máy chủ kiểm tra khoản còn lại, cùng sổ, cùng tiền tệ và trạng thái POSTED của journal.</p>{openRows.length && journals.state === "ready" ? <div className="ns-accounting-allocation-form"><label>Khoản mục<select value={selected} onChange={(event) => setSelected(event.target.value)}>{openRows.map((row) => <option key={row.id} value={row.id}>{textFrom(valueFrom(row, "documentNumber", "counterpartyName"), "Khoản mục")}</option>)}</select></label><label>Số tiền minor<input type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label>Journal đã ghi sổ<select value={journalId} onChange={(event) => setJournalId(event.target.value)}><option value="">Chọn journal…</option>{journalOptions.map((row) => <option key={row.id} value={row.id}>{textFrom(valueFrom(row, "journalNumber", "id"), "Journal đã ghi sổ")}</option>)}</select></label><Button disabled={busy || !selected || !journalId || !amount} onClick={() => void allocate()}>{busy ? "Đang phân bổ…" : "Phân bổ"}</Button></div> : <p className="hint">Chỉ hiện biểu mẫu khi còn khoản mục mở và đã tải journal POSTED phù hợp.</p>}</Card></>}
  </>;
}

function ReportsWorkspace({ route }: { route: Wave6Route }) { return <BookScoped route={route} title="Báo cáo tài chính" description="Đọc trial balance và general ledger từ các journal đã ghi sổ; trình duyệt không tự tính lại báo cáo.">{(context) => <ReportsContent context={context} />}</BookScoped>; }

function ReportsContent({ context }: { context: ReturnType<typeof useBookContext> }) {
  const periods = useResource(`/v1/accounting/periods?bookId=${encodeURIComponent(context.bookId)}`);
  const [periodId, setPeriodId] = useState("");
  useEffect(() => { setPeriodId((current) => periods.rows.some((row) => String(row.id) === current) ? current : ""); }, [periods.rows]);
  const report = useResource(`/v1/accounting/reports?bookId=${encodeURIComponent(context.bookId)}${periodId ? `&periodId=${encodeURIComponent(periodId)}` : ""}`);
  const trial = Array.isArray(report.raw?.trialBalance) ? report.raw.trialBalance : [];
  const ledger = Array.isArray(report.raw?.generalLedger) ? report.raw.generalLedger : [];
  const selectedBook = context.rows.find((book) => String(book.id) === context.bookId);
  const reportCurrency = textFrom(valueFrom(selectedBook, "functionalCurrency", "functional_currency", "currency"), "VND");
  return <><Card className="ns-accounting-report-selector"><label htmlFor="report-period-select">Kỳ báo cáo<select id="report-period-select" value={periodId} onChange={(event) => setPeriodId(event.target.value)}><option value="">Kỳ mới nhất do máy chủ chọn</option>{periods.rows.map((row) => <option key={row.id} value={row.id}>{textFrom(valueFrom(row, "code"), "Kỳ kế toán")} · {String(valueFrom(row, "state", "status") ?? "")}</option>)}</select></label><p className="hint">Mọi số liệu lấy từ journal POSTED; thay đổi kỳ sẽ tải lại báo cáo từ API.</p></Card><ResourceState resource={report} title="báo cáo tài chính" emptyDetail="Chưa có journal POSTED để tạo báo cáo trong sổ này." onRetry={report.reload} />{report.state === "ready" && <><section className="ns-accounting-resource-kpis"><article><span>Tài khoản trong trial balance</span><strong>{trial.length}</strong><small>Read model do server tạo</small></article><article><span>Journal POSTED</span><strong>{ledger.length}</strong><small>Dòng general ledger đã tải</small></article><article><span>Nguồn báo cáo</span><strong>{textFrom(report.raw?.source, "POSTED_JOURNALS")}</strong><small>{report.raw?.generatedAt ? dateFrom(report.raw.generatedAt) : "Máy chủ chưa trả thời điểm"}</small></article></section><SourceTable title="Trial balance" rows={trial} currency={reportCurrency} columns={[{ key: "code", label: "Mã tài khoản" }, { key: "name", label: "Tên tài khoản" }, { key: "account_type", label: "Loại" }, { key: "opening_debit_minor", label: "Nợ đầu kỳ", money: true }, { key: "opening_credit_minor", label: "Có đầu kỳ", money: true }, { key: "period_debit_minor", label: "Nợ trong kỳ", money: true }, { key: "period_credit_minor", label: "Có trong kỳ", money: true }, { key: "balance_minor", label: "Số dư", money: true }]} /><SourceTable title="General ledger" rows={ledger} currency={reportCurrency} columns={[{ key: "journal_number", label: "Số journal" }, { key: "accounting_date", label: "Ngày hạch toán" }, { key: "journal_type", label: "Loại journal" }, { key: "code", label: "Tài khoản" }, { key: "name", label: "Tên tài khoản" }, { key: "debit_minor", label: "Ghi nợ", money: true }, { key: "credit_minor", label: "Ghi có", money: true }, { key: "currency", label: "Tiền tệ" }]} /><Card className="ns-accounting-resource-note"><strong>Không sửa số liệu báo cáo trên trình duyệt</strong><p>Trial balance và general ledger được tạo từ nguồn {textFrom(report.raw?.source, "POSTED_JOURNALS")}; mọi điều chỉnh phải đi qua journal và quy trình phê duyệt.</p></Card></>}
  </>;
}

function AccountingControlCenter({ route }: { route: Wave6Route }) {
  const books = useResource("/v1/accounting/books");
  const periods = useResource("/v1/accounting/periods");
  const posting = useResource("/v1/accounting/posting-candidates");
  const reports = useResource("/v1/accounting/reports");
  const pending = posting.rows.filter((row) => !["POSTED", "COMPLETED", "CANCELLED", "IGNORED", "REVERSED"].includes(String(valueFrom(row, "state", "status") ?? "").toUpperCase()));
  const openPeriods = periods.rows.filter((row) => ["OPEN", "ACTIVE", "REOPENED"].includes(String(valueFrom(row, "state", "status") ?? "").toUpperCase()));
  const allForbidden = [books, periods, posting, reports].every((resource) => resource.state === "forbidden");
  return <AccountingFrame route={route} title="Trung tâm kiểm soát kế toán" description="Theo dõi sổ, kỳ kế toán, hàng đợi ghi sổ và các điểm cần rà soát từ nguồn dữ liệu chính thức." onReload={() => { books.reload(); periods.reload(); posting.reload(); reports.reload(); }} loading={[books, periods, posting, reports].some((resource) => resource.state === "loading")}>
    {allForbidden && <StatePanel state="forbidden" title="Không có quyền truy cập" detail="Bạn không có quyền xem trung tâm kế toán trong phạm vi hiện tại." />}
    {!allForbidden && <><section className="ns-accounting-resource-kpis"><article><span>Sổ đang quản lý</span><strong>{books.state === "ready" ? books.rows.length : "—"}</strong><small>Danh mục sổ</small></article><article><span>Kỳ đang mở</span><strong>{periods.state === "ready" ? openPeriods.length : "—"}</strong><small>State máy chủ</small></article><article><span>Chờ ghi sổ</span><strong>{posting.state === "ready" ? pending.length : "—"}</strong><small>Không tính khi API lỗi</small></article><article><span>Báo cáo đã tải</span><strong>{reports.state === "ready" ? "Có" : "—"}</strong><small>Trial balance / ledger</small></article></section><section className="ns-accounting-control-grid"><Card><p className="eyebrow">SỔ & KỲ</p><h2>Trạng thái sổ kế toán</h2><p>Kiểm tra kỳ hiện tại trước khi ghi sổ hoặc yêu cầu khóa kỳ.</p><ul>{books.rows.slice(0, 5).map((row, index) => <li key={String(row.id ?? index)}><span><strong>{textFrom(valueFrom(row, "name", "code"), "Sổ kế toán")}</strong><small>{textFrom(valueFrom(row, "functionalCurrency", "functional_currency", "currency"), "Không rõ tiền tệ")}</small></span><Status value={valueFrom(row, "status", "state")} /></li>)}</ul><a className="ns-button ns-button--secondary" href="/admin/accounting/books">Mở danh mục sổ</a></Card><Card><p className="eyebrow">CÔNG VIỆC CẦN XỬ LÝ</p><h2>Hàng đợi ghi sổ</h2><p>Chỉ hiển thị các sự kiện có bằng chứng từ API kế toán.</p><ul>{posting.rows.slice(0, 5).map((row, index) => <li key={String(row.id ?? index)}><span><strong>{textFrom(valueFrom(row, "sourceType", "source_event_type"), "Sự kiện nguồn")}</strong><small>{dateFrom(valueFrom(row, "createdAt", "created_at"))}</small></span><Status value={valueFrom(row, "state", "status")} /></li>)}</ul><a className="ns-button ns-button--secondary" href="/admin/accounting/posting-candidates">Mở hàng đợi</a></Card></section><Card className="ns-accounting-resource-note"><strong>Nguyên tắc bất biến</strong><p>Bút toán đã ghi sổ không được sửa trực tiếp. Mọi thao tác chuyển trạng thái đều cần phiên bản, quyền phù hợp và xác nhận từ máy chủ.</p><a className="ns-button ns-button--secondary" href="/admin/accounting/reports">Mở báo cáo</a></Card></>}
  </AccountingFrame>;
}

export default function AccountingWorkspace({ route }: { route: Wave6Route }) {
  if (route.href === "/admin/accounting") return <AccountingControlCenter route={route} />;
  if (route.screenId === "19.6.2") return <BooksWorkspace route={route} />;
  if (route.screenId === "19.6.3") return <PeriodsWorkspace route={route} />;
  if (route.screenId === "19.6.4") return <JournalsWorkspace route={route} />;
  if (route.screenId === "19.6.5") return <PostingWorkspace route={route} />;
  if (route.screenId === "19.6.6") return <OpenItemsWorkspace route={route} />;
  if (route.screenId === "19.6.7") return <ReportsWorkspace route={route} />;
  return <BooksWorkspace route={route} />;
}

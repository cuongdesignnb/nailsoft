"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState, type ReactNode } from "react";
import { Button, Card, PageHeader, StatePanel } from "@nailsoft/ui-web";
import { FieldForm, Status, commandApi, formatMinor, readApi, rowsFrom, wave6Error, wave6Text, wave6Title, type AsyncState, type Column } from "./shared";
import type { Wave6Route } from "./routes";

const accountColumns: Column[] = [{ key: "name", label: "Tài khoản ngân hàng" }, { key: "institutionName", label: "Ngân hàng" }, { key: "currency", label: "Tiền tệ" }, { key: "status", label: "Trạng thái", status: true }];
const lineColumns: Column[] = [{ key: "transactionDate", label: "Ngày giao dịch" }, { key: "description", label: "Mô tả" }, { key: "reference", label: "Tham chiếu" }, { key: "amountMinor", label: "Số tiền", money: true }, { key: "currency", label: "Tiền tệ" }, { key: "matchState", label: "Trạng thái khớp", status: true }, { key: "version", label: "Phiên bản" }];
const snapshotColumns: Column[] = [{ key: "statementDate", label: "Ngày sao kê" }, { key: "status", label: "Trạng thái", status: true }, { key: "closingBalanceMinor", label: "Số dư cuối kỳ", money: true }, { key: "createdAt", label: "Ngày tạo" }];

type BookContext = {
  books: any[];
  bookId: string;
  state: AsyncState;
  message: string;
  selectBook: (bookId: string) => void;
};

type BookResources = {
  bankAccounts: any[];
  accounts: any[];
  state: AsyncState;
  message: string;
  loadedFor?: string;
};

export default function BankingWorkspace({ route }: { route: Wave6Route }) {
  if (route.screenId === "19.6.8") return <BankAccountsWorkspace route={route} />;
  if (route.screenId === "19.6.10") return <ReconciliationExceptionsWorkspace route={route} />;
  if (route.screenId === "19.6.11") return <StatementSnapshotsWorkspace route={route} />;
  return <StatementMatching route={route} />;
}

function useAccountingBooks(): BookContext {
  const [books, setBooks] = useState<any[]>([]);
  const [bookId, setBookId] = useState("");
  const [state, setState] = useState<AsyncState>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    setState("loading");
    setMessage("");
    void readApi("/v1/accounting/books").then((value) => {
      if (!active) return;
      const next = rowsFrom(value);
      setBooks(next);
      setBookId((current) => {
        if (next.length === 1) return String(next[0]?.id ?? "");
        return current && next.some((book) => String(book.id) === current) ? current : "";
      });
      setState(next.length ? "ready" : "empty");
    }).catch((error: any) => {
      if (!active) return;
      setMessage(wave6Error(error?.message ?? "Không thể tải sổ kế toán."));
      setState(error?.forbidden ? "forbidden" : (typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error"));
    });
    return () => { active = false; };
  }, []);

  function selectBook(nextBookId: string) {
    setBookId(books.some((book) => String(book.id) === nextBookId) ? nextBookId : "");
  }

  return { books, bookId, state, message, selectBook };
}

function useBookResources(bookId: string): BookResources {
  const [resources, setResources] = useState<BookResources>({ bankAccounts: [], accounts: [], state: "empty", message: "" });

  useEffect(() => {
    let active = true;
    if (!bookId) {
      setResources({ bankAccounts: [], accounts: [], state: "empty", message: "" });
      return () => { active = false; };
    }
    setResources({ bankAccounts: [], accounts: [], state: "loading", message: "" });
    void Promise.all([
      readApi(`/v1/accounting/bank-accounts?bookId=${encodeURIComponent(bookId)}`),
      readApi(`/v1/accounting/accounts?bookId=${encodeURIComponent(bookId)}`),
    ]).then(([bankAccounts, accounts]) => {
      if (!active) return;
      setResources({ bankAccounts: rowsFrom(bankAccounts), accounts: rowsFrom(accounts), state: "ready", message: "", loadedFor: bookId });
    }).catch((error: any) => {
      if (!active) return;
      setResources({ bankAccounts: [], accounts: [], state: error?.forbidden ? "forbidden" : (typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error"), message: wave6Error(error?.message ?? "Không thể tải dữ liệu sổ kế toán."), loadedFor: bookId });
    });
    return () => { active = false; };
  }, [bookId]);

  return resources;
}

function BankingFrame({ route, children }: { route: Wave6Route; children: ReactNode }) {
  return <main className="shell ops-shell ns-banking-workspace"><PageHeader eyebrow="NailSoft · NGÂN HÀNG" title={wave6Title(route.title)} description={wave6Text(route.description)} />{children}</main>;
}

function BookSelector({ context }: { context: BookContext }) {
  if (context.state !== "ready" || !context.books.length) return null;
  const multiple = context.books.length > 1;
  return <Card className="ns-selector-card"><label htmlFor="accounting-book-select">Sổ kế toán<select id="accounting-book-select" aria-label="Sổ kế toán" value={context.bookId} onChange={(event) => context.selectBook(event.target.value)}>{multiple && <option value="">Chọn sổ kế toán</option>}{context.books.map((book) => <option key={book.id} value={book.id}>{book.name ?? book.code ?? "Sổ kế toán được cấp quyền"}</option>)}</select></label><p className="hint">Dữ liệu ngân hàng chỉ được tải cho sổ kế toán đã được cấp quyền.</p></Card>;
}

function BookContextGate({ route, context, detail }: { route: Wave6Route; context: BookContext; detail?: string | undefined }) {
  return <BankingFrame route={route}>
    {context.state === "ready" && <BookSelector context={context} />}
    {context.state === "loading" && <StatePanel state="loading" title="Đang tải sổ kế toán" detail="Xác định sổ được cấp quyền trước khi tải dữ liệu ngân hàng." />}
    {context.state === "empty" && <StatePanel state="empty" title="Chưa có sổ kế toán" detail="Tạo hoặc cấp quyền cho một sổ kế toán trước khi xem dữ liệu ngân hàng." />}
    {context.state === "forbidden" && <StatePanel state="forbidden" title="Không có quyền truy cập" detail={wave6Error(context.message)} />}
    {context.state === "offline" && <StatePanel state="offline" title="Cần kết nối mạng" detail={wave6Error(context.message)} />}
    {context.state === "error" && <StatePanel state="error" title="Không thể tải sổ kế toán" detail={wave6Error(context.message)} onRetry={() => window.location.reload()} />}
    {context.state === "ready" && !context.bookId && <StatePanel state="empty" title="Chọn sổ kế toán" detail={detail ?? "Chọn sổ trước khi tải tài khoản ngân hàng, dòng sao kê hoặc tài khoản đối ứng."} />}
  </BankingFrame>;
}

function BookResourcesGate({ route, context, resources, detail }: { route: Wave6Route; context: BookContext; resources: BookResources; detail?: string | undefined }) {
  if (context.state !== "ready" || !context.bookId) return <BookContextGate route={route} context={context} detail={detail} />;
  if (resources.state === "loading" || resources.loadedFor !== context.bookId) return <BankingFrame route={route}><BookSelector context={context} /><StatePanel state="loading" title="Đang tải dữ liệu sổ ngân hàng" detail="Tài khoản ngân hàng và hệ thống tài khoản được giới hạn theo sổ đã chọn." /></BankingFrame>;
  if (resources.state === "forbidden") return <BankingFrame route={route}><BookSelector context={context} /><StatePanel state="forbidden" title="Không có quyền truy cập" detail={wave6Error(resources.message)} /></BankingFrame>;
  if (resources.state === "offline") return <BankingFrame route={route}><BookSelector context={context} /><StatePanel state="offline" title="Cần kết nối mạng" detail={wave6Error(resources.message)} /></BankingFrame>;
  if (resources.state === "error") return <BankingFrame route={route}><BookSelector context={context} /><StatePanel state="error" title="Không thể tải dữ liệu sổ ngân hàng" detail={wave6Error(resources.message)} /></BankingFrame>;
  return null;
}

function BankAccountsWorkspace({ route }: { route: Wave6Route }) {
  const context = useAccountingBooks();
  const resources = useBookResources(context.bookId);
  const gate = BookResourcesGate({ route, context, resources, detail: "Chọn sổ trước khi xem tài khoản ngân hàng." });
  if (gate) return gate;
  return <BankingFrame route={route}><BookSelector context={context} /><section className="ns-banking-kpis" aria-label="Tóm tắt tài khoản ngân hàng"><article><span>Tài khoản ngân hàng</span><strong>{resources.bankAccounts.length}</strong><small>Trong sổ đã chọn</small></article><article><span>Đang hoạt động</span><strong>{resources.bankAccounts.filter((row) => String(row.status ?? "").toUpperCase() === "ACTIVE").length}</strong><small>Trạng thái do máy chủ trả về</small></article><article><span>Tài khoản đối ứng</span><strong>{resources.accounts.filter((row) => row.active !== false).length}</strong><small>Dùng khi đối soát cần điều chỉnh</small></article></section>{resources.bankAccounts.length ? <EvidenceTable title="Tài khoản ngân hàng được cấp quyền" columns={accountColumns} rows={resources.bankAccounts} /> : <StatePanel state="empty" title="Chưa có tài khoản ngân hàng" detail="Tạo tài khoản trong sổ kế toán đã chọn trước khi nhập sao kê." />}</BankingFrame>;
}

function bankingValue(row: any, key: string) { return key.split(".").reduce((current, part) => current == null ? undefined : current[part], row); }
function bankingDate(value: unknown) { if (!value) return "—"; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(date); }
function EvidenceTable({ title, columns, rows }: { title: string; columns: Column[]; rows: any[] }) {
  return <Card className="ns-banking-table"><header><div><p className="eyebrow">BẰNG CHỨNG ĐÃ LƯU</p><h2>{title}</h2><p>{rows.length} dòng do API cung cấp; không tính từ dữ liệu mẫu trong trình duyệt.</p></div><span className="ns-banking-scope">Phạm vi kế toán</span></header><div className="ns-banking-table-wrap"><table><caption className="sr-only">{title}</caption><thead><tr>{columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}<th scope="col">Tham chiếu</th></tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? index)}>{columns.map((column) => { const value = bankingValue(row, column.key); return <td key={column.key} data-label={column.label}>{column.status ? <Status value={value} /> : column.money ? formatMinor(value, String(bankingValue(row, "currency") ?? "VND")) : column.key.endsWith("At") || column.key.toLowerCase().includes("date") ? bankingDate(value) : value && typeof value === "object" ? String(value.name ?? value.code ?? "Có dữ liệu") : value ?? "—"}</td>; })}<td><span className="ns-sensitive-reference" title={String(row.id ?? "")}>{row.id ? "Mã hệ thống" : "—"}</span></td></tr>)}</tbody></table></div></Card>;
}

function StatementMatching({ route }: { route: Wave6Route }) {
  const context = useAccountingBooks();
  const resources = useBookResources(context.bookId);
  const [accountId, setAccountId] = useState("");

  useEffect(() => {
    if (resources.loadedFor !== context.bookId) {
      setAccountId("");
      return;
    }
    setAccountId((current) => resources.bankAccounts.some((account) => String(account.id) === current) ? current : String(resources.bankAccounts[0]?.id ?? ""));
  }, [context.bookId, resources.loadedFor, resources.bankAccounts]);

  const gate = BookResourcesGate({ route, context, resources, detail: "Chọn sổ trước khi xem dòng sao kê." });
  if (gate) return gate;
  if (!resources.bankAccounts.length) return <BankingFrame route={route}><BookSelector context={context} /><StatePanel state="empty" title="Chưa có tài khoản ngân hàng" detail="Tạo tài khoản ngân hàng trong sổ kế toán đã chọn trước khi xem dòng sao kê." /></BankingFrame>;
  if (!accountId) return <BankingFrame route={route}><BookSelector context={context} /><StatePanel state="empty" title="Chọn tài khoản ngân hàng" detail="Chọn tài khoản ngân hàng trước khi tải dòng sao kê." /></BankingFrame>;

  return <StatementLinesTable route={route} context={context} resources={resources} accountId={accountId} setAccountId={setAccountId} />;
}

function StatementLinesTable({ route, context, resources, accountId, setAccountId }: { route: Wave6Route; context: BookContext; resources: BookResources; accountId: string; setAccountId: (id: string) => void }) {
  const [state, setState] = useState<AsyncState>("loading");
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { let active = true; setState("loading"); void readApi(`/v1/accounting/bank-accounts/${encodeURIComponent(accountId)}/statement-lines?limit=50`).then((value) => { if (!active) return; const next = rowsFrom(value); setRows(next); setState(next.length ? "ready" : "empty"); }).catch((cause: any) => { if (!active) return; setError(wave6Error(cause?.message ?? "Không thể tải dòng sao kê.")); setState(cause?.forbidden ? "forbidden" : "error"); }); return () => { active = false; }; }, [accountId]);
  async function transition(row: any, action: "exclude" | "restore") { const key = `${action}:${row.id}`; setBusy(key); setError(""); try { await commandApi(`/v1/accounting/bank-accounts/${encodeURIComponent(accountId)}/statement-lines/${row.id}/${action}`, { version: Number(row.version), ...(action === "exclude" ? { expectedMatchState: row.matchState, reason: "Đã loại trừ trong quy trình đối soát" } : { reason: "Đã khôi phục trong quy trình đối soát" }) }, `statement-line:${action}:${row.id}:${row.version}`); const next = await readApi(`/v1/accounting/bank-accounts/${encodeURIComponent(accountId)}/statement-lines?limit=50`); setRows(rowsFrom(next)); } catch (cause: any) { setError(cause?.message ?? "Không thể cập nhật dòng sao kê."); } finally { setBusy(null); } }
  return <BankingFrame route={route}><BookSelector context={context} /><Card className="ns-selector-card"><label htmlFor="bank-account-select">Tài khoản ngân hàng<select id="bank-account-select" aria-label="Tài khoản ngân hàng" value={accountId} onChange={(event) => setAccountId(event.target.value)}>{resources.bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.name ?? account.institutionName ?? "Tài khoản ngân hàng được cấp quyền"}</option>)}</select></label><p className="hint">Đối soát và khôi phục vẫn do máy chủ kiểm tra version, trạng thái khớp và quyền.</p></Card>{state === "loading" && <StatePanel state="loading" title="Đang tải dòng sao kê" detail="Đang đọc theo tài khoản ngân hàng đã chọn…" />}{state === "forbidden" && <StatePanel state="forbidden" title="Không có quyền xem dòng sao kê" detail={error} />}{state === "error" && <StatePanel state="error" title="Không thể tải dòng sao kê" detail={error} onRetry={() => window.location.reload()} />}{state === "empty" && <StatePanel state="empty" title="Chưa có dòng sao kê" detail="Tài khoản ngân hàng này chưa có dòng sao kê trong phạm vi được cấp quyền." />}{state === "ready" && <><EvidenceTable title="Dòng sao kê ngân hàng" columns={lineColumns} rows={rows} /><Card className="ns-banking-action-table"><p className="eyebrow">THAO TÁC ĐỐI SOÁT</p><p>Chỉ dòng chưa khớp hoặc đề xuất khớp, chưa có số tiền đã ghép, mới có thể được loại trừ. Dòng đã loại trừ có thể khôi phục.</p><div className="ns-banking-line-actions">{rows.slice(0, 8).map((row) => { const canExclude = ["UNMATCHED", "SUGGESTED"].includes(String(row.matchState)) && String(row.matchedMinor ?? "0") === "0"; const canRestore = row.matchState === "EXCLUDED"; return (canExclude || canRestore) ? <span key={row.id}><strong>{row.description ?? "Dòng sao kê"}</strong>{canExclude && <Button variant="secondary" disabled={busy !== null} onClick={() => void transition(row, "exclude")}>{busy === `exclude:${row.id}` ? "Đang xử lý…" : "Loại trừ"}</Button>}{canRestore && <Button variant="secondary" disabled={busy !== null} onClick={() => void transition(row, "restore")}>{busy === `restore:${row.id}` ? "Đang xử lý…" : "Khôi phục"}</Button>}</span> : null; })}</div>{error && <p className="error" role="alert">{error}</p>}</Card></>}</BankingFrame>;
}

function StatementSnapshotsWorkspace({ route }: { route: Wave6Route }) {
  const [state, setState] = useState<AsyncState>("loading"); const [rows, setRows] = useState<any[]>([]); const [error, setError] = useState("");
  const load = () => { setState("loading"); void readApi("/v1/accounting/statement-snapshots").then((value) => { const next = rowsFrom(value); setRows(next); setState(next.length ? "ready" : "empty"); }).catch((cause: any) => { setError(wave6Error(cause?.message ?? "Không thể tải snapshot sao kê.")); setState(cause?.forbidden ? "forbidden" : "error"); }); };
  useEffect(() => { load(); }, []);
  return <BankingFrame route={route}>{state === "loading" && <StatePanel state="loading" title="Đang tải snapshot sao kê" detail="Đang đọc bằng chứng snapshot bất biến từ máy chủ…" />}{state === "forbidden" && <StatePanel state="forbidden" title="Không có quyền xem snapshot" detail={error} onRetry={load} />}{state === "error" && <StatePanel state="error" title="Không thể tải snapshot" detail={error} onRetry={load} />}{state === "empty" && <StatePanel state="empty" title="Chưa có snapshot sao kê" detail="Chưa có bằng chứng snapshot trong phạm vi được cấp quyền." />}{state === "ready" && <EvidenceTable title="Snapshot sao kê bất biến" columns={snapshotColumns} rows={rows} />}</BankingFrame>;
}

function ReconciliationExceptionsWorkspace({ route }: { route: Wave6Route }) {
  const context = useAccountingBooks();
  const resources = useBookResources(context.bookId);
  const [state, setState] = useState<AsyncState>("loading");
  const [data, setData] = useState<any>({ adjustmentRequests: [], unreconciledReconciliations: [] });
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");

  async function load() {
    setState("loading");
    setMessage("");
    try {
      const result = await readApi("/v1/accounting/reconciliation-exceptions?limit=100");
      setData(result ?? { adjustmentRequests: [], unreconciledReconciliations: [] });
      const hasData = Boolean(result?.adjustmentRequests?.length || result?.unreconciledReconciliations?.length);
      setState(hasData ? "ready" : "empty");
    } catch (error: any) {
      setMessage(wave6Error(error?.message ?? "Không thể tải bằng chứng đối soát."));
      setState(error?.forbidden ? "forbidden" : (typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error"));
    }
  }

  useEffect(() => { void load(); }, []);

  async function transition(id: string, stateName: string, version: number) {
    setBusyId(id); setMessage("");
    const path = `/v1/accounting/reconciliation-adjustments/${id}/${stateName}`;
    try { await commandApi(path, { version, reason: `Reconciliation adjustment ${stateName}` }, `reconciliation-adjustment:${id}:${stateName}:${version}`); await load(); }
    catch (error: any) { setMessage(error?.message ?? "Không thể hoàn tất thao tác."); }
    finally { setBusyId(""); }
  }

  const resourcesGate = BookResourcesGate({ route, context, resources, detail: "Chọn sổ trước khi yêu cầu điều chỉnh hoặc chọn tài khoản đối ứng." });
  if (resourcesGate) return resourcesGate;
  if (state === "loading") return <BankingFrame route={route}><BookSelector context={context} /><StatePanel state="loading" title="Đang tải bằng chứng đối soát" /></BankingFrame>;
  if (state === "forbidden") return <BankingFrame route={route}><BookSelector context={context} /><StatePanel state="forbidden" title="Không có quyền truy cập" detail={wave6Error(message)} /></BankingFrame>;
  if (state === "offline") return <BankingFrame route={route}><BookSelector context={context} /><StatePanel state="offline" title="Cần kết nối mạng" detail={wave6Error(message)} /></BankingFrame>;
  if (state === "error") return <BankingFrame route={route}><BookSelector context={context} /><StatePanel state="error" title="Không thể tải dữ liệu" detail={wave6Error(message)} onRetry={() => void load()} /></BankingFrame>;

  const scopedBankIds = new Set(resources.bankAccounts.map((account) => String(account.id)));
  const scopedReconciliations = (data.unreconciledReconciliations ?? []).filter((item: any) => scopedBankIds.has(String(item.bankAccountId)));
  const scopedReconciliationIds = new Set(scopedReconciliations.map((item: any) => String(item.id)));
  const scopedAdjustments = (data.adjustmentRequests ?? []).filter((item: any) => !item.reconciliationId || scopedReconciliationIds.has(String(item.reconciliationId)));

  return <BankingFrame route={route}>
    <BookSelector context={context} />
    {message && <p role="alert" className="error">{message}</p>}
    {state === "empty" && <StatePanel state="empty" title="Không có ngoại lệ đối soát" detail="Đối soát phải ở trạng thái khớp hoặc cần xem xét trước khi tạo yêu cầu điều chỉnh." />}
    {(state === "ready" || state === "empty") && <>
      <FieldForm title="Yêu cầu điều chỉnh đối soát thủ công" note="Máy chủ tự xác định tài khoản ngân hàng, kỳ và quy tắc ghi sổ. Số tiền dùng đơn vị minor dương." fields={[
        { name: "reconciliationId", label: "Đối soát", required: true, options: scopedReconciliations.map((item: any) => ({ value: String(item.id), label: item.reference ?? item.statementDate ?? "Đối soát đã lưu" })) },
        { name: "amountMinor", label: "Số tiền (đơn vị minor)", required: true, type: "number" },
        { name: "direction", label: "Chiều điều chỉnh", required: true, options: ["DEBIT", "CREDIT"] },
        { name: "offsetAccountId", label: "Tài khoản đối ứng", required: true, options: resources.accounts.filter((account) => account.active).map((account) => ({ value: String(account.id), label: account.name ?? account.code ?? "Tài khoản đối ứng" })) },
        { name: "accountingDate", label: "Ngày kế toán", required: true, type: "date" },
        { name: "reason", label: "Lý do", required: true },
      ]} onSubmit={async (values) => { await commandApi(`/v1/accounting/bank-reconciliations/${values.reconciliationId}/adjustments`, { amountMinor: values.amountMinor, direction: values.direction, offsetAccountId: values.offsetAccountId, accountingDate: values.accountingDate, reason: values.reason }, `reconciliation-adjustment:create:${values.reconciliationId}:${values.amountMinor}:${values.direction}:${values.offsetAccountId}:${values.accountingDate}`); await load(); }} />
      <Card className="ns-table-card"><h2>Yêu cầu điều chỉnh</h2><div className="ns-table-scroll"><table><thead><tr><th scope="col">Mã</th><th scope="col">Số tiền</th><th scope="col">Chiều điều chỉnh</th><th scope="col">Lý do</th><th scope="col">Trạng thái</th><th scope="col">Phiên bản</th><th scope="col">Sổ nhật ký</th><th scope="col">Thao tác</th></tr></thead><tbody>{scopedAdjustments.map((item: any) => <tr key={item.id}><td>Mã hệ thống</td><td>{formatMinor(item.amountMinor)}</td><td><Status value={item.direction} /></td><td>{item.reason}</td><td><Status value={item.state} /></td><td>{item.version}</td><td>{item.journalId ? "Mã hệ thống" : "—"}</td><td>{item.state === "DRAFT" && <button disabled={busyId === item.id} onClick={() => void transition(item.id, "submit", item.version)}>Gửi duyệt</button>}{item.state === "PENDING_APPROVAL" && <><button disabled={busyId === item.id} onClick={() => void transition(item.id, "approve", item.version)}>Phê duyệt</button><button disabled={busyId === item.id} onClick={() => void transition(item.id, "reject", item.version)}>Từ chối</button></>}{["DRAFT", "PENDING_APPROVAL"].includes(item.state) && <button disabled={busyId === item.id} onClick={() => void transition(item.id, "cancel", item.version)}>Hủy</button>}{item.state === "APPROVED" && <button disabled={busyId === item.id} onClick={() => void transition(item.id, "post", item.version)}>Ghi sổ</button>}</td></tr>)}</tbody></table></div></Card>
    </>}
  </BankingFrame>;
}

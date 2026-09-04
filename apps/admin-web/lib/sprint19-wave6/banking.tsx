"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState, type ReactNode } from "react";
import { Card, StatePanel } from "@nailsoft/ui-web";
import { FieldForm, ReadWorkspace, Status, WorkspaceNav, commandApi, formatMinor, readApi, rowsFrom, type AsyncState, type Column } from "./shared";
import type { Wave6Route } from "./routes";

const accountColumns: Column[] = [{ key: "name", label: "Bank account" }, { key: "institutionName", label: "Institution" }, { key: "currency", label: "Currency" }, { key: "status", label: "Status", status: true }];
const lineColumns: Column[] = [{ key: "transactionDate", label: "Date" }, { key: "description", label: "Description" }, { key: "reference", label: "Reference" }, { key: "amountMinor", label: "Amount", money: true }, { key: "currency", label: "Currency" }, { key: "matchState", label: "Match state", status: true }, { key: "version", label: "Version" }];
const snapshotColumns: Column[] = [{ key: "statementDate", label: "Statement date" }, { key: "status", label: "Status", status: true }, { key: "closingBalanceMinor", label: "Closing balance", money: true }, { key: "createdAt", label: "Created" }];

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
  if (route.screenId === "19.6.11") return <ReadWorkspace route={route} endpoint="/v1/accounting/statement-snapshots" columns={snapshotColumns} />;
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
      setMessage(error?.message ?? "Unable to load accounting books.");
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
      setResources({ bankAccounts: [], accounts: [], state: error?.forbidden ? "forbidden" : (typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error"), message: error?.message ?? "Unable to load accounting book context.", loadedFor: bookId });
    });
    return () => { active = false; };
  }, [bookId]);

  return resources;
}

function BankingFrame({ route, children }: { route: Wave6Route; children: ReactNode }) {
  return <main className="shell ops-shell"><WorkspaceNav route={route} /><header className="page-header"><div><p className="eyebrow">{route.title}</p><h1>{route.title}</h1><p>{route.description}</p></div></header>{children}</main>;
}

function BookSelector({ context }: { context: BookContext }) {
  if (context.state !== "ready" || !context.books.length) return null;
  const multiple = context.books.length > 1;
  return <Card className="ns-selector-card"><label htmlFor="accounting-book-select">Accounting book<select id="accounting-book-select" aria-label="Accounting book" value={context.bookId} onChange={(event) => context.selectBook(event.target.value)}>{multiple && <option value="">Select an accounting book</option>}{context.books.map((book) => <option key={book.id} value={book.id}>{book.name ?? book.code ?? book.id}</option>)}</select></label><p className="hint">Banking data is loaded only for the selected authorized accounting book.</p></Card>;
}

function BookContextGate({ route, context, detail }: { route: Wave6Route; context: BookContext; detail?: string | undefined }) {
  return <BankingFrame route={route}>
    {context.state === "ready" && <BookSelector context={context} />}
    {context.state === "loading" && <StatePanel state="loading" title="Loading accounting books" detail="Resolve the authorized book before loading banking data." />}
    {context.state === "empty" && <StatePanel state="empty" title="No accounting books" detail="Create or authorize an accounting book before reviewing banking data." />}
    {context.state === "forbidden" && <StatePanel state="forbidden" title="Permission denied" detail={context.message} />}
    {context.state === "offline" && <StatePanel state="offline" title="Internet connection required" detail={context.message} />}
    {context.state === "error" && <StatePanel state="error" title="Unable to load accounting books" detail={context.message} onRetry={() => window.location.reload()} />}
    {context.state === "ready" && !context.bookId && <StatePanel state="empty" title="Select an accounting book" detail={detail ?? "Choose a book before loading bank accounts, statement lines or offset accounts."} />}
  </BankingFrame>;
}

function BookResourcesGate({ route, context, resources, detail }: { route: Wave6Route; context: BookContext; resources: BookResources; detail?: string | undefined }) {
  if (context.state !== "ready" || !context.bookId) return <BookContextGate route={route} context={context} detail={detail} />;
  if (resources.state === "loading" || resources.loadedFor !== context.bookId) return <BankingFrame route={route}><BookSelector context={context} /><StatePanel state="loading" title="Loading banking book context" detail="Bank accounts and chart of accounts are scoped to the selected book." /></BankingFrame>;
  if (resources.state === "forbidden") return <BankingFrame route={route}><BookSelector context={context} /><StatePanel state="forbidden" title="Permission denied" detail={resources.message} /></BankingFrame>;
  if (resources.state === "offline") return <BankingFrame route={route}><BookSelector context={context} /><StatePanel state="offline" title="Internet connection required" detail={resources.message} /></BankingFrame>;
  if (resources.state === "error") return <BankingFrame route={route}><BookSelector context={context} /><StatePanel state="error" title="Unable to load banking book context" detail={resources.message} /></BankingFrame>;
  return null;
}

function BankAccountsWorkspace({ route }: { route: Wave6Route }) {
  const context = useAccountingBooks();
  if (context.state !== "ready" || !context.bookId) return <BookContextGate route={route} context={context} />;
  return <ReadWorkspace route={route} endpoint={`/v1/accounting/bank-accounts?bookId=${encodeURIComponent(context.bookId)}`} columns={accountColumns} description="Connected bank accounts and bounded statement import evidence." summary={() => <BookSelector context={context} />} />;
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

  const gate = BookResourcesGate({ route, context, resources, detail: "Choose a book before reviewing statement lines." });
  if (gate) return gate;
  if (!resources.bankAccounts.length) return <BankingFrame route={route}><BookSelector context={context} /><StatePanel state="empty" title="No bank accounts" detail="Create a bank account in the selected accounting book before reviewing statement lines." /></BankingFrame>;
  if (!accountId) return <BankingFrame route={route}><BookSelector context={context} /><StatePanel state="empty" title="Select a bank account" detail="Choose a bank account before loading statement lines." /></BankingFrame>;

  return <ReadWorkspace route={route} endpoint={`/v1/accounting/bank-accounts/${encodeURIComponent(accountId)}/statement-lines?limit=50`} columns={lineColumns} summary={() => <><BookSelector context={context} /><Card className="ns-selector-card"><label htmlFor="bank-account-select">Bank account<select id="bank-account-select" aria-label="Bank account" value={accountId} onChange={(event) => setAccountId(event.target.value)}>{resources.bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.name ?? account.institutionName ?? account.id}</option>)}</select></label><p className="hint">Matching and unmatching remain server-authoritative and audited.</p></Card></>} actions={[
    { label: "Exclude", path: (row) => `/v1/accounting/bank-accounts/${encodeURIComponent(accountId)}/statement-lines/${row.id}/exclude`, body: (row) => ({ version: Number(row.version), expectedMatchState: row.matchState, reason: "Excluded during reconciliation review" }), idempotencyKey: (row) => `statement-line-exclude:${row.id}:${row.version}`, visible: (row) => ["UNMATCHED", "SUGGESTED"].includes(row.matchState) && String(row.matchedMinor ?? "0") === "0" },
    { label: "Restore", path: (row) => `/v1/accounting/bank-accounts/${encodeURIComponent(accountId)}/statement-lines/${row.id}/restore`, body: (row) => ({ version: Number(row.version), reason: "Restored during reconciliation review" }), idempotencyKey: (row) => `statement-line-restore:${row.id}:${row.version}`, visible: (row) => row.matchState === "EXCLUDED" },
  ]} />;
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
      setMessage(error?.message ?? "Unable to load reconciliation evidence.");
      setState(error?.forbidden ? "forbidden" : (typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error"));
    }
  }

  useEffect(() => { void load(); }, []);

  async function transition(id: string, stateName: string, version: number) {
    setBusyId(id); setMessage("");
    const path = `/v1/accounting/reconciliation-adjustments/${id}/${stateName}`;
    try { await commandApi(path, { version, reason: `Reconciliation adjustment ${stateName}` }, `reconciliation-adjustment:${id}:${stateName}:${version}`); await load(); }
    catch (error: any) { setMessage(error?.message ?? "Command failed."); }
    finally { setBusyId(""); }
  }

  const resourcesGate = BookResourcesGate({ route, context, resources, detail: "Choose a book before requesting an adjustment or selecting an offset account." });
  if (resourcesGate) return resourcesGate;
  if (state === "loading") return <BankingFrame route={route}><BookSelector context={context} /><StatePanel state="loading" title="Loading reconciliation evidence" /></BankingFrame>;
  if (state === "forbidden") return <BankingFrame route={route}><BookSelector context={context} /><StatePanel state="forbidden" title="Permission denied" detail={message} /></BankingFrame>;
  if (state === "offline") return <BankingFrame route={route}><BookSelector context={context} /><StatePanel state="offline" title="Internet connection required" detail={message} /></BankingFrame>;
  if (state === "error") return <BankingFrame route={route}><BookSelector context={context} /><StatePanel state="error" title="Unable to load" detail={message} onRetry={() => void load()} /></BankingFrame>;

  const scopedBankIds = new Set(resources.bankAccounts.map((account) => String(account.id)));
  const scopedReconciliations = (data.unreconciledReconciliations ?? []).filter((item: any) => scopedBankIds.has(String(item.bankAccountId)));
  const scopedReconciliationIds = new Set(scopedReconciliations.map((item: any) => String(item.id)));
  const scopedAdjustments = (data.adjustmentRequests ?? []).filter((item: any) => !item.reconciliationId || scopedReconciliationIds.has(String(item.reconciliationId)));

  return <BankingFrame route={route}>
    <BookSelector context={context} />
    {message && <p role="alert" className="error">{message}</p>}
    {state === "empty" && <StatePanel state="empty" title="No reconciliation exceptions" detail="A reconciliation must be in matching or review before an adjustment can be requested." />}
    {(state === "ready" || state === "empty") && <>
      <FieldForm title="Request manual reconciliation adjustment" note="The server derives the bank GL account, period and posting rules. Amounts are positive minor units." fields={[
        { name: "reconciliationId", label: "Reconciliation", required: true, options: scopedReconciliations.map((item: any) => item.id) },
        { name: "amountMinor", label: "Amount (minor units)", required: true, type: "number" },
        { name: "direction", label: "Direction", required: true, options: ["DEBIT", "CREDIT"] },
        { name: "offsetAccountId", label: "Offset account", required: true, options: resources.accounts.filter((account) => account.active).map((account) => account.id) },
        { name: "accountingDate", label: "Accounting date", required: true, type: "date" },
        { name: "reason", label: "Reason", required: true },
      ]} onSubmit={async (values) => { await commandApi(`/v1/accounting/bank-reconciliations/${values.reconciliationId}/adjustments`, { amountMinor: values.amountMinor, direction: values.direction, offsetAccountId: values.offsetAccountId, accountingDate: values.accountingDate, reason: values.reason }, `reconciliation-adjustment:create:${values.reconciliationId}:${values.amountMinor}:${values.direction}:${values.offsetAccountId}:${values.accountingDate}`); await load(); }} />
      <Card className="ns-table-card"><h2>Adjustment requests</h2><div className="ns-table-scroll"><table><thead><tr><th>ID</th><th>Amount</th><th>Direction</th><th>Reason</th><th>Status</th><th>Version</th><th>Journal</th><th>Actions</th></tr></thead><tbody>{scopedAdjustments.map((item: any) => <tr key={item.id}><td>{item.id}</td><td>{formatMinor(item.amountMinor)}</td><td><Status value={item.direction} /></td><td>{item.reason}</td><td><Status value={item.state} /></td><td>{item.version}</td><td>{item.journalId ?? "—"}</td><td>{item.state === "DRAFT" && <button disabled={busyId === item.id} onClick={() => void transition(item.id, "submit", item.version)}>Submit</button>}{item.state === "PENDING_APPROVAL" && <><button disabled={busyId === item.id} onClick={() => void transition(item.id, "approve", item.version)}>Approve</button><button disabled={busyId === item.id} onClick={() => void transition(item.id, "reject", item.version)}>Reject</button></>}{["DRAFT", "PENDING_APPROVAL"].includes(item.state) && <button disabled={busyId === item.id} onClick={() => void transition(item.id, "cancel", item.version)}>Cancel</button>}{item.state === "APPROVED" && <button disabled={busyId === item.id} onClick={() => void transition(item.id, "post", item.version)}>Post</button>}</td></tr>)}</tbody></table></div></Card>
    </>}
  </BankingFrame>;
}

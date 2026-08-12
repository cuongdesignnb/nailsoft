"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState } from "react";
import { Card, StatePanel } from "@nailsoft/ui-web";
import { FieldForm, ReadWorkspace, Status, commandApi, formatMinor, readApi, type AsyncState, type Column } from "./shared";
import type { Wave6Route } from "./routes";

const accountColumns: Column[] = [{ key: "name", label: "Bank account" }, { key: "institutionName", label: "Institution" }, { key: "currency", label: "Currency" }, { key: "status", label: "Status", status: true }];
const lineColumns: Column[] = [{ key: "transactionDate", label: "Date" }, { key: "description", label: "Description" }, { key: "reference", label: "Reference" }, { key: "amountMinor", label: "Amount", money: true }, { key: "currency", label: "Currency" }, { key: "matchState", label: "Match state", status: true }, { key: "version", label: "Version" }];
const snapshotColumns: Column[] = [{ key: "statementDate", label: "Statement date" }, { key: "status", label: "Status", status: true }, { key: "closingBalanceMinor", label: "Closing balance", money: true }, { key: "createdAt", label: "Created" }];

export default function BankingWorkspace({ route }: { route: Wave6Route }) {
  if (route.screenId === "19.6.8") return <ReadWorkspace route={route} endpoint="/v1/accounting/bank-accounts" columns={accountColumns} description="Connected bank accounts and bounded statement import evidence." />;
  if (route.screenId === "19.6.10") return <ReconciliationExceptionsWorkspace route={route} />;
  if (route.screenId === "19.6.11") return <ReadWorkspace route={route} endpoint="/v1/accounting/statement-snapshots" columns={snapshotColumns} />;
  return <StatementMatching route={route} />;
}

function StatementMatching({ route }: { route: Wave6Route }) {
  const [accounts, setAccounts] = useState<any[]>([]); const [accountId, setAccountId] = useState(""); const [state, setState] = useState<AsyncState>("loading"); const [message, setMessage] = useState("");
  useEffect(() => { void readApi("/v1/accounting/bank-accounts").then((value) => { const list = Array.isArray(value) ? value : []; setAccounts(list); if (list[0]) setAccountId(list[0].id); setState(list.length ? "ready" : "empty"); }).catch((error: any) => { setMessage(error.message); setState(error.forbidden ? "forbidden" : "error"); }); }, []);
  if (state === "loading") return <main className="shell ops-shell"><StatePanel state="loading" title="Loading bank accounts" /></main>;
  if (state === "forbidden") return <main className="shell ops-shell"><StatePanel state="forbidden" title="Permission denied" detail={message} /></main>;
  if (!accounts.length) return <main className="shell ops-shell"><StatePanel state="empty" title="No bank accounts" detail="Create a bank account before reviewing statement lines." /></main>;
  return <>
    <Card className="ns-selector-card"><label>Bank account<select aria-label="Bank account" value={accountId} onChange={(event) => setAccountId(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name ?? account.institutionName ?? account.id}</option>)}</select></label><p className="hint">Matching and unmatching remain server-authoritative and audited.</p></Card>
    <ReadWorkspace route={route} endpoint={`/v1/accounting/bank-accounts/${encodeURIComponent(accountId)}/statement-lines?limit=50`} columns={lineColumns}
      actions={[
        { label: "Exclude", path: (row) => `/v1/accounting/bank-accounts/${encodeURIComponent(accountId)}/statement-lines/${row.id}/exclude`, body: (row) => ({ version: Number(row.version), expectedMatchState: row.matchState, reason: "Excluded during reconciliation review" }), idempotencyKey: (row) => `statement-line-exclude:${row.id}:${row.version}`, visible: (row) => ["UNMATCHED", "SUGGESTED"].includes(row.matchState) && String(row.matchedMinor ?? "0") === "0" },
        { label: "Restore", path: (row) => `/v1/accounting/bank-accounts/${encodeURIComponent(accountId)}/statement-lines/${row.id}/restore`, body: (row) => ({ version: Number(row.version), reason: "Restored during reconciliation review" }), idempotencyKey: (row) => `statement-line-restore:${row.id}:${row.version}`, visible: (row) => row.matchState === "EXCLUDED" },
      ]} />
  </>;
}

function ReconciliationExceptionsWorkspace({ route }: { route: Wave6Route }) {
  const [state, setState] = useState<AsyncState>("loading");
  const [data, setData] = useState<any>({ adjustmentRequests: [], unreconciledReconciliations: [] });
  const [accounts, setAccounts] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");
  async function load() {
    setState("loading"); setMessage("");
    try {
      const result = await readApi("/v1/accounting/reconciliation-exceptions?limit=100");
      setData(result ?? { adjustmentRequests: [], unreconciledReconciliations: [] });
      const reconciliations = result?.unreconciledReconciliations ?? [];
      const bookId = (await readApi("/v1/accounting/bank-accounts"))?.[0]?.bookId;
      setAccounts(bookId ? await readApi(`/v1/accounting/accounts?bookId=${encodeURIComponent(bookId)}`) : []);
      setState((result?.adjustmentRequests?.length || reconciliations.length) ? "ready" : "empty");
    } catch (error: any) { setMessage(error.message ?? "Unable to load reconciliation evidence."); setState(error.forbidden ? "forbidden" : "error"); }
  }
  useEffect(() => { void load(); }, []);
  async function transition(id: string, stateName: string, version: number) {
    setBusyId(id); setMessage("");
    const path = `/v1/accounting/reconciliation-adjustments/${id}/${stateName}`;
    try { await commandApi(path, { version, reason: `Reconciliation adjustment ${stateName}` }, `reconciliation-adjustment:${id}:${stateName}:${version}`); await load(); }
    catch (error: any) { setMessage(error.message ?? "Command failed."); }
    finally { setBusyId(""); }
  }
  if (state === "loading") return <main className="shell ops-shell"><StatePanel state="loading" title="Loading reconciliation evidence" /></main>;
  if (state === "forbidden") return <main className="shell ops-shell"><StatePanel state="forbidden" title="Permission denied" detail={message} /></main>;
  return <main className="shell ops-shell"><PageHeaderCompat route={route} onRefresh={() => void load()} />
    {message && <p role="alert" className="error">{message}</p>}
    {state === "error" && <StatePanel state="error" title="Unable to load" detail={message} onRetry={() => void load()} />}
    {state === "empty" && <StatePanel state="empty" title="No reconciliation exceptions" detail="A reconciliation must be in matching or review before an adjustment can be requested." />}
    {(state === "ready" || state === "empty") && <>
      <FieldForm title="Request manual reconciliation adjustment" note="The server derives the bank GL account, period and posting rules. Amounts are positive minor units." fields={[
        { name: "reconciliationId", label: "Reconciliation", required: true, options: (data.unreconciledReconciliations ?? []).map((item: any) => item.id) },
        { name: "amountMinor", label: "Amount (minor units)", required: true, type: "number" },
        { name: "direction", label: "Direction", required: true, options: ["DEBIT", "CREDIT"] },
        { name: "offsetAccountId", label: "Offset account", required: true, options: accounts.filter((account) => account.active).map((account) => account.id) },
        { name: "accountingDate", label: "Accounting date", required: true, type: "date" },
        { name: "reason", label: "Reason", required: true },
      ]} onSubmit={async (values) => { await commandApi(`/v1/accounting/bank-reconciliations/${values.reconciliationId}/adjustments`, { amountMinor: values.amountMinor, direction: values.direction, offsetAccountId: values.offsetAccountId, accountingDate: values.accountingDate, reason: values.reason }, `reconciliation-adjustment:create:${values.reconciliationId}:${values.amountMinor}:${values.direction}:${values.offsetAccountId}:${values.accountingDate}`); await load(); }} />
      <Card className="ns-table-card"><h2>Adjustment requests</h2><div className="ns-table-scroll"><table><thead><tr><th>ID</th><th>Amount</th><th>Direction</th><th>Reason</th><th>Status</th><th>Version</th><th>Journal</th><th>Actions</th></tr></thead><tbody>{(data.adjustmentRequests ?? []).map((item: any) => <tr key={item.id}><td>{item.id}</td><td>{formatMinor(item.amountMinor)}</td><td><Status value={item.direction} /></td><td>{item.reason}</td><td><Status value={item.state} /></td><td>{item.version}</td><td>{item.journalId ?? "—"}</td><td>{item.state === "DRAFT" && <button disabled={busyId === item.id} onClick={() => void transition(item.id, "submit", item.version)}>Submit</button>}{item.state === "PENDING_APPROVAL" && <><button disabled={busyId === item.id} onClick={() => void transition(item.id, "approve", item.version)}>Approve</button><button disabled={busyId === item.id} onClick={() => void transition(item.id, "reject", item.version)}>Reject</button></>}{["DRAFT", "PENDING_APPROVAL"].includes(item.state) && <button disabled={busyId === item.id} onClick={() => void transition(item.id, "cancel", item.version)}>Cancel</button>}{item.state === "APPROVED" && <button disabled={busyId === item.id} onClick={() => void transition(item.id, "post", item.version)}>Post</button>}</td></tr>)}</tbody></table></div></Card>
    </>}
  </main>;
}

function PageHeaderCompat({ route, onRefresh }: { route: Wave6Route; onRefresh: () => void }) {
  return <header className="page-header"><div><p className="eyebrow">SPRINT 20 · WAVE 2 · {route.screenId}</p><h1>{route.title}</h1><p>{route.description}</p></div><button type="button" onClick={onRefresh}>Refresh</button></header>;
}

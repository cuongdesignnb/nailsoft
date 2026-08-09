"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState } from "react";
import { Card, StatePanel } from "@nailsoft/ui-web";
import { ReadWorkspace, type AsyncState, type Column } from "./shared";
import type { Wave6Route } from "./routes";
import { readApi } from "./shared";

const accountColumns: Column[] = [{ key: "name", label: "Bank account" }, { key: "institutionName", label: "Institution" }, { key: "currency", label: "Currency" }, { key: "status", label: "Status", status: true }];
const lineColumns: Column[] = [{ key: "transactionDate", label: "Date" }, { key: "description", label: "Description" }, { key: "reference", label: "Reference" }, { key: "amountMinor", label: "Amount", money: true }, { key: "currency", label: "Currency" }, { key: "matchState", label: "Match state", status: true }];
const exceptionColumns: Column[] = [{ key: "type", label: "Evidence" }, { key: "status", label: "Status", status: true }, { key: "differenceMinor", label: "Difference", money: true }, { key: "createdAt", label: "Created" }];
const snapshotColumns: Column[] = [{ key: "statementDate", label: "Statement date" }, { key: "status", label: "Status", status: true }, { key: "closingBalanceMinor", label: "Closing balance", money: true }, { key: "createdAt", label: "Created" }];

export default function BankingWorkspace({ route }: { route: Wave6Route }) {
  if (route.screenId === "19.6.8") return <ReadWorkspace route={route} endpoint="/v1/accounting/bank-accounts" columns={accountColumns} description="Connected bank accounts and bounded statement import evidence." />;
  if (route.screenId === "19.6.10") return <ReadWorkspace route={route} endpoint="/v1/accounting/reconciliation-exceptions" columns={exceptionColumns} description="Persisted reconciliation evidence only. Exception exclusion and manual ledger adjustment are deferred." />;
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
    <ReadWorkspace route={route} endpoint={`/v1/accounting/bank-accounts/${encodeURIComponent(accountId)}/statement-lines?limit=50`} columns={lineColumns} />
  </>;
}

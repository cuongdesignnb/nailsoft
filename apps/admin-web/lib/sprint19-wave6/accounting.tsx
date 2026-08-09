"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { ReadWorkspace, FieldForm, ImmutableRecordBadge, DualControlNotice, type Column } from "./shared";
import type { Wave6Route } from "./routes";
import { commandApi } from "./shared";

const columns: Record<string, Column[]> = {
  books: [{ key: "code", label: "Book" }, { key: "name", label: "Name" }, { key: "status", label: "Status", status: true }, { key: "currency", label: "Currency" }],
  accounts: [{ key: "code", label: "Account" }, { key: "name", label: "Name" }, { key: "accountType", label: "Type" }, { key: "status", label: "Status", status: true }],
  periods: [{ key: "periodCode", label: "Period" }, { key: "startDate", label: "From" }, { key: "endDate", label: "To" }, { key: "status", label: "Status", status: true }, { key: "version", label: "Version" }],
  journals: [{ key: "journalNumber", label: "Journal" }, { key: "sourceType", label: "Source" }, { key: "status", label: "Status", status: true }, { key: "currency", label: "Currency" }, { key: "version", label: "Version" }],
  posting: [{ key: "sourceType", label: "Source" }, { key: "sourceId", label: "Source reference" }, { key: "status", label: "Status", status: true }, { key: "createdAt", label: "Created" }],
  openItems: [{ key: "counterpartyName", label: "Counterparty" }, { key: "documentNumber", label: "Document" }, { key: "openMinor", label: "Open amount", money: true }, { key: "currency", label: "Currency" }, { key: "status", label: "Status", status: true }],
  reports: [{ key: "accountCode", label: "Account" }, { key: "accountName", label: "Name" }, { key: "debitMinor", label: "Debit", money: true }, { key: "creditMinor", label: "Credit", money: true }, { key: "balanceMinor", label: "Balance", money: true }],
};

export default function AccountingWorkspace({ route }: { route: Wave6Route }) {
  const key = route.screenId === "19.6.1" ? "books" : route.screenId === "19.6.2" ? "accounts" : route.screenId === "19.6.3" ? "periods" : route.screenId === "19.6.4" ? "journals" : route.screenId === "19.6.5" ? "posting" : route.screenId === "19.6.6" ? "openItems" : "reports";
  const endpoint = key === "books" ? "/v1/accounting/books" : key === "accounts" ? "/v1/accounting/accounts" : key === "periods" ? "/v1/accounting/periods" : key === "journals" ? "/v1/accounting/journals" : key === "posting" ? "/v1/accounting/posting-candidates" : key === "openItems" ? "/v1/accounting/open-items" : "/v1/accounting/reports";
  const actions = key === "periods" ? [
    { label: "Open", path: (row: any) => `/v1/accounting/periods/${row.id}/open` },
    { label: "Request close", path: (row: any) => `/v1/accounting/periods/${row.id}/request-close` },
    { label: "Approve close", path: (row: any) => `/v1/accounting/periods/${row.id}/approve-close` },
  ] : key === "journals" ? [
    { label: "Submit", path: (row: any) => `/v1/accounting/journals/${row.id}/submit` },
    { label: "Approve", path: (row: any) => `/v1/accounting/journals/${row.id}/approve` },
    { label: "Post", path: (row: any) => `/v1/accounting/journals/${row.id}/post` },
  ] : key === "openItems" ? [{ label: "Settle", path: (row: any) => `/v1/accounting/open-items/${row.id}/allocate` }] : [];
  return <ReadWorkspace route={route} endpoint={endpoint} columns={columns[key]!} actions={actions as any}>
    {key === "periods" && <DualControlNotice>Period close and reopen actions are separately approved and version checked.</DualControlNotice>}
    {key === "journals" && <><DualControlNotice>Posted journals are immutable; reversal uses a separate approval path.</DualControlNotice><FieldForm title="Create journal" fields={[{ name: "bookId", label: "Book ID", required: true }, { name: "periodId", label: "Period ID", required: true }, { name: "description", label: "Description", required: true }]} onSubmit={async (values) => { await commandApi("/v1/accounting/journals", { ...values, lines: [] }); }} note="Add balanced lines in the journal workbench before submitting for approval." /></>}
    {key === "reports" && <p className="ns-gallery-banner"><ImmutableRecordBadge /> Select a book, period and report type in the report API; results are never recomputed in the browser.</p>}
  </ReadWorkspace>;
}

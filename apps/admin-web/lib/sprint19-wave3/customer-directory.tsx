/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { authorizedFetch } from "../auth";

type DirectoryState = "loading" | "ready" | "empty" | "error" | "forbidden" | "offline";

function errorMessage(body: any, fallback: string) {
  return body?.error?.message ?? body?.message ?? fallback;
}

function formatDate(value: unknown) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(new Date(String(value)));
}

function localizedStatus(value: unknown) {
  return String(value ?? "UNKNOWN").replaceAll("_", " ");
}

function StatePanel({ state, error, retry, label }: { state: DirectoryState; error: string; retry: () => void; label: string }) {
  if (state === "loading") return <div className="s19-state" role="status" aria-live="polite"><span className="s19-spinner" />Loading {label}...</div>;
  if (state === "forbidden") return <div className="s19-state s19-state-danger" role="alert"><h2>Permission denied</h2><span>Your role does not have permission to view customer profiles.</span></div>;
  if (state === "offline") return <div className="s19-state" role="alert"><strong>Internet connection required</strong><span>Customer data is not available offline.</span><button className="s19-button s19-button-secondary" type="button" onClick={retry}>Retry</button></div>;
  if (state === "error") return <div className="s19-state s19-state-danger" role="alert"><strong>Unable to load customers</strong><span>{error}</span><button className="s19-button s19-button-secondary" type="button" onClick={retry}>Retry</button></div>;
  if (state === "empty") return <div className="s19-state" role="status"><strong>No customers found</strong><span>Try a different name, phone or email search.</span><button className="s19-button s19-button-secondary" type="button" onClick={retry}>Refresh</button></div>;
  return null;
}

function useDirectory() {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [state, setState] = useState<DirectoryState>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState<string | undefined>();
  const controllerRef = useRef<AbortController | undefined>(undefined);

  async function fetchPage(search: string, cursor: string | null, append: boolean, signal?: AbortSignal) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw Object.assign(new Error("Internet connection required."), { offline: true });
    }
    const params = new URLSearchParams({ limit: "25" });
    if (search) params.set("search", search);
    if (cursor) params.set("cursor", cursor);
    const init: RequestInit = signal ? { signal } : {};
    const response = await authorizedFetch(`/v1/customers?${params.toString()}`, init);
    const body = await response.json().catch(() => ({}));
    if (response.status === 403) throw Object.assign(new Error(errorMessage(body, "Permission denied.")), { forbidden: true, code: body?.error?.code });
    if (!response.ok) throw Object.assign(new Error(errorMessage(body, "Unable to load customers.")), { code: body?.error?.code });
    const page = Array.isArray(body?.data) ? body.data : [];
    const pagination = body?.meta?.pagination ?? {};
    setRows((current) => append ? [...current, ...page] : page);
    setNextCursor(pagination.nextCursor ?? null);
    setHasMore(Boolean(pagination.hasMore));
    setState((append ? [...rows, ...page] : page).length ? "ready" : "empty");
  }

  async function load(search = query) {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState("loading");
    setError("");
    setErrorCode(undefined);
    try {
      await fetchPage(search, null, false, controller.signal);
    } catch (cause: any) {
      if (cause?.name === "AbortError") return;
      setError(cause?.message ?? "Unable to load customers.");
      setErrorCode(cause?.code);
      setState(cause?.offline ? "offline" : cause?.forbidden ? "forbidden" : "error");
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const normalized = draft.trim();
      setQuery(normalized);
      void load(normalized);
    }, 350);
    return () => window.clearTimeout(timer);
    // The draft is deliberately debounced; load is stable for this screen lifecycle.
  }, [draft]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await fetchPage(query, nextCursor, true);
    } catch (cause: any) {
      setError(cause?.message ?? "Unable to load the next page.");
      setErrorCode(cause?.code);
    } finally {
      setLoadingMore(false);
    }
  }

  return { draft, setDraft, query, setQuery, rows, nextCursor, hasMore, state, loadingMore, error, errorCode, load, loadMore };
}

export default function CustomerDirectory() {
  const directory = useDirectory();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = directory.draft.trim();
    directory.setQuery(normalized);
    void directory.load(normalized);
  }
  return (
    <main className="s19-customer-page">
      <header className="s19-page-heading">
        <div><p className="s19-eyebrow">CUSTOMER 360</p><h1>Customers</h1><p>Search the tenant customer directory and open a complete, permission-aware customer profile.</p></div>
        <div className="s19-page-actions"><a className="s19-button s19-button-primary" href="/admin/customers/new">Create customer</a></div>
      </header>
      <section className="s19-card s19-customer-directory-card">
        <form className="s19-customer-search" role="search" onSubmit={submit}>
          <label className="s19-field s19-customer-search-field" htmlFor="customer-search"><span>Search customers</span><input id="customer-search" name="search" value={directory.draft} onChange={(event) => directory.setDraft(event.target.value)} placeholder="Name, phone or email" autoComplete="off" /></label>
          <button className="s19-button s19-button-secondary" type="submit">Search</button>
        </form>
        {directory.errorCode === "INVALID_CUSTOMER_CURSOR" ? <div className="s19-notice s19-notice-error" role="alert">The customer page expired. Search again to restart pagination.</div> : null}
        <StatePanel state={directory.state} error={directory.error} retry={() => void directory.load()} label="customers" />
        {directory.state === "ready" ? <>
          <div className="s19-customer-table-wrap">
            <table className="s19-customer-table"><caption className="s19-sr-only">Customer search results</caption><thead><tr><th>Name</th><th>Status</th><th>Locale</th><th>Contact</th><th>Created</th><th><span className="s19-sr-only">Actions</span></th></tr></thead><tbody>
              {directory.rows.map((customer) => <tr key={customer.id}><td data-label="Name"><strong>{customer.displayName}</strong>{customer.isGuest ? <small>Guest profile</small> : null}</td><td data-label="Status"><span className="s19-status s19-status-info">{localizedStatus(customer.status)}</span></td><td data-label="Locale">{customer.locale ?? "-"}</td><td data-label="Contact"><span>{customer.phone ?? "-"}</span><small>{customer.email ?? "-"}</small></td><td data-label="Created">{formatDate(customer.createdAt)}</td><td data-label="Actions"><a className="s19-inline-action" href={`/admin/customers/${customer.id}`}>Open customer</a></td></tr>)}
            </tbody></table>
          </div>
          <div className="s19-customer-pagination"><span>{directory.rows.length} customers shown</span>{directory.hasMore ? <button className="s19-button s19-button-secondary" type="button" onClick={() => void directory.loadMore()} disabled={directory.loadingMore}>{directory.loadingMore ? "Loading..." : "Load more"}</button> : <span>End of results</span>}</div>
        </> : null}
      </section>
    </main>
  );
}

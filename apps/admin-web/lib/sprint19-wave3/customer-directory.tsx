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
  const labels: Record<string, string> = {
    ACTIVE: "Đang hoạt động",
    INACTIVE: "Tạm ngưng",
    ARCHIVED: "Đã lưu trữ",
    BLOCKED: "Đã chặn",
    UNKNOWN: "Chưa xác định",
  };
  const key = String(value ?? "UNKNOWN").toUpperCase();
  return labels[key] ?? key.replaceAll("_", " ");
}

function StatePanel({ state, error, retry, label }: { state: DirectoryState; error: string; retry: () => void; label: string }) {
  if (state === "loading") return <div className="s19-state" role="status" aria-live="polite"><span className="s19-spinner" />Đang tải {label}…</div>;
  if (state === "forbidden") return <div className="s19-state s19-state-danger" role="alert"><h2>Không có quyền truy cập</h2><span>Vai trò hiện tại không được phép xem hồ sơ khách hàng.</span></div>;
  if (state === "offline") return <div className="s19-state" role="alert"><strong>Cần kết nối Internet</strong><span>Dữ liệu khách hàng không thể tải khi đang ngoại tuyến.</span><button className="s19-button s19-button-secondary" type="button" onClick={retry}>Thử lại</button></div>;
  if (state === "error") return <div className="s19-state s19-state-danger" role="alert"><strong>Không thể tải danh sách khách hàng</strong><span>{error}</span><button className="s19-button s19-button-secondary" type="button" onClick={retry}>Thử lại</button></div>;
  if (state === "empty") return <div className="s19-state" role="status"><strong>Không tìm thấy khách hàng</strong><span>Hãy thử tên, số điện thoại hoặc email khác.</span><button className="s19-button s19-button-secondary" type="button" onClick={retry}>Làm mới</button></div>;
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
        <div><p className="s19-eyebrow">KHÁCH HÀNG 360</p><h1>Danh sách khách hàng</h1><p>Tra cứu khách hàng trong salon và mở hồ sơ đầy đủ theo quyền truy cập được cấp.</p></div>
        <div className="s19-page-actions"><a className="s19-button s19-button-primary" href="/admin/customers/new">Thêm khách hàng</a></div>
      </header>
      <section className="s19-card s19-customer-directory-card">
        <form className="s19-customer-search" role="search" onSubmit={submit}>
          <label className="s19-field s19-customer-search-field" htmlFor="customer-search"><span>Tìm khách hàng</span><input id="customer-search" name="search" value={directory.draft} onChange={(event) => directory.setDraft(event.target.value)} placeholder="Tên, số điện thoại hoặc email" autoComplete="off" /></label>
          <button className="s19-button s19-button-secondary" type="submit">Tìm kiếm</button>
        </form>
        {directory.errorCode === "INVALID_CUSTOMER_CURSOR" ? <div className="s19-notice s19-notice-error" role="alert">Trang danh sách đã hết hiệu lực. Hãy tìm kiếm lại để bắt đầu phân trang.</div> : null}
        <StatePanel state={directory.state} error={directory.error} retry={() => void directory.load()} label="khách hàng" />
        {directory.state === "ready" ? <>
          <div className="s19-customer-table-wrap">
            <table className="s19-customer-table"><caption className="s19-sr-only">Kết quả tìm kiếm khách hàng</caption><thead><tr><th>Khách hàng</th><th>Trạng thái</th><th>Ngôn ngữ</th><th>Liên hệ</th><th>Ngày tạo</th><th><span className="s19-sr-only">Thao tác</span></th></tr></thead><tbody>
              {directory.rows.map((customer) => <tr key={customer.id}><td data-label="Khách hàng"><strong>{customer.displayName}</strong>{customer.isGuest ? <small>Hồ sơ khách vãng lai</small> : null}</td><td data-label="Trạng thái"><span className="s19-status s19-status-info">{localizedStatus(customer.status)}</span></td><td data-label="Ngôn ngữ">{customer.locale ?? "-"}</td><td data-label="Liên hệ"><span>{customer.phone ?? "-"}</span><small>{customer.email ?? "-"}</small></td><td data-label="Ngày tạo">{formatDate(customer.createdAt)}</td><td data-label="Thao tác"><a className="s19-inline-action" href={`/admin/customers/${customer.id}`}>Mở hồ sơ</a></td></tr>)}
            </tbody></table>
          </div>
          <div className="s19-customer-pagination"><span>Đang hiển thị {directory.rows.length} khách hàng</span>{directory.hasMore ? <button className="s19-button s19-button-secondary" type="button" onClick={() => void directory.loadMore()} disabled={directory.loadingMore}>{directory.loadingMore ? "Đang tải…" : "Tải thêm"}</button> : <span>Đã hiển thị hết kết quả</span>}</div>
        </> : null}
      </section>
    </main>
  );
}

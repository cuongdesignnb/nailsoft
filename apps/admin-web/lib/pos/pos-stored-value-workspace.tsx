/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { authorizedFetch } from "../auth";

type Mode = "stored-value" | "gift-card";
type LoadState = "loading" | "ready" | "empty" | "error" | "forbidden";

function unwrap(body: any) {
  return body?.data ?? body;
}

async function read(path: string) {
  const response = await authorizedFetch(path);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error("Bạn không có quyền xem dữ liệu Stored Value."), { forbidden: true });
  }
  if (!response.ok) throw new Error(body?.error?.message ?? "Không thể tải dữ liệu Stored Value.");
  return unwrap(body);
}

function money(value: unknown, currency: string) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value);
  try {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: currency || "VND", maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toLocaleString("vi-VN")} ${currency}`;
  }
}

function dateValue(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function applicationStatus(value: unknown) {
  const key = String(value ?? "").toUpperCase();
  return ({ RESERVED: "Đang giữ", COMMITTED: "Đã ghi nhận", RELEASED: "Đã hoàn giữ", CANCELLED: "Đã hủy" } as Record<string, string>)[key] ?? (value ? String(value).replaceAll("_", " ") : "—");
}

function StatePanel({ state, error, retry, label }: { state: LoadState; error?: string; retry: () => void; label: string }) {
  if (state === "loading") return <div className="pos-value-state" role="status" aria-busy="true">Đang tải {label}…</div>;
  if (state === "forbidden") return <div className="pos-value-state is-danger" role="alert"><strong>Không có quyền truy cập</strong><span>{error}</span><button type="button" onClick={retry}>Thử lại</button></div>;
  if (state === "error") return <div className="pos-value-state is-danger" role="alert"><strong>Không thể tải dữ liệu</strong><span>{error}</span><button type="button" onClick={retry}>Thử lại</button></div>;
  if (state === "empty") return <div className="pos-value-state" role="status"><strong>Chưa có dữ liệu</strong><span>API chưa trả về điều kiện Stored Value cho đơn này.</span><button type="button" onClick={retry}>Làm mới</button></div>;
  return null;
}

export default function PosStoredValueWorkspace({ orderId, mode }: { orderId: string; mode: Mode }) {
  const [eligibilityState, setEligibilityState] = useState<LoadState>("loading");
  const [applicationsState, setApplicationsState] = useState<LoadState>("loading");
  const [orderState, setOrderState] = useState<LoadState>("loading");
  const [eligibility, setEligibility] = useState<any>(null);
  const [applications, setApplications] = useState<any[]>([]);
  const [order, setOrder] = useState<any>(null);
  const [error, setError] = useState("");
  const [number, setNumber] = useState("");
  const [pin, setPin] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const intentKey = useRef<string | undefined>(undefined);
  const currency = String(eligibility?.currency ?? order?.currency ?? "VND");

  const load = useCallback(async () => {
    setEligibilityState("loading");
    setApplicationsState("loading");
    setOrderState("loading");
    setError("");
    const results = await Promise.allSettled([
      read(`/v1/pos-orders/${encodeURIComponent(orderId)}/stored-value/eligibility`),
      read(`/v1/pos-orders/${encodeURIComponent(orderId)}/stored-value`),
      read(`/v1/pos-orders/${encodeURIComponent(orderId)}`),
    ]);
    const [eligibilityResult, applicationResult, orderResult] = results;
    if (eligibilityResult.status === "fulfilled") {
      const next = Array.isArray(eligibilityResult.value) ? eligibilityResult.value[0] : eligibilityResult.value;
      setEligibility(next ?? null);
      setEligibilityState(next ? "ready" : "empty");
    } else {
      setEligibilityState((eligibilityResult.reason as any)?.forbidden ? "forbidden" : "error");
      setError(eligibilityResult.reason?.message ?? "Không thể tải điều kiện sử dụng.");
    }
    if (applicationResult.status === "fulfilled") {
      const next = Array.isArray(applicationResult.value) ? applicationResult.value : applicationResult.value?.items ?? [];
      setApplications(next);
      setApplicationsState(next.length ? "ready" : "empty");
    } else {
      setApplicationsState((applicationResult.reason as any)?.forbidden ? "forbidden" : "error");
    }
    if (orderResult.status === "fulfilled") {
      setOrder(orderResult.value);
      setOrderState("ready");
    } else {
      setOrderState((orderResult.reason as any)?.forbidden ? "forbidden" : "error");
    }
  }, [orderId]);

  useEffect(() => { void load(); }, [load]);

  async function reserve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!order?.version) {
      setNotice("Chưa có phiên bản đơn hàng mới nhất. Hãy tải lại trước khi giữ Stored Value.");
      return;
    }
    setBusy(true);
    setNotice("");
    setError("");
    const key = intentKey.current ?? crypto.randomUUID();
    intentKey.current = key;
    try {
      const response = await authorizedFetch(`/v1/pos-orders/${encodeURIComponent(orderId)}/stored-value/gift-card`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify({ number, pin: pin || undefined, requestedMinor: amount, version: Number(order.version) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message ?? "Không thể giữ Stored Value.");
      intentKey.current = undefined;
      setNotice("Stored Value đã được máy chủ giữ cho đơn POS. Chỉ ghi nhận khi đơn được thanh toán.");
      setNumber("");
      setPin("");
      await load();
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể giữ Stored Value.");
      setNumber("");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  const facts = [
    ["Đơn POS", order?.orderNumber ?? "Mã hệ thống"],
    ["Tiền tệ", currency],
    ["Giá trị dòng đủ điều kiện", money(eligibility?.eligibleLineMinor, currency)],
    ["Đã thanh toán bằng nguồn ngoài", money(eligibility?.externalPaidAllocationMinor, currency)],
    ["Đã áp dụng Stored Value", money(eligibility?.alreadyAppliedMinor, currency)],
    ["Còn đủ điều kiện", money(eligibility?.remainingEligibleMinor, currency)],
    ["Số tiền đơn còn phải thu", money(eligibility?.currentOrderDueMinor, currency)],
    ["Giới hạn Stored Value", money(eligibility?.maxStoredValueMinor, currency)],
  ];
  const prohibited = eligibility?.prohibited && typeof eligibility.prohibited === "object" ? Object.entries(eligibility.prohibited).filter(([, value]) => Boolean(value)).map(([key]) => ({ giftCardLines: "Mua Gift Card bằng Stored Value", tip: "Thanh toán tip bằng Stored Value", cashOut: "Rút tiền mặt" } as Record<string, string>)[key] ?? key) : [];

  return <main className="pos-value-workspace"><header className="pos-value-header"><div><p className="pos-value-eyebrow">POS · STORED VALUE</p><h1>{mode === "gift-card" ? "Kiểm tra Gift Card tại POS" : "Kiểm tra và giữ Stored Value"}</h1><p>Điều kiện, phiên bản đơn và việc giữ số dư đều do Stored Value engine phía máy chủ quyết định.</p></div><div className="pos-value-header-actions"><a href={`/admin/pos/orders/${orderId}`}>← Chi tiết đơn</a><span>{order?.orderNumber ?? "Đơn POS"}</span></div></header><div className="pos-value-layout"><section className="pos-value-main"><article className="pos-value-card"><div className="pos-value-card-heading"><div><p className="pos-value-kicker">KIỂM TRA QUYỀN SỬ DỤNG</p><h2>Điều kiện thanh toán</h2></div><span className={eligibility?.prohibited ? "is-warning" : "is-good"}>{eligibility ? "Máy chủ đã kiểm tra" : "Đang kiểm tra"}</span></div><StatePanel state={eligibilityState} error={error} retry={() => void load()} label="điều kiện thanh toán" />{eligibilityState === "ready" ? <div className="pos-value-facts">{facts.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div> : null}<div className="pos-value-rule"><strong>Thứ tự áp dụng</strong><span>{eligibility?.allocationOrder === "EXTERNAL_PAYMENT_FIRST" ? "Thanh toán ngoài trước, Stored Value sau" : eligibility?.allocationOrder ?? "Theo chính sách POS"}</span></div>{prohibited.length ? <div className="pos-value-warning"><strong>Giới hạn theo chính sách hiện tại</strong><ul>{prohibited.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}</article><article className="pos-value-card"><div className="pos-value-card-heading"><div><p className="pos-value-kicker">LỊCH SỬ ĐƠN POS</p><h2>Ứng dụng Stored Value</h2></div><span>{applications.length} bản ghi</span></div><StatePanel state={applicationsState} error={error} retry={() => void load()} label="ứng dụng Stored Value" />{applicationsState === "ready" ? <div className="pos-value-table-wrap"><table><thead><tr><th scope="col">Trạng thái</th><th scope="col">Yêu cầu</th><th scope="col">Được chấp nhận</th><th scope="col">Thời gian</th></tr></thead><tbody>{applications.map((row) => <tr key={row.id}><td><span className="pos-value-status">{applicationStatus(row.status)}</span></td><td>{money(row.requestedMinor, row.currency ?? currency)}</td><td>{money(row.acceptedMinor, row.currency ?? currency)}</td><td>{dateValue(row.createdAt)}</td></tr>)}</tbody></table></div> : null}</article></section><aside className="pos-value-side"><article className="pos-value-card pos-value-form-card"><p className="pos-value-kicker">XÁC THỰC AN TOÀN</p><h2>Giữ số dư cho đơn này</h2><p className="pos-value-helper">Số Gift Card và PIN chỉ tồn tại trong phiên nhập liệu, không được đưa vào URL, log hoặc bộ nhớ trình duyệt.</p><form onSubmit={reserve}><label>Số Gift Card<input type="password" autoComplete="off" value={number} onChange={(event) => setNumber(event.target.value)} required /></label><label>PIN<input type="password" autoComplete="off" value={pin} onChange={(event) => setPin(event.target.value)} /></label><label>Số tiền yêu cầu<input inputMode="numeric" type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Nhập số nguyên theo đơn vị tiền tệ" required /></label><button type="submit" disabled={busy || eligibilityState !== "ready" || orderState !== "ready"}>{busy ? "Đang kiểm tra…" : "Giữ Stored Value online"}</button></form>{notice ? <p className="pos-value-notice" role="status">{notice}</p> : null}{error ? <p className="pos-value-notice is-danger" role="alert">{error}</p> : null}</article><article className="pos-value-card"><p className="pos-value-kicker">NGUYÊN TẮC</p><h2>Không chỉnh số dư trực tiếp</h2><p className="pos-value-helper">Reservation chỉ chuyển Available sang Reserved. Việc ghi nhận Redeem chỉ xảy ra trong quy trình thanh toán POS hợp lệ.</p><dl className="pos-value-mini-list"><div><dt>Phiên bản đơn</dt><dd>{orderState === "ready" ? order?.version ?? "—" : "Đang tải…"}</dd></div><div><dt>Online bắt buộc</dt><dd>{eligibility?.onlineRequired ? "Có" : "Theo API"}</dd></div><div><dt>Trạng thái đơn</dt><dd>{order?.status ?? "—"}</dd></div></dl></article></aside></div></main>;
}

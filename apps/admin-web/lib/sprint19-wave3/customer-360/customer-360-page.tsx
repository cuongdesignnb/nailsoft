/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { authorizedFetch, getAuthContext } from "../../auth";
import styles from "./customer-360-page.module.css";

type LoadState = "loading" | "ready" | "error" | "forbidden" | "offline";
type OptionalState = "loading" | "ready" | "empty" | "forbidden" | "unavailable";
type OptionalResource = { state: OptionalState; data?: any; error?: string };

const money = (value: unknown, currency = "VND") => {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "VND" ? 0 : 2,
  }).format(currency === "VND" ? amount : amount / 100);
};

const integer = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(number)
    : "—";
};

const dateTime = (value: unknown) => {
  if (!value) return "—";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime())
    ? "—"
    : new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
};

const dateOnly = (value: unknown) => {
  if (!value) return "—";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime())
    ? "—"
    : new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(parsed);
};

const hasValue = (value: unknown) => value !== null && value !== undefined && value !== "";

function initials(name: unknown) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  return words.slice(-2).map((word) => word[0]?.toUpperCase()).join("") || "KH";
}

function statusLabel(value: unknown) {
  const normalized = String(value ?? "").toUpperCase();
  const labels: Record<string, string> = {
    ACTIVE: "Đang hoạt động",
    INACTIVE: "Không hoạt động",
    CONFIRMED: "Đã xác nhận",
    COMPLETED: "Hoàn tất",
    PENDING: "Chờ xử lý",
    CANCELLED_BY_CUSTOMER: "Khách đã hủy",
    CANCELLED_BY_SALON: "Salon đã hủy",
    NO_SHOW: "Không đến",
    EXPIRED: "Hết hạn",
  };
  return labels[normalized] ?? (normalized ? normalized.replaceAll("_", " ") : "Chưa xác định");
}

function statusTone(value: unknown) {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "COMPLETED" || normalized === "CONFIRMED" || normalized === "ACTIVE") return styles.success;
  if (normalized.includes("CANCEL") || normalized === "NO_SHOW" || normalized === "EXPIRED") return styles.danger;
  return styles.warning;
}

function unwrapError(body: any) {
  return body?.error?.message ?? body?.message ?? "Không thể tải hồ sơ khách hàng.";
}

function errorCode(body: any) {
  return body?.error?.code ?? body?.code;
}

function StatePanel({ state, error, retry }: { state: LoadState; error: string; retry: () => void }) {
  if (state === "loading") return <div className={styles.state} role="status"><span className={styles.spinner} />Đang tải hồ sơ khách hàng…</div>;
  if (state === "offline") return <div className={`${styles.state} ${styles.stateDanger}`} role="alert"><strong>Cần kết nối mạng</strong><span>Dữ liệu hồ sơ khách hàng không được lưu offline.</span><button className={styles.secondaryButton} type="button" onClick={retry}>Thử lại</button></div>;
  if (state === "forbidden") return <div className={`${styles.state} ${styles.stateDanger}`} role="alert"><strong>Không có quyền xem hồ sơ</strong><span>Hồ sơ này nằm ngoài phạm vi dữ liệu của tài khoản hiện tại.</span></div>;
  return <div className={`${styles.state} ${styles.stateDanger}`} role="alert"><strong>Không thể tải hồ sơ khách hàng</strong><span>{error}</span><button className={styles.secondaryButton} type="button" onClick={retry}>Thử lại</button></div>;
}

function Card({ title, eyebrow, action, children, className = "" }: { title: string; eyebrow?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`${styles.card} ${className}`}><div className={styles.cardHeading}><div>{eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}<h2>{title}</h2></div>{action}</div>{children}</section>;
}

function EmptyState({ title = "Chưa có dữ liệu", detail = "Nguồn dữ liệu hiện chưa trả về thông tin cho mục này." }: { title?: string; detail?: string }) {
  return <div className={styles.empty}><span className={styles.emptyMark}>—</span><strong>{title}</strong><span>{detail}</span></div>;
}

function OptionalState({ resource, label }: { resource: OptionalResource; label: string }) {
  if (resource.state === "loading") return <div className={styles.inlineState}>Đang tải {label}…</div>;
  if (resource.state === "forbidden") return <div className={styles.inlineState}>Mục này cần quyền truy cập riêng.</div>;
  if (resource.state === "unavailable") return <div className={styles.inlineState}>Chưa thể tải {label}.</div>;
  return null;
}

function LinkArrow({ href, children }: { href: string; children: ReactNode }) {
  return <a className={styles.linkRow} href={href}><span>{children}</span><span aria-hidden="true">→</span></a>;
}

function DefinitionList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return <dl className={styles.definitionList}>{items.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>;
}

function CustomerEditDialog({
  data,
  customerId,
  onClose,
  onSaved,
}: {
  data: any;
  customerId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    displayName: String(data?.profile?.displayName ?? ""),
    phone: String(data?.contact?.phone ?? ""),
    email: String(data?.contact?.email ?? ""),
    preferredLocale: String(data?.profile?.preferredLocale ?? "vi-VN"),
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [versionConflict, setVersionConflict] = useState(false);
  const intentKeyRef = useRef<string | undefined>(undefined);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.displayName.trim()) {
      setError("Vui lòng nhập tên khách hàng.");
      return;
    }
    setSubmitting(true);
    setError("");
    const key = intentKeyRef.current ?? crypto.randomUUID();
    intentKeyRef.current = key;
    try {
      const response = await authorizedFetch(`/v1/customers/${encodeURIComponent(customerId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify({
          version: Number(data?.profile?.version),
          displayName: form.displayName.trim(),
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          preferredLocale: form.preferredLocale,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 409 && errorCode(body) === "VERSION_CONFLICT") {
        setVersionConflict(true);
        setError("Hồ sơ đã thay đổi ở nơi khác. Hãy tải lại trước khi lưu tiếp.");
        return;
      }
      if (response.status === 409 && errorCode(body) === "CUSTOMER_DUPLICATE_CONFLICT") {
        setError("Số điện thoại hoặc email này đang thuộc một khách hàng khác.");
        return;
      }
      if (!response.ok) throw new Error(unwrapError(body));
      intentKeyRef.current = undefined;
      await onSaved();
      onClose();
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể lưu thay đổi.");
    } finally {
      setSubmitting(false);
    }
  }

  return <div className={styles.dialogBackdrop} role="presentation"><section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="customer-edit-title"><div className={styles.cardHeading}><div><p className={styles.eyebrow}>HỒ SƠ KHÁCH HÀNG</p><h2 id="customer-edit-title">Chỉnh sửa thông tin</h2></div><button className={styles.iconButton} type="button" onClick={onClose} aria-label="Đóng">×</button></div><form className={styles.formGrid} onSubmit={(event) => void submit(event)} noValidate>
    {error ? <div className={`${styles.notice} ${styles.noticeDanger}`} role="alert"><strong>{versionConflict ? "Xung đột phiên bản" : "Không thể lưu"}</strong><span>{error}</span>{versionConflict ? <button className={styles.secondaryButton} type="button" onClick={() => { setVersionConflict(false); void onSaved(); onClose(); }}>Tải lại hồ sơ</button> : null}</div> : null}
    <label className={styles.field}><span>Họ và tên</span><input value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} required /></label>
    <label className={styles.field}><span>Số điện thoại</span><input type="tel" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} /></label>
    <label className={styles.field}><span>Email</span><input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></label>
    <label className={styles.field}><span>Ngôn ngữ ưu tiên</span><select value={form.preferredLocale} onChange={(event) => setForm((current) => ({ ...current, preferredLocale: event.target.value }))}><option value="vi-VN">Tiếng Việt</option><option value="en-US">English</option></select></label>
    <div className={styles.dialogActions}><button className={styles.secondaryButton} type="button" onClick={onClose}>Hủy</button><button className={styles.primaryButton} type="submit" disabled={submitting || versionConflict}>{submitting ? "Đang lưu…" : "Lưu thay đổi"}</button></div>
  </form></section></div>;
}

export default function Customer360Page({ customerId }: { customerId: string }) {
  const [state, setState] = useState<LoadState>("loading");
  const [data, setData] = useState<any>();
  const [error, setError] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const [loyalty, setLoyalty] = useState<OptionalResource>({ state: "loading" });
  const [membership, setMembership] = useState<OptionalResource>({ state: "loading" });

  const loadOptional = useCallback(async (path: string, label: string): Promise<OptionalResource> => {
    try {
      const response = await authorizedFetch(path);
      const body = await response.json().catch(() => ({}));
      if (response.status === 403) return { state: "forbidden" };
      if (!response.ok) return { state: "unavailable", error: unwrapError(body) };
      const value = body?.data;
      const empty = Array.isArray(value) ? value.length === 0 : !value;
      return empty ? { state: "empty" } : { state: "ready", data: value };
    } catch (cause: any) {
      return { state: "unavailable", error: cause?.message ?? `Không thể tải ${label}.` };
    }
  }, []);

  const load = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setState("offline");
      return;
    }
    setState("loading");
    setError("");
    setNotice("");
    setLoyalty({ state: "loading" });
    setMembership({ state: "loading" });
    try {
      const response = await authorizedFetch(`/v1/customers/${encodeURIComponent(customerId)}`);
      const body = await response.json().catch(() => ({}));
      if (response.status === 403) {
        setState("forbidden");
        return;
      }
      if (!response.ok) throw new Error(unwrapError(body));
      setData(body?.data);
      setState("ready");
      const [loyaltyResult, membershipResult] = await Promise.all([
        loadOptional(`/v1/customers/${encodeURIComponent(customerId)}/loyalty`, "điểm loyalty"),
        loadOptional(`/v1/customers/${encodeURIComponent(customerId)}/membership`, "hạng thành viên"),
      ]);
      setLoyalty(loyaltyResult);
      setMembership(membershipResult);
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể tải hồ sơ khách hàng.");
      setState(cause?.offline ? "offline" : "error");
    }
  }, [customerId, loadOptional]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let active = true;
    void getAuthContext().then((context) => {
      if (active) setCanEdit(context.authorization.permissions.includes("customer.update"));
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  if (state !== "ready") return <main className={styles.page}><a className={styles.backLink} href="/admin/customers">← Danh sách khách hàng</a><StatePanel state={state} error={error} retry={() => void load()} /></main>;

  const profile = data?.profile ?? {};
  const contact = data?.contact ?? {};
  const summary = data?.activitySummary ?? {};
  const appointments = Array.isArray(data?.recentAppointments) ? data.recentAppointments : [];
  const purchases = data?.recentPurchases ?? { access: "DENIED", items: [] };
  const refunds = data?.recentRefunds ?? { access: "DENIED", items: [] };
  const loyaltyAccount = loyalty.state === "ready" ? loyalty.data : undefined;
  const membershipRows = Array.isArray(membership.data) ? membership.data : Array.isArray(membership.data?.rows) ? membership.data.rows : [];
  const activeMembership = membershipRows.find((item: any) => String(item.status).toUpperCase() === "ACTIVE") ?? membershipRows[0];
  const nextAppointment = hasValue(summary.nextAppointmentAt)
    ? appointments.find((item: any) => item.scheduledStartAt && Math.abs(new Date(item.scheduledStartAt).getTime() - new Date(String(summary.nextAppointmentAt)).getTime()) < 60000)
    : undefined;
  const safeCustomerId = encodeURIComponent(customerId);
  const tabs = [
    { label: "Tổng quan", href: `/admin/customers/${safeCustomerId}` },
    { label: "Lịch hẹn", href: "/admin/appointments" },
    { label: "Dịch vụ", href: "/admin/financial/invoices" },
    { label: "Loyalty", href: `/admin/loyalty/customers/${safeCustomerId}` },
    { label: "Membership", href: `/admin/membership/customers/${safeCustomerId}` },
    { label: "Gift card", href: "/admin/gift-cards" },
    { label: "Thanh toán", href: "/admin/financial/payments" },
    { label: "Liên hệ", href: `/admin/customers/${safeCustomerId}/engagement` },
    { label: "Đánh giá", href: "/admin/reviews" },
  ];

  return <main className={styles.page}>
    <div className={styles.breadcrumb}><a href="/admin/customers">Khách hàng</a><span>/</span><span>{profile.displayName || "Chi tiết khách hàng"}</span></div>
    <header className={styles.pageHeader}><div><p className={styles.eyebrow}>HỒ SƠ KHÁCH HÀNG</p><h1>Chi tiết khách hàng</h1><p className={styles.subtitle}>Theo dõi lịch hẹn, dịch vụ, quyền lợi và lịch sử chăm sóc tại salon.</p></div><div className={styles.headerActions}><a className={styles.secondaryButton} href="/admin/customers">← Danh sách</a>{canEdit ? <button className={styles.primaryButton} type="button" onClick={() => setEditing(true)}>Chỉnh sửa hồ sơ</button> : null}<a className={styles.primaryButton} href={`/admin/appointments/new?customerId=${safeCustomerId}`}>＋ Tạo lịch hẹn</a></div></header>
    {notice ? <div className={`${styles.notice} ${styles.noticeSuccess}`} role="status">{notice}</div> : null}

    <section className={styles.hero} aria-labelledby="customer-name"><div className={styles.heroIdentity}><div className={styles.avatar}>{initials(profile.displayName)}</div><div className={styles.identityText}><div className={styles.nameLine}><h2 id="customer-name">{profile.displayName || "Khách hàng"}</h2>{hasValue(profile.customerCode) ? <span className={styles.code}>{profile.customerCode}</span> : null}</div><div className={styles.badges}><span className={`${styles.badge} ${styles.badgePink}`}>{profile.isGuest ? "Khách vãng lai" : "Khách hàng"}</span><span className={`${styles.badge} ${statusTone(profile.status)}`}>{statusLabel(profile.status)}</span></div><div className={styles.contactLine}>{contact.access === "DENIED" ? <span>Thông tin liên hệ bị giới hạn</span> : <><span>☎ {contact.phone || "Chưa có số điện thoại"}</span><span>✉ {contact.email || "Chưa có email"}</span></>}</div></div></div><div className={styles.heroMeta}><DefinitionList items={[{ label: "Khách hàng từ", value: dateOnly(profile.createdAt) }, { label: "Ngôn ngữ", value: profile.preferredLocale || "—" }, ...(hasValue(profile.customerCode) ? [{ label: "Mã hồ sơ", value: profile.customerCode }] : [])]} /></div><div className={styles.heroMetrics}><Metric icon="▣" label="Lịch hẹn" value={integer(summary.appointmentCount)} /><Metric icon="✓" label="Đã hoàn tất" value={integer(summary.completedVisitCount)} /><Metric icon="◎" label="Điểm loyalty" value={loyaltyAccount ? integer(loyaltyAccount.availablePoints) : "—"} /><Metric icon="◷" label="Lần ghé gần nhất" value={summary.lastVisitAt ? dateOnly(summary.lastVisitAt) : "—"} /><Metric icon="₫" label="Tổng chi tiêu" value={hasValue(summary.totalSpendMinor) ? money(summary.totalSpendMinor, summary.currency) : "Chưa có dữ liệu"} /></div></section>

    <nav className={styles.tabs} aria-label="Điều hướng hồ sơ khách hàng">{tabs.map((tab, index) => <a className={index === 0 ? styles.activeTab : ""} key={tab.label} href={tab.href}>{tab.label}</a>)}</nav>

    <div className={styles.contentGrid}><div className={styles.mainColumn}>
      <Card title="Lịch hẹn sắp tới" eyebrow="LỊCH HẸN" action={<a className={styles.textButton} href="/admin/appointments">Xem lịch hẹn →</a>}>
        {hasValue(summary.nextAppointmentAt) ? <div className={styles.nextAppointment}><div className={styles.dateTile}><strong>{new Date(String(summary.nextAppointmentAt)).getDate()}</strong><span>{new Intl.DateTimeFormat("vi-VN", { month: "short" }).format(new Date(String(summary.nextAppointmentAt)))}</span></div><div className={styles.nextAppointmentBody}><div className={styles.nextAppointmentHeading}><strong>{dateTime(summary.nextAppointmentAt)}</strong><span className={`${styles.statusPill} ${statusTone(nextAppointment?.status ?? "PENDING")}`}>{statusLabel(nextAppointment?.status ?? "PENDING")}</span></div><span>{nextAppointment?.bookingReference ? `Mã lịch: ${nextAppointment.bookingReference}` : "Thông tin dịch vụ và kỹ thuật viên chưa được trả về trong API chi tiết."}</span><div className={styles.inlineLinks}><a className={styles.secondaryButton} href="/admin/appointments">Mở danh sách lịch hẹn</a><a className={styles.secondaryButton} href={`/admin/appointments/new?customerId=${safeCustomerId}`}>Đặt lịch mới</a></div></div></div> : <EmptyState title="Chưa có lịch hẹn sắp tới" detail="Lịch hẹn mới sẽ xuất hiện sau khi được tạo và lưu thành công." />}
      </Card>

      <Card title="Lịch sử lịch hẹn" eyebrow="HOẠT ĐỘNG GẦN ĐÂY" action={<a className={styles.textButton} href="/admin/appointments">Xem toàn bộ →</a>}>
        {appointments.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Mã lịch</th><th>Thời gian</th><th>Trạng thái</th><th /></tr></thead><tbody>{appointments.map((item: any) => <tr key={item.id}><td><strong>{item.bookingReference || "—"}</strong></td><td>{dateTime(item.scheduledStartAt)}</td><td><span className={`${styles.statusPill} ${statusTone(item.status)}`}>{statusLabel(item.status)}</span></td><td><a className={styles.rowLink} href="/admin/appointments">Mở lịch hẹn</a></td></tr>)}</tbody></table></div> : <EmptyState title="Chưa có lịch sử lịch hẹn" />}
      </Card>

      <div className={styles.twoColumns}><Card title="Mua hàng gần đây" eyebrow="TÀI CHÍNH" action={<a className={styles.textButton} href="/admin/financial/invoices">Mở hóa đơn →</a>}>{purchases.access === "DENIED" ? <EmptyState title="Lịch sử mua hàng bị giới hạn" detail="Cần quyền hóa đơn để xem dữ liệu tài chính của khách hàng." /> : purchases.items?.length ? <div className={styles.compactList}>{purchases.items.slice(0, 5).map((item: any) => <div className={styles.compactRow} key={item.invoiceId}><div><strong>{item.invoiceNumber || item.invoiceId || "Hóa đơn"}</strong><span>{dateTime(item.issuedAt)}{item.branchId ? " · Chi nhánh đã phân quyền" : ""}</span></div><b>{money(item.totalMinor, item.currency)}</b></div>)}</div> : <EmptyState title="Chưa có hóa đơn" />}</Card><Card title="Hoàn tiền gần đây" eyebrow="TÀI CHÍNH" action={<a className={styles.textButton} href="/admin/refunds">Mở refund →</a>}>{refunds.access === "DENIED" ? <EmptyState title="Lịch sử hoàn tiền bị giới hạn" detail="Cần quyền refund để xem dữ liệu." /> : refunds.items?.length ? <div className={styles.compactList}>{refunds.items.slice(0, 5).map((item: any) => <div className={styles.compactRow} key={item.refundId}><div><strong>{item.refundReference || item.refundId || "Yêu cầu hoàn tiền"}</strong><span>{dateTime(item.createdAt)}</span></div><b>{money(item.completedMinor ?? item.requestedMinor, item.currency)}</b></div>)}</div> : <EmptyState title="Chưa có yêu cầu hoàn tiền" />}</Card></div>

      <Card title="Tóm tắt hồ sơ" eyebrow="THÔNG TIN SERVER" action={<a className={styles.textButton} href={`/admin/customers/${safeCustomerId}/engagement`}>Mở engagement →</a>}><DefinitionList items={[{ label: "Trạng thái hồ sơ", value: statusLabel(profile.status) }, { label: "Khách vãng lai", value: profile.isGuest ? "Có" : "Không" }, { label: "Số lần đặt lịch", value: integer(summary.appointmentCount) }, { label: "Số lượt hoàn tất", value: integer(summary.completedVisitCount) }, { label: "Lần ghé gần nhất", value: dateTime(summary.lastVisitAt) }, { label: "Lần ghé tiếp theo", value: dateTime(summary.nextAppointmentAt) }]} /></Card>
    </div><aside className={styles.rail}>
      <Card title="Thông tin khách hàng" eyebrow="HỒ SƠ"><DefinitionList items={[{ label: "Họ và tên", value: profile.displayName || "—" }, { label: "Số điện thoại", value: contact.access === "DENIED" ? "Bị giới hạn" : contact.phone || "Chưa có" }, { label: "Email", value: contact.access === "DENIED" ? "Bị giới hạn" : contact.email || "Chưa có" }, { label: "Ngôn ngữ", value: profile.preferredLocale || "—" }, { label: "Tạo hồ sơ", value: dateOnly(profile.createdAt) }]} /><div className={styles.cardActions}>{canEdit ? <button className={styles.secondaryButton} type="button" onClick={() => setEditing(true)}>Chỉnh sửa thông tin</button> : null}<a className={styles.secondaryButton} href={`/admin/customers/${safeCustomerId}/engagement`}>Cài đặt liên hệ</a></div></Card>

      <Card title="Loyalty" eyebrow="QUYỀN LỢI KHÁCH HÀNG" action={<a className={styles.textButton} href={`/admin/loyalty/customers/${safeCustomerId}`}>Chi tiết →</a>}><OptionalState resource={loyalty} label="điểm loyalty" />{loyalty.state === "ready" ? <><div className={styles.balance}><strong>{integer(loyaltyAccount?.availablePoints)}</strong><span>điểm khả dụng</span></div><div className={styles.progress}><span style={{ width: loyaltyAccount?.lifetimeEarnedPoints ? `${Math.min(100, (Number(loyaltyAccount.availablePoints ?? 0) / Number(loyaltyAccount.lifetimeEarnedPoints)) * 100)}%` : "0%" }} /></div><DefinitionList items={[{ label: "Đang chờ", value: integer(loyaltyAccount?.pendingPoints) }, { label: "Đang giữ", value: integer(loyaltyAccount?.reservedPoints) }, { label: "Tích lũy trọn đời", value: integer(loyaltyAccount?.lifetimeEarnedPoints) }]} /></> : loyalty.state === "empty" ? <EmptyState title="Chưa có tài khoản loyalty" detail="Điểm chỉ được hiển thị khi server đã tạo tài khoản loyalty." /> : null}</Card>

      <Card title="Membership" eyebrow="HẠNG THÀNH VIÊN" action={<a className={styles.textButton} href={`/admin/membership/customers/${safeCustomerId}`}>Lịch sử →</a>}><OptionalState resource={membership} label="hạng thành viên" />{membership.state === "ready" && activeMembership ? <div className={styles.membership}><strong>{activeMembership.tierName?.["vi-VN"] ?? activeMembership.tierName ?? activeMembership.name ?? activeMembership.code ?? "Hạng thành viên"}</strong><span className={`${styles.statusPill} ${statusTone(activeMembership.status)}`}>{statusLabel(activeMembership.status)}</span><small>{dateOnly(activeMembership.effectiveFrom ?? activeMembership.effective_from)} → {dateOnly(activeMembership.effectiveTo ?? activeMembership.effective_to)}</small></div> : membership.state === "empty" ? <EmptyState title="Chưa có hạng thành viên" detail="Hạng và thời hạn được đọc từ membership service." /> : null}</Card>

      <Card title="Sở thích & chăm sóc" eyebrow="DỮ LIỆU MỞ RỘNG"><EmptyState title="Chưa có dữ liệu cấu hình" detail="Sở thích, tag và ghi chú chăm sóc chưa nằm trong API hồ sơ hiện tại." /><a className={styles.secondaryButton} href={`/admin/customers/${safeCustomerId}/engagement`}>Mở trung tâm engagement</a></Card>

      <Card title="Truy cập nhanh" eyebrow="CÁC DOMAIN LIÊN QUAN"><div className={styles.linkList}><LinkArrow href={`/admin/benefits/customers/${safeCustomerId}`}>Ví quyền lợi</LinkArrow><LinkArrow href="/admin/packages/entitlements">Gói dịch vụ</LinkArrow><LinkArrow href="/admin/gift-cards">Gift card</LinkArrow><LinkArrow href="/admin/customer-credit">Store credit</LinkArrow><LinkArrow href="/admin/reviews">Đánh giá</LinkArrow></div></Card>
    </aside></div>
    <footer className={styles.stickyFooter}><a className={styles.secondaryButton} href="/admin/customers">← Danh sách khách hàng</a><div><a className={styles.secondaryButton} href={`/admin/appointments/new?customerId=${safeCustomerId}`}>＋ Tạo lịch hẹn</a>{canEdit ? <button className={styles.primaryButton} type="button" onClick={() => setEditing(true)}>Chỉnh sửa hồ sơ</button> : null}</div></footer>
    {editing ? <CustomerEditDialog data={data} customerId={customerId} onClose={() => setEditing(false)} onSaved={async () => { await load(); setNotice("Đã lưu thay đổi hồ sơ khách hàng."); }} /> : null}
  </main>;
}

function Metric({ icon, label, value }: { icon: string; label: string; value: string }) {
  return <div className={styles.metric}><span className={styles.metricIcon} aria-hidden="true">{icon}</span><div><span>{label}</span><strong>{value}</strong></div></div>;
}

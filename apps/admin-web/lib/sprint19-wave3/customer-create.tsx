/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authorizedFetch } from "../auth";
import styles from "./customer-create.module.css";

type ActionMode = "list" | "profile" | "appointment";
type DuplicateState = "idle" | "checking" | "clear" | "possible" | "unavailable";
type FormState = { displayName: string; phone: string; email: string; locale: "vi-VN" | "en-US" };
type Customer = { id: string; customerCode?: string | null; displayName?: string; phone?: string | null; email?: string | null; resolution?: "CREATED" | "EXISTING" };

const initialForm: FormState = { displayName: "", phone: "", email: "", locale: "vi-VN" };

function errorMessage(body: any, fallback: string) {
  return body?.error?.message ?? body?.message ?? fallback;
}

function rows(body: any): Customer[] {
  return Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "KH";
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function contactLabel(customer: Customer) {
  return customer.phone || customer.email || "Thông tin liên hệ được giới hạn";
}

function createAppointmentHref(customerId: string) {
  return `/admin/appointments/new?${new URLSearchParams({ customerId }).toString()}`;
}

function Button({
  children,
  variant = "secondary",
  type = "button",
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "quiet";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
}) {
  const variantClass = variant === "primary" ? styles.buttonPrimary : variant === "quiet" ? styles.buttonQuiet : styles.buttonSecondary;
  return <button className={`${styles.button} ${variantClass}`} type={type} disabled={disabled} onClick={onClick}>{children}</button>;
}

export default function CustomerCreate() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const idempotencyKeyRef = useRef<string | undefined>(undefined);
  const duplicateSequence = useRef(0);
  const duplicateController = useRef<AbortController | undefined>(undefined);
  const actionModeRef = useRef<ActionMode>("profile");
  const [form, setForm] = useState<FormState>(initialForm);
  const [validation, setValidation] = useState<string[]>([]);
  const [duplicateState, setDuplicateState] = useState<DuplicateState>("idle");
  const [duplicateError, setDuplicateError] = useState("");
  const [candidates, setCandidates] = useState<Customer[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [pendingMode, setPendingMode] = useState<ActionMode | undefined>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resolvedCustomer, setResolvedCustomer] = useState<Customer>();
  const [savedResolution, setSavedResolution] = useState<"CREATED" | "EXISTING">();

  useEffect(() => {
    const query = form.phone.trim() || form.email.trim();
    duplicateController.current?.abort();
    if (query.length < 3) {
      setDuplicateState("idle");
      setDuplicateError("");
      setCandidates([]);
      return;
    }
    const sequence = ++duplicateSequence.current;
    const controller = new AbortController();
    duplicateController.current = controller;
    const timer = window.setTimeout(() => {
      setDuplicateState("checking");
      setDuplicateError("");
      void authorizedFetch(`/v1/customers?${new URLSearchParams({ search: query, limit: "5" }).toString()}`, { signal: controller.signal })
        .then(async (response) => {
          const body = await response.json().catch(() => ({}));
          if (sequence !== duplicateSequence.current) return;
          if (response.status === 403) throw new Error("Bạn chưa có quyền kiểm tra trùng khách hàng.");
          if (!response.ok) throw new Error(errorMessage(body, "Không thể kiểm tra trùng lúc này."));
          const found = rows(body);
          setCandidates(found);
          setDuplicateState(found.length ? "possible" : "clear");
        })
        .catch((cause: any) => {
          if (cause?.name === "AbortError" || sequence !== duplicateSequence.current) return;
          setCandidates([]);
          setDuplicateState("unavailable");
          setDuplicateError(cause?.message ?? "Không thể kiểm tra trùng lúc này.");
        });
    }, 360);
    return () => window.clearTimeout(timer);
  }, [form.email, form.phone]);

  const completeness = useMemo(() => {
    const checks = [Boolean(form.displayName.trim()), Boolean(form.phone.trim() || form.email.trim()), Boolean(form.email.trim()), Boolean(form.locale)];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [form]);

  const steps = useMemo(() => [
    { number: "1", label: "Thông tin cơ bản", complete: Boolean(form.displayName.trim()), unavailable: false },
    { number: "2", label: "Liên hệ", complete: Boolean(form.phone.trim() || form.email.trim()), unavailable: false },
    { number: "3", label: "Sở thích & chăm sóc", complete: false, unavailable: true },
    { number: "4", label: "Loyalty & consent", complete: false, unavailable: true },
  ], [form.displayName, form.email, form.phone]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    idempotencyKeyRef.current = undefined;
    setValidation([]);
    setError("");
  }

  function requestSubmit(mode: ActionMode) {
    actionModeRef.current = mode;
    setPendingMode(mode);
    formRef.current?.requestSubmit();
  }

  function validate() {
    const errors: string[] = [];
    if (!form.displayName.trim()) errors.push("Vui lòng nhập họ và tên.");
    if (!form.phone.trim() && !form.email.trim()) errors.push("Cần ít nhất số điện thoại hoặc email.");
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.push("Email chưa đúng định dạng.");
    return errors;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setResolvedCustomer(undefined);
    setSavedResolution(undefined);
    const errors = validate();
    setValidation(errors);
    if (errors.length) {
      setPendingMode(undefined);
      return;
    }
    setSubmitting(true);
    const key = idempotencyKeyRef.current ?? crypto.randomUUID();
    idempotencyKeyRef.current = key;
    try {
      const response = await authorizedFetch("/v1/customers", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify({ displayName: form.displayName.trim(), phone: form.phone.trim() || undefined, email: form.email.trim() || undefined, locale: form.locale }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 403) throw new Error(errorMessage(body, "Bạn không có quyền tạo khách hàng."));
      if (!response.ok) throw new Error(errorMessage(body, "Không thể lưu khách hàng."));
      const customer = body?.data as Customer | undefined;
      if (!customer?.id) throw new Error("API không trả về mã khách hàng hợp lệ.");
      const resolution = customer.resolution ?? (candidates.some((candidate) => candidate.id === customer.id) ? "EXISTING" : "CREATED");
      setResolvedCustomer(customer);
      setSavedResolution(resolution);
      if (resolution === "EXISTING") {
        setNotice("Hệ thống xác định thông tin liên hệ thuộc một hồ sơ đã có. Chưa tạo hồ sơ mới.");
      } else {
        setNotice("Đã lưu khách hàng thành công.");
        const mode = actionModeRef.current;
        if (mode === "list") router.push("/admin/customers");
        if (mode === "profile") router.push(`/admin/customers/${encodeURIComponent(customer.id)}`);
        if (mode === "appointment") router.push(createAppointmentHref(customer.id));
      }
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể lưu khách hàng.");
    } finally {
      setSubmitting(false);
      setPendingMode(undefined);
    }
  }

  const previewName = form.displayName.trim() || "Khách hàng mới";
  const isSaved = Boolean(resolvedCustomer && savedResolution);

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>KHÁCH HÀNG</p><h1>Tạo khách hàng mới</h1><p>Thêm hồ sơ khách hàng để quản lý lịch hẹn, lịch sử dịch vụ và chăm sóc lâu dài.</p></div>
      <div className={styles.headerActions}><a className={`${styles.button} ${styles.buttonSecondary}`} href="/admin/customers">← Danh sách khách hàng</a><Button variant="quiet" onClick={() => router.push("/admin/customers")}>Hủy</Button><Button variant="primary" onClick={() => requestSubmit("list")} disabled={submitting}>{pendingMode === "list" ? "Đang lưu…" : "Lưu khách hàng"}</Button></div>
    </header>

    <nav className={styles.stepper} aria-label="Tiến độ tạo hồ sơ">{steps.map((step) => <div className={`${styles.step} ${step.complete ? styles.stepComplete : ""} ${step.unavailable ? styles.stepUnavailable : ""}`} key={step.number}><span>{step.complete ? "✓" : step.number}</span><strong>{step.label}</strong></div>)}</nav>

    {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert"><strong>Không thể lưu khách hàng</strong><span>{error}</span></div> : null}
    {notice ? <div className={`${styles.notice} ${savedResolution === "CREATED" ? styles.noticeSuccess : styles.noticeInfo}`} role="status" aria-live="polite"><strong>{savedResolution === "CREATED" ? "Đã lưu" : "Kiểm tra hồ sơ hiện có"}</strong><span>{notice}</span></div> : null}

    {isSaved && resolvedCustomer ? <section className={styles.resolution} aria-labelledby="resolution-title"><div className={styles.resolutionIcon}>{savedResolution === "EXISTING" ? "!" : "✓"}</div><div className={styles.resolutionCopy}><p className={styles.eyebrow}>{savedResolution === "EXISTING" ? "HỒ SƠ ĐÃ TỒN TẠI" : "HỒ SƠ ĐÃ ĐƯỢC TẠO"}</p><h2 id="resolution-title">{resolvedCustomer.displayName ?? previewName}</h2><p>{contactLabel(resolvedCustomer)} · Mã hồ sơ: {resolvedCustomer.customerCode ?? "Mã hệ thống"}</p><div className={styles.resolutionActions}><a className={`${styles.button} ${styles.buttonPrimary}`} href={`/admin/customers/${encodeURIComponent(resolvedCustomer.id)}`}>Mở hồ sơ</a><a className={`${styles.button} ${styles.buttonSecondary}`} href={createAppointmentHref(resolvedCustomer.id)}>Dùng hồ sơ để tạo lịch hẹn</a><a className={`${styles.button} ${styles.buttonQuiet}`} href="/admin/customers">Về danh sách</a></div></div></section> : null}

    <div className={styles.contentGrid}>
      <form ref={formRef} className={styles.formColumn} onSubmit={(event) => void submit(event)} noValidate>
        <section className={styles.card} aria-labelledby="basic-title"><div className={styles.cardHeading}><div><p className={styles.eyebrow}>BƯỚC 1 · BẮT BUỘC</p><h2 id="basic-title">Thông tin cơ bản</h2><p>Nhập thông tin được hệ thống dùng để nhận diện hồ sơ khách hàng.</p></div><span className={styles.requiredBadge}>* Bắt buộc</span></div>
          {validation.length ? <div className={styles.inlineError} role="alert"><strong>Vui lòng kiểm tra lại</strong><ul>{validation.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
          <div className={styles.fieldGrid}>
            <label className={styles.fieldWide} htmlFor="customer-display-name"><span>Họ và tên <b>*</b></span><input id="customer-display-name" value={form.displayName} onChange={(event) => setField("displayName", event.target.value)} maxLength={200} autoComplete="name" placeholder="Nhập tên khách hàng" aria-invalid={validation.some((item) => item.includes("họ và tên"))} /><small>Tên sẽ hiển thị trong lịch hẹn và hồ sơ khách hàng.</small></label>
            <label htmlFor="customer-phone"><span>Số điện thoại</span><input id="customer-phone" value={form.phone} onChange={(event) => setField("phone", event.target.value)} maxLength={32} inputMode="tel" autoComplete="tel" placeholder="0900 000 000" /><small>Backend sẽ chuẩn hóa trước khi kiểm tra trùng.</small></label>
            <label htmlFor="customer-email"><span>Email</span><input id="customer-email" value={form.email} onChange={(event) => setField("email", event.target.value)} maxLength={254} type="email" autoComplete="email" placeholder="khachhang@example.com" aria-invalid={validation.some((item) => item.includes("Email"))} /><small>Có thể tạo hồ sơ bằng email mà không cần số điện thoại.</small></label>
            <label htmlFor="customer-locale"><span>Ngôn ngữ ưu tiên</span><select id="customer-locale" value={form.locale} onChange={(event) => setField("locale", event.target.value as FormState["locale"])}><option value="vi-VN">Tiếng Việt</option><option value="en-US">English</option></select><small>Dùng cho các nội dung giao tiếp được hỗ trợ.</small></label>
          </div>
          <div className={styles.duplicateStrip} role="status" aria-live="polite"><span className={`${styles.statusDot} ${duplicateState === "possible" ? styles.statusDotWarning : duplicateState === "unavailable" ? styles.statusDotMuted : styles.statusDotSuccess}`}></span><div><strong>{duplicateState === "checking" ? "Đang kiểm tra thông tin trùng…" : duplicateState === "possible" ? "Có thể đã tồn tại hồ sơ trùng" : duplicateState === "unavailable" ? "Chưa kiểm tra được trùng hồ sơ" : "Kiểm tra trùng hồ sơ"}</strong><small>{duplicateState === "possible" ? "Đây là kiểm tra sơ bộ. Kết quả POST của backend mới là quyết định cuối cùng." : duplicateState === "clear" ? "Chưa thấy hồ sơ phù hợp trong danh bạ hiện tại; backend vẫn sẽ kiểm tra lại khi lưu." : duplicateState === "unavailable" ? duplicateError : "Nhập số điện thoại hoặc email để hệ thống tra cứu advisory."}</small></div>{duplicateState === "possible" ? <span className={styles.statusPillWarning}>Cần xem lại</span> : null}</div>
          {candidates.length ? <div className={styles.candidateList}><p>Hồ sơ được tìm thấy trong tra cứu sơ bộ:</p>{candidates.slice(0, 3).map((candidate) => <div className={styles.candidate} key={candidate.id}><span className={styles.candidateAvatar}>{initials(candidate.displayName ?? "KH")}</span><div><strong>{candidate.displayName ?? "Khách hàng"}</strong><small>{contactLabel(candidate)}</small></div><a href={`/admin/customers/${encodeURIComponent(candidate.id)}`}>Mở hồ sơ</a></div>)}</div> : null}
        </section>

        <section className={styles.card} aria-labelledby="contact-title"><div className={styles.cardHeading}><div><p className={styles.eyebrow}>BƯỚC 2 · TÙY CHỌN</p><h2 id="contact-title">Thông tin liên hệ bổ sung</h2><p>Các trường mở rộng được hiển thị để tránh hiểu nhầm phạm vi lưu dữ liệu hiện tại.</p></div><span className={styles.unsupportedBadge}>Chưa cấu hình</span></div><div className={styles.unsupportedGrid}><div><span>Ngày sinh</span><b>Chưa được cấu hình</b></div><div><span>Giới tính</span><b>Chưa được cấu hình</b></div><div><span>Địa chỉ</span><b>Chưa được cấu hình</b></div><div><span>Nguồn khách / chiến dịch</span><b>Chưa được cấu hình</b></div></div><p className={styles.helperNote}>Các mục này chưa có API persistence trong contract tạo khách hàng hiện tại nên không cho nhập giả và không gửi kèm POST /v1/customers.</p></section>

        <section className={styles.card} aria-labelledby="care-title"><div className={styles.cardHeading}><div><p className={styles.eyebrow}>BƯỚC 3 · TÙY CHỌN</p><h2 id="care-title">Sở thích & chăm sóc</h2><p>Sở thích dịch vụ, kỹ thuật viên yêu thích và ghi chú cần được lưu bằng domain API riêng.</p></div><span className={styles.unsupportedBadge}>Chưa cấu hình</span></div><div className={styles.emptyFeature}><span className={styles.emptyIcon}>✦</span><div><strong>Chưa có persistence cho các trường này</strong><p>Không hiển thị ô nhập để tránh tạo dữ liệu chỉ nằm trong giao diện. Bạn vẫn có thể bổ sung sau khi hồ sơ được tạo nếu domain tương ứng được bật.</p></div></div></section>

        <section className={styles.card} aria-labelledby="consent-title"><div className={styles.cardHeading}><div><p className={styles.eyebrow}>BƯỚC 4 · DOMAIN RIÊNG</p><h2 id="consent-title">Loyalty & consent</h2><p>Điểm, hạng thành viên và consent không được tự gán trong lúc tạo hồ sơ.</p></div><span className={styles.unsupportedBadge}>Chưa phát sinh</span></div><div className={styles.consentInfo}><div><strong>Không tự tạo điểm thưởng hoặc membership</strong><span>Loyalty chỉ phát sinh từ giao dịch đủ điều kiện và nghiệp vụ riêng.</span></div><div><strong>Consent được quản lý riêng</strong><span>Không dùng một cờ marketingConsent để thay thế communication preferences/consents của backend.</span></div></div></section>
      </form>

      <aside className={styles.sideColumn} aria-label="Xem trước hồ sơ">
        <section className={`${styles.card} ${styles.previewCard}`}><div className={styles.cardHeading}><div><p className={styles.eyebrow}>XEM TRƯỚC HỒ SƠ</p><h2>Khách hàng mới</h2></div><span className={styles.newBadge}>Mới</span></div><div className={styles.profilePreview}><span className={styles.avatar}>{initials(previewName)}</span><div><h3>{previewName}</h3><p>{form.phone.trim() || "Chưa có số điện thoại"}</p><p>{form.email.trim() || "Chưa có email"}</p></div></div><dl className={styles.previewList}><div><dt>Mã khách hàng</dt><dd>Tự động tạo khi lưu</dd></div><div><dt>Ngôn ngữ</dt><dd>{form.locale === "vi-VN" ? "Tiếng Việt" : "English"}</dd></div><div><dt>Trạng thái</dt><dd><span className={styles.statusPillInfo}>Hồ sơ mới</span></dd></div></dl></section>

        <section className={styles.card} aria-labelledby="completeness-title"><div className={styles.cardHeading}><div><p className={styles.eyebrow}>MỨC ĐỘ HOÀN THIỆN</p><h2 id="completeness-title">{completeness}% hồ sơ lõi</h2></div><span className={styles.progressValue}>{completeness}%</span></div><div className={styles.progressTrack}><span style={{ width: `${completeness}%` }} /></div><ul className={styles.checkList}><li className={form.displayName.trim() ? styles.done : ""}><span>{form.displayName.trim() ? "✓" : "1"}</span>Họ và tên</li><li className={form.phone.trim() || form.email.trim() ? styles.done : ""}><span>{form.phone.trim() || form.email.trim() ? "✓" : "2"}</span>Số điện thoại hoặc email</li><li className={form.email.trim() ? styles.done : ""}><span>{form.email.trim() ? "✓" : "3"}</span>Email (tùy chọn)</li><li className={form.locale ? styles.done : ""}><span>{form.locale ? "✓" : "4"}</span>Ngôn ngữ ưu tiên</li></ul></section>

        <section className={styles.card}><div className={styles.cardHeading}><div><p className={styles.eyebrow}>DÒNG ĐỜI HỒ SƠ</p><h2>Loyalty & membership</h2></div></div><div className={styles.notAvailable}><strong>Chưa phát sinh</strong><span>Điểm tích lũy, hạng thành viên và gói dịch vụ sẽ do domain tương ứng cung cấp sau giao dịch.</span></div></section>

        <section className={styles.card}><div className={styles.cardHeading}><div><p className={styles.eyebrow}>SAU KHI LƯU</p><h2>Chọn bước tiếp theo</h2></div></div><div className={styles.actionChoices}><button type="button" className={styles.actionChoice} onClick={() => requestSubmit("list")}><span className={styles.radio}></span><span><strong>Chỉ lưu hồ sơ</strong><small>Quay lại danh sách khách hàng.</small></span></button><button type="button" className={styles.actionChoice} onClick={() => requestSubmit("appointment")}><span className={styles.radio}></span><span><strong>Lưu và tạo lịch hẹn</strong><small>Mở luồng tạo lịch với đúng customerId.</small></span></button><button type="button" className={styles.actionChoice} onClick={() => requestSubmit("profile")}><span className={styles.radio}></span><span><strong>Lưu và mở hồ sơ</strong><small>Đi tới chi tiết hồ sơ vừa tạo.</small></span></button></div></section>

        <section className={styles.card}><div className={styles.cardHeading}><div><p className={styles.eyebrow}>PHẠM VI DỮ LIỆU</p><h2>Backend là nguồn sự thật</h2></div></div><p className={styles.helperNote}>Form chỉ gửi displayName, phone, email và locale. Chuẩn hóa liên hệ, chống trùng, idempotency và mã khách hàng đều do API xử lý.</p></section>
      </aside>
    </div>

    <footer className={styles.stickyFooter}><a className={`${styles.button} ${styles.buttonQuiet}`} href="/admin/customers">← Danh sách khách hàng</a><div><Button variant="quiet" onClick={() => router.push("/admin/customers")}>Hủy</Button><Button variant="secondary" onClick={() => requestSubmit("profile")} disabled={submitting}>{pendingMode === "profile" ? "Đang lưu…" : "Lưu & mở hồ sơ"}</Button><Button variant="primary" onClick={() => requestSubmit("list")} disabled={submitting}>{pendingMode === "list" ? "Đang lưu…" : "Lưu khách hàng"}</Button></div></footer>
  </main>;
}

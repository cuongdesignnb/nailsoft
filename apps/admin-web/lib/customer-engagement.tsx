/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { authorizedFetch } from "./auth";

type CustomerSurfaceMode = "preferences" | "consents" | "unsubscribe" | "review";
type PublicLocale = "vi-VN" | "en-US";

const copy = {
  "vi-VN": {
    eyebrow: "NAILSOFT · KHÔNG GIAN KHÁCH HÀNG",
    brand: "NailSoft",
    brandSub: "Beauty booking",
    book: "Đặt lịch",
    manage: "Quản lý lịch hẹn",
    language: "Ngôn ngữ",
    preferencesTitle: "Quyền liên hệ của bạn",
    consentsTitle: "Lựa chọn đồng ý",
    unsubscribeTitle: "Quản lý email marketing",
    reviewTitle: "Chia sẻ trải nghiệm tại salon",
    preferencesHint: "Cập nhật cách salon liên hệ với bạn. Email giao dịch vẫn được tách riêng khỏi email marketing.",
    consentsHint: "Bạn có thể thay đổi lựa chọn bất cứ lúc nào. Mỗi thay đổi được ghi nhận theo chính sách của salon.",
    unsubscribeHint: "Yêu cầu này chỉ ảnh hưởng đến nội dung marketing. Email xác nhận và thông báo giao dịch vẫn có thể được gửi.",
    reviewHint: "Đánh giá được liên kết với lần ghé salon đã xác minh và chỉ dùng cho mục đích cải thiện dịch vụ.",
    loading: "Đang tải thông tin…",
    retry: "Thử lại",
    errorTitle: "Chưa thể tải thông tin",
    errorDetail: "Vui lòng thử lại hoặc mở lại liên kết từ salon.",
    forbidden: "Bạn không có quyền truy cập thông tin này.",
    empty: "Hiện chưa có thông tin để hiển thị.",
    locale: "Ngôn ngữ ưu tiên",
    timezone: "Múi giờ",
    email: "Email nhận thông tin",
    save: "Lưu thay đổi",
    saved: "Thay đổi đã được lưu.",
    allow: "Cho phép",
    withdraw: "Rút lại",
    granted: "Đã đồng ý",
    withdrawn: "Đã rút lại",
    notGranted: "Chưa đồng ý",
    updated: "Cập nhật lần cuối",
    marketing: "Email marketing",
    reviewRequest: "Email mời đánh giá",
    recovery: "Liên hệ xử lý trải nghiệm",
    research: "Nghiên cứu khách hàng",
    withdrawCta: "Xác nhận không nhận email marketing",
    successTitle: "Đã tiếp nhận yêu cầu",
    successDetail: "Lựa chọn của bạn đã được gửi tới hệ thống.",
    bookingReference: "Mã lịch hẹn",
    branch: "Chi nhánh",
    reviewStatus: "Trạng thái lời mời",
    rating: "Mức đánh giá",
    comment: "Chia sẻ thêm (không bắt buộc)",
    submitReview: "Gửi đánh giá",
    reviewReceived: "Cảm ơn bạn đã chia sẻ",
    reviewReceivedHint: "Đánh giá của bạn đã được tiếp nhận an toàn.",
    invalidReview: "Liên kết đánh giá không hợp lệ hoặc đã hết hạn.",
    validReview: "Lời mời đánh giá đã được xác minh",
    transactionalNotice: "Email giao dịch không bị ảnh hưởng bởi lựa chọn marketing.",
    privacy: "Thông tin được xử lý theo chính sách riêng tư của salon.",
    invalidUnsubscribe: "Liên kết quản lý email không hợp lệ.",
    invalidUnsubscribeDetail: "Vui lòng mở lại liên kết từ email gần nhất của salon.",
  },
  "en-US": {
    eyebrow: "NAILSOFT · CUSTOMER SPACE",
    brand: "NailSoft",
    brandSub: "Beauty booking",
    book: "Book appointment",
    manage: "Manage booking",
    language: "Language",
    preferencesTitle: "Your communication preferences",
    consentsTitle: "Consent choices",
    unsubscribeTitle: "Manage marketing email",
    reviewTitle: "Share your salon experience",
    preferencesHint: "Choose how the salon contacts you. Transactional email stays separate from marketing email.",
    consentsHint: "You can change your choices at any time. Each change is recorded according to salon policy.",
    unsubscribeHint: "This request only affects marketing content. Transactional confirmations may still be sent.",
    reviewHint: "Your review is linked to a verified salon visit and helps improve the service.",
    loading: "Loading your information…",
    retry: "Try again",
    errorTitle: "We could not load this information",
    errorDetail: "Please try again or open the link from the salon again.",
    forbidden: "You do not have access to this information.",
    empty: "There is no information to show yet.",
    locale: "Preferred language",
    timezone: "Timezone",
    email: "Email address",
    save: "Save changes",
    saved: "Your changes were saved.",
    allow: "Allow",
    withdraw: "Withdraw",
    granted: "Granted",
    withdrawn: "Withdrawn",
    notGranted: "Not granted",
    updated: "Last updated",
    marketing: "Marketing email",
    reviewRequest: "Review request email",
    recovery: "Service recovery contact",
    research: "Customer research",
    withdrawCta: "Confirm marketing unsubscribe",
    successTitle: "Request received",
    successDetail: "Your choice has been sent to the system.",
    bookingReference: "Booking reference",
    branch: "Branch",
    reviewStatus: "Review invitation",
    rating: "Rating",
    comment: "Tell us more (optional)",
    submitReview: "Submit review",
    reviewReceived: "Thank you for sharing",
    reviewReceivedHint: "Your review was received securely.",
    invalidReview: "This review link is invalid or has expired.",
    validReview: "Verified review invitation",
    transactionalNotice: "Transactional email is not affected by marketing choices.",
    privacy: "Your information is handled under the salon privacy policy.",
    invalidUnsubscribe: "This email preference link is invalid.",
    invalidUnsubscribeDetail: "Please open the most recent link from the salon again.",
  },
} as const;

const configuredPublicApi = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

function publicApiBaseUrl() {
  if (typeof window === "undefined") return configuredPublicApi;
  try {
    const url = new URL(configuredPublicApi);
    if (window.location.hostname === "localhost" && url.hostname === "127.0.0.1") url.hostname = "localhost";
    if (window.location.hostname === "127.0.0.1" && url.hostname === "localhost") url.hostname = "127.0.0.1";
    return url.origin;
  } catch {
    return configuredPublicApi;
  }
}

function purposeLabel(purpose: string, locale: PublicLocale) {
  const labels = copy[locale];
  return {
    MARKETING_EMAIL: labels.marketing,
    REVIEW_REQUEST: labels.reviewRequest,
    SERVICE_RECOVERY_CONTACT: labels.recovery,
    CUSTOMER_RESEARCH: labels.research,
  }[purpose] ?? labels.consentsTitle;
}

function stateLabel(state: string, locale: PublicLocale) {
  const labels = copy[locale];
  if (state === "GRANTED") return labels.granted;
  if (state === "WITHDRAWN") return labels.withdrawn;
  return labels.notGranted;
}

function dateLabel(value: unknown, locale: PublicLocale) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function reviewStatusLabel(value: unknown, locale: PublicLocale) {
  const normalized = String(value ?? "").toUpperCase();
  const labels = locale === "vi-VN"
    ? { SENT: "Đã gửi", SUBMITTED: "Đã gửi đánh giá", EXPIRED: "Đã hết hạn", SUPPRESSED: "Đã chặn" }
    : { SENT: "Sent", SUBMITTED: "Review submitted", EXPIRED: "Expired", SUPPRESSED: "Suppressed" };
  return labels[normalized as keyof typeof labels] ?? (locale === "vi-VN" ? "Cần kiểm tra" : "Needs review");
}

export default function CustomerEngagement({ mode }: { mode: CustomerSurfaceMode }) {
  const bookingBaseUrl = process.env.NEXT_PUBLIC_BOOKING_URL?.replace(/\/$/, "") ?? "";
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [locale, setLocale] = useState<PublicLocale>("vi-VN");
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error" | "forbidden" | "done">("loading");
  const [data, setData] = useState<any>(null);
  const [notice, setNotice] = useState("");
  const [rating, setRating] = useState("5");
  const [comment, setComment] = useState("");
  const [busyPurpose, setBusyPurpose] = useState("");
  const intentKeys = useRef(new Map<string, string>());
  const labels = copy[locale];

  function intentKey(scope: string) {
    const existing = intentKeys.current.get(scope);
    if (existing) return existing;
    const created = crypto.randomUUID();
    intentKeys.current.set(scope, created);
    return created;
  }

  function clearIntentKey(scope: string) {
    intentKeys.current.delete(scope);
  }

  async function request(path: string, init?: RequestInit, authenticated = true) {
    const response = authenticated ? await authorizedFetch(path, init) : await fetch(`${publicApiBaseUrl()}${path}`, init);
    const body = await response.json().catch(() => ({}));
    if ([401, 403].includes(response.status)) {
      setState("forbidden");
      throw new Error("FORBIDDEN");
    }
    if (!response.ok) throw new Error(String(body.error?.code ?? "REQUEST_FAILED"));
    return body.data;
  }

  async function load() {
    setState("loading");
    setNotice("");
    try {
      const value = mode === "preferences"
        ? await request("/v1/customer/me/communication-preferences")
        : mode === "consents"
          ? await request("/v1/customer/me/consents")
          : mode === "review"
            ? await request(`/v1/public/reviews/request?token=${encodeURIComponent(token)}`, undefined, false)
            : null;
      setData(value);
      setState(value && (Array.isArray(value) ? value.length > 0 : true) ? "ready" : "empty");
    } catch (error) {
      if (error instanceof Error && error.message === "FORBIDDEN") return;
      setState("error");
      setNotice(labels.errorTitle);
    }
  }

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (mode === "unsubscribe") {
      if (!token) {
        setState("error");
        setNotice(labels.invalidUnsubscribeDetail);
      } else {
        setState("ready");
      }
    }
    else void load();
    // The signed token and mode are the only inputs for this public view.
  }, [mode, token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    try {
      if (mode === "preferences") {
        const keyScope = "preferences:update";
        await request("/v1/customer/me/communication-preferences/update", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": intentKey(keyScope) },
          body: JSON.stringify({
            preferredLocale: data.preferredLocale,
            preferredTimezone: data.preferredTimezone,
            emailAddress: data.emailAddress,
            quietHoursStart: data.quietHoursStart?.slice(0, 5) || null,
            quietHoursEnd: data.quietHoursEnd?.slice(0, 5) || null,
            version: data.version,
          }),
        });
        clearIntentKey(keyScope);
        await load();
        setNotice(labels.saved);
        return;
      }
      if (mode === "unsubscribe") {
        const keyScope = "unsubscribe";
        await request("/v1/public/communications/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": intentKey(keyScope) },
          body: JSON.stringify({ token }),
        }, false);
        clearIntentKey(keyScope);
        setState("done");
        setNotice(labels.successDetail);
        return;
      }
      if (mode === "review") {
        const keyScope = "review:submit";
        await request("/v1/public/reviews/submit", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": intentKey(keyScope) },
          body: JSON.stringify({ token, overallRating: Number(rating), comment }),
        }, false);
        clearIntentKey(keyScope);
        setState("done");
        setNotice(labels.reviewReceivedHint);
      }
    } catch {
      setNotice(labels.errorTitle);
      setState("error");
    }
  }

  async function updateConsent(purpose: string, action: "grant" | "withdraw") {
    setBusyPurpose(purpose);
    const keyScope = `consent:${purpose}:${action}`;
    try {
      await request(`/v1/customer/me/consents/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": intentKey(keyScope) },
        body: JSON.stringify({ purpose, evidence: { interaction: "customer-portal" } }),
      });
      clearIntentKey(keyScope);
      await load();
    } catch {
      setNotice(labels.errorTitle);
    } finally {
      setBusyPurpose("");
    }
  }

  const title = mode === "preferences" ? labels.preferencesTitle : mode === "consents" ? labels.consentsTitle : mode === "unsubscribe" ? labels.unsubscribeTitle : labels.reviewTitle;
  const hint = mode === "preferences" ? labels.preferencesHint : mode === "consents" ? labels.consentsHint : mode === "unsubscribe" ? labels.unsubscribeHint : labels.reviewHint;

  return (
    <main className="customer-public-page">
      <div className="customer-public-shell">
        <header className="customer-public-header">
          <a className="customer-public-brand" href="/" aria-label={labels.brand}>
            <span className="customer-public-mark" aria-hidden="true">N</span>
            <span><strong>{labels.brand}</strong><small>{labels.brandSub}</small></span>
          </a>
          <nav className="customer-public-nav" aria-label={labels.language}>
            {bookingBaseUrl ? <a href={`${bookingBaseUrl}/book`}>{labels.book}</a> : null}
            {bookingBaseUrl ? <a href={`${bookingBaseUrl}/manage-booking`}>{labels.manage}</a> : null}
            <label><span className="sr-only">{labels.language}</span><select value={locale} aria-label={labels.language} onChange={(event) => setLocale(event.target.value as PublicLocale)}><option value="vi-VN">VI</option><option value="en-US">EN</option></select></label>
          </nav>
        </header>

        <section className="customer-public-hero" aria-labelledby="customer-public-title">
          <p className="customer-public-eyebrow">{labels.eyebrow}</p>
          <h1 id="customer-public-title">{title}</h1>
          <p>{hint}</p>
        </section>

        <section className="customer-public-card">
          {state === "loading" && <div className="customer-public-state" role="status"><span className="customer-public-spinner" aria-hidden="true" />{labels.loading}</div>}
          {state === "forbidden" && <div className="customer-public-state customer-public-state-error" role="alert"><strong>{labels.errorTitle}</strong><p>{labels.forbidden}</p></div>}
          {state === "error" && <div className="customer-public-state customer-public-state-error" role="alert"><strong>{labels.errorTitle}</strong><p>{notice && notice !== labels.errorTitle ? notice : labels.errorDetail}</p><button className="customer-public-button customer-public-button-light" type="button" onClick={() => void load()}>{labels.retry}</button></div>}
          {state === "empty" && <div className="customer-public-state" role="status"><strong>{labels.empty}</strong></div>}
          {state === "done" && <div className="customer-public-success" role="status"><span className="customer-public-success-icon" aria-hidden="true">✓</span><div><p className="customer-public-eyebrow">{labels.successTitle}</p><h2>{mode === "review" ? labels.reviewReceived : labels.successTitle}</h2><p>{notice || (mode === "review" ? labels.reviewReceivedHint : labels.successDetail)}</p><p className="customer-public-note">{labels.privacy}</p></div></div>}

          {state === "ready" && mode === "preferences" && data && (
            <form className="customer-public-form" onSubmit={submit}>
              <div className="customer-public-form-grid">
                <label><span>{labels.locale}</span><select value={data.preferredLocale ?? "vi-VN"} onChange={(event) => setData({ ...data, preferredLocale: event.target.value })}><option value="vi-VN">Tiếng Việt</option><option value="en-US">English</option></select></label>
                <label><span>{labels.timezone}</span><input value={data.preferredTimezone ?? ""} onChange={(event) => setData({ ...data, preferredTimezone: event.target.value })} /></label>
                <label className="customer-public-form-wide"><span>{labels.email}</span><input type="email" value={data.emailAddress ?? ""} onChange={(event) => setData({ ...data, emailAddress: event.target.value })} /></label>
              </div>
              <p className="customer-public-note">{labels.transactionalNotice}</p>
              <button className="customer-public-button" type="submit">{labels.save}</button>
            </form>
          )}

          {state === "ready" && mode === "consents" && Array.isArray(data) && (
            <div className="customer-public-consent-list">
              {data.map((item: any) => (
                <article className="customer-public-consent" key={item.purpose}>
                  <div><p className="customer-public-consent-title">{purposeLabel(item.purpose, locale)}</p><p className="customer-public-note">{labels.updated}: {dateLabel(item.updatedAt, locale)}</p></div>
                  <div className="customer-public-consent-actions"><span className={`customer-public-status customer-public-status-${String(item.state).toLowerCase()}`}>{stateLabel(item.state, locale)}</span><button className="customer-public-button customer-public-button-light" type="button" disabled={busyPurpose === item.purpose} onClick={() => void updateConsent(item.purpose, item.state === "GRANTED" ? "withdraw" : "grant")}>{busyPurpose === item.purpose ? labels.loading : item.state === "GRANTED" ? labels.withdraw : labels.allow}</button></div>
                </article>
              ))}
            </div>
          )}

          {state === "ready" && mode === "unsubscribe" && (
            <form className="customer-public-action" onSubmit={submit}>
              <div className="customer-public-notice"><span aria-hidden="true">✦</span><p>{labels.unsubscribeHint}</p></div>
              <p className="customer-public-note">{labels.transactionalNotice}</p>
              <button className="customer-public-button" type="submit">{labels.withdrawCta}</button>
            </form>
          )}

          {state === "ready" && mode === "review" && data && (
            data.tokenValid ? <form className="customer-public-form" onSubmit={submit}>
              <div className="customer-public-visit-card"><div><span>{labels.validReview}</span><strong>{data.bookingReference ?? "—"}</strong></div><dl><div><dt>{labels.branch}</dt><dd>{data.branchName ?? "—"}</dd></div><div><dt>{labels.reviewStatus}</dt><dd>{reviewStatusLabel(data.status, locale)}</dd></div></dl></div>
              <label><span>{labels.rating}</span><select value={rating} onChange={(event) => setRating(event.target.value)}>{[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></label>
              <label><span>{labels.comment}</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={5} maxLength={2000} /></label>
              <button className="customer-public-button" type="submit">{labels.submitReview}</button>
            </form> : <div className="customer-public-state customer-public-state-error" role="alert"><strong>{labels.invalidReview}</strong><p>{labels.privacy}</p></div>
          )}
          {notice && state === "ready" && mode !== "review" && mode !== "unsubscribe" ? <p className="customer-public-inline-notice" role="status">{notice}</p> : null}
        </section>

        <footer className="customer-public-footer"><span>© NailSoft</span><span>{labels.privacy}</span></footer>
      </div>
    </main>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  formatSalonDateTime,
  formatSalonTime,
  bookingStatusLabel,
  getInitialLocale,
  getMessage,
  localizedValue,
  persistLocale,
  type BookingMessageKey,
  type Locale,
} from "./i18n";

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
type ManageStep = "LOOKUP" | "OTP" | "DETAIL" | "REPLACEMENT_AVAILABILITY" | "RESCHEDULE_REVIEW";
type ManageState = "ready" | "loading" | "error" | "offline" | "expired";

function localizedError(cause: any, locale: Locale) {
  const code = cause?.code;
  if (code === "PUBLIC_BOOKING_UNAVAILABLE" || code === "PUBLIC_BOOKING_DISABLED")
    return getMessage(locale, "bookingUnavailable");
  if (code === "BOOKING_ACCESS_DENIED") return getMessage(locale, "sessionExpired");
  if (code === "BOOKING_VERSION_CONFLICT") return getMessage(locale, "bookingChanged");
  if (code === "SLOT_HOLD_EXPIRED") return getMessage(locale, "holdExpired");
  return getMessage(locale, "retry");
}

async function call(path: string, init?: RequestInit) {
  const response = await fetch(`${api}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(body.error?.message ?? "Không thể hoàn tất yêu cầu."), {
      code: body.error?.code,
      details: body.error?.details,
    });
  }
  return body.data;
}

export default function ManageBooking() {
  // Keep the server and first client render stable; browser preferences are
  // loaded after hydration to avoid locale-driven hydration mismatches.
  const [locale, setLocale] = useState<Locale>("vi-VN");
  const [step, setStep] = useState<ManageStep>("LOOKUP");
  const [state, setState] = useState<ManageState>("ready");
  const [salonSlug, setSalonSlug] = useState("");
  const [salon, setSalon] = useState<any>();
  const [reference, setReference] = useState("");
  const [contact, setContact] = useState("");
  const [challenge, setChallenge] = useState<any>();
  const [challengeExpiresAt, setChallengeExpiresAt] = useState<number | null>(null);
  const [challengeRemaining, setChallengeRemaining] = useState(0);
  const [challengeExpired, setChallengeExpired] = useState(false);
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [booking, setBooking] = useState<any>();
  const [branch, setBranch] = useState<any>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [date, setDate] = useState("");
  const [availability, setAvailability] = useState<any>();
  const [selectedSlot, setSelectedSlot] = useState<any>();
  const [replacementHold, setReplacementHold] = useState<any>();
  const [packages, setPackages] = useState<any[]>([]);
  const [packageReservation, setPackageReservation] = useState<any>();
  const keys = useRef({ hold: "", reschedule: "", cancel: "", package: "" });

  const t = (key: BookingMessageKey) => getMessage(locale, key);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("salon");
    if (value) setSalonSlug(value);
    setLocale(getInitialLocale());
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (!challenge?.challengeId || !challengeExpiresAt) return;
    const update = () => {
      const seconds = Math.max(0, Math.ceil((challengeExpiresAt - Date.now()) / 1000));
      setChallengeRemaining(seconds);
      if (!seconds) setChallengeExpired(true);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [challenge?.challengeId, challengeExpiresAt]);

  function path(suffix: string) {
    return `/v1/public/salons/${encodeURIComponent(salonSlug)}/bookings${suffix}`;
  }

  function fail(cause: any) {
    setError(localizedError(cause, locale));
    setState(cause.code === "BOOKING_ACCESS_DENIED" ? "expired" : !navigator.onLine ? "offline" : "error");
  }

  async function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("loading");
    setError("");
    setNotice("");
    try {
      const data = await call(path("/access/request"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bookingReference: reference,
          contact,
          channel: contact.includes("@") ? "EMAIL" : "SMS",
        }),
      });
      setChallenge(data);
      const expiresIn = Number(data.expiresIn);
      setChallengeExpiresAt(Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : null);
      setChallengeRemaining(Number.isFinite(expiresIn) && expiresIn > 0 ? Math.ceil(expiresIn) : 0);
      setChallengeExpired(false);
      if (process.env.NODE_ENV !== "production") setCode(data.testCode ?? "");
      setStep("OTP");
      setState("ready");
    } catch (cause: any) {
      fail(cause);
    }
  }

  async function loadContext(nextToken: string, bookingReference: string) {
    const profile = await call(`/v1/public/salons/${encodeURIComponent(salonSlug)}`);
    setSalon(profile);
    const detail = await loadDetail(bookingReference, nextToken);
    let selectedBranch: any = { name: profile.name, timezone: profile.timezone, policy: {} };
    try {
      const branchRows = await call(`/v1/public/salons/${encodeURIComponent(salonSlug)}/branches`);
      selectedBranch = branchRows.find((item: any) => item.id === detail.branchId) ?? branchRows[0] ?? selectedBranch;
    } catch {
      // Read-only tenants intentionally deny the branch discovery endpoint.
      // Detail access remains available with the salon timezone as the safe fallback.
    }
    setBranch(selectedBranch);
    setDate(selectedBranch.bookingWindow?.earliestDate ?? "");
    setBooking(detail);
    return detail;
  }

  async function verify() {
    if (!challenge) return;
    setState("loading");
    setError("");
    try {
      const data = await call(path("/access/verify"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.challengeId, code }),
      });
      setToken(data.managementToken);
      setChallengeExpiresAt(null);
      setChallengeRemaining(0);
      setChallengeExpired(false);
      setReference(data.bookingReference);
      const detail = await loadContext(data.managementToken, data.bookingReference);
      try {
        const wallet = await call(`/v1/public/salons/${encodeURIComponent(salonSlug)}/customer-packages`, { headers: { authorization: `Bearer ${data.managementToken}` } });
        setPackages(Array.isArray(wallet) ? wallet : []);
      } catch {
        setPackages([]);
      }
      setBooking(detail);
      setStep("DETAIL");
      setState("ready");
    } catch (cause: any) {
      fail(cause);
    }
  }

  async function loadDetail(value = reference, capability = token) {
    return call(path(`/${encodeURIComponent(value)}`), { headers: { authorization: `Bearer ${capability}` } });
  }

  async function findReplacementSlots() {
    const serviceId = booking?.items?.[0]?.service?.serviceId;
    if (!serviceId) {
      setError(t("noServiceToReschedule"));
      return;
    }
    setState("loading");
    setError("");
    try {
      const params = new URLSearchParams({ branchId: booking.branchId, serviceId, dateFrom: date, dateTo: date, slotIntervalMin: "15", bookingReference: reference });
      const data = await call(`/v1/public/salons/${encodeURIComponent(salonSlug)}/availability?${params}`, { headers: { authorization: `Bearer ${token}` } });
      setAvailability(data);
      setSelectedSlot(undefined);
      setReplacementHold(undefined);
      setStep("REPLACEMENT_AVAILABILITY");
      setState("ready");
    } catch (cause: any) {
      fail(cause);
    }
  }

  async function holdReplacement(slotValue: any) {
    setState("loading");
    setError("");
    try {
      const nextKeys = { ...keys.current, hold: keys.current.hold || crypto.randomUUID() };
      keys.current = nextKeys;
      const data = await call(path(`/${reference}/reschedule-holds`), {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": keys.current.hold },
        body: JSON.stringify({
          desiredStartAt: slotValue.startAt,
          availabilityDataVersion: availability.dataVersion,
          items: booking.items.map((item: any, index: number) => ({
            serviceId: item.service.serviceId,
            staffPreference: branch?.policy?.allowAnyTechnician === false ? { type: "SPECIFIC", staffId: item.staff.id } : { type: "ANY" },
            ...(index === 0 ? { availabilityFingerprint: slotValue.fingerprint } : {}),
          })),
        }),
      });
      setSelectedSlot(slotValue);
      setReplacementHold(data);
      setStep("RESCHEDULE_REVIEW");
      setState("ready");
    } catch (cause: any) {
      fail(cause);
    }
  }

  async function confirmReschedule() {
    if (!navigator.onLine) { setState("offline"); return; }
    setState("loading");
    setError("");
    try {
      const nextKeys = { ...keys.current, reschedule: keys.current.reschedule || crypto.randomUUID() };
      keys.current = nextKeys;
      await call(path(`/${reference}/reschedule`), {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": keys.current.reschedule },
        body: JSON.stringify({ version: booking.version, replacementHoldId: replacementHold.holdId, replacementHoldToken: replacementHold.holdToken, reasonCode: "CUSTOMER_REQUEST", note: "Customer self-service reschedule" }),
      });
      setBooking(await loadDetail());
      setNotice(t("newTimeConfirmed"));
      setStep("DETAIL");
      setState("ready");
    } catch (cause: any) {
      setError(localizedError(cause, locale));
      setState(cause.code === "BOOKING_ACCESS_DENIED" ? "expired" : "error");
    }
  }

  async function cancel() {
    if (!navigator.onLine) { setState("offline"); return; }
    setState("loading");
    setError("");
    try {
      const nextKeys = { ...keys.current, cancel: keys.current.cancel || crypto.randomUUID() };
      keys.current = nextKeys;
      const data = await call(path(`/${reference}/cancel`), {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": keys.current.cancel },
        body: JSON.stringify({ version: booking.version, reasonCode: "CUSTOMER_REQUEST", note: "Cancelled from booking management" }),
      });
      setBooking(data);
      setNotice(t("bookingCancelledNotice"));
      setState("ready");
    } catch (cause: any) {
      setError(localizedError(cause, locale));
      setState(cause.code === "BOOKING_ACCESS_DENIED" ? "expired" : "error");
    }
  }

  async function reservePackage(entitlementId: string, appointmentItemId: string) {
    if (!navigator.onLine) { setState("offline"); return; }
    setState("loading");
    setError("");
    try {
      const nextKeys = { ...keys.current, package: keys.current.package || crypto.randomUUID() };
      keys.current = nextKeys;
      const value = await call(`/v1/public/salons/${encodeURIComponent(salonSlug)}/package-reservations`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": keys.current.package },
        body: JSON.stringify({ entitlementId, appointmentItemId }),
      });
      setPackageReservation(value);
      setNotice(t("reservedUnit"));
      setState("ready");
    } catch (cause: any) {
      fail(cause);
    }
  }

  const slots = availability?.days?.flatMap((day: any) => day.slots) ?? [];
  const bookingCancelled = String(booking?.status ?? "").startsWith("CANCELLED");

  return (
    <main className="booking-shell manage-booking-shell" data-testid="manage-booking">
      <header className="brand">
        <a href="/" aria-label="Nailsoft">NAILSOFT</a>
        <div className="brand-tools">
          {salonSlug && <a href={`/book/${encodeURIComponent(salonSlug)}`}>{t("startBooking")}</a>}
          <label className="language-switcher"><span className="sr-only">{t("selectLanguage")}</span><select aria-label={t("selectLanguage")} value={locale} onChange={(event) => { const next = event.target.value as Locale; setLocale(next); persistLocale(next); }}><option value="vi-VN">vi-VN</option><option value="en-US">en-US</option></select></label>
        </div>
      </header>
      <section className="hero manage-hero" aria-labelledby="manage-title">
        <div>
          <p className="eyebrow">{t("bookingManagement")}</p>
          <h1 id="manage-title">{t("manageBooking")}</h1>
          <p className="muted">{t("manageBookingDescription")}</p>
        </div>
        <aside className="manage-context-card" aria-label={t("workspace")}>
          <span className="manage-context-icon" aria-hidden="true">⌁</span>
          <div><small>{t("workspace")}</small><strong>{salon?.name || salonSlug || "Nailsoft"}</strong></div>
          <span className="manage-context-dot" aria-hidden="true">●</span>
        </aside>
      </section>
      <section className="card booking-card manage-card">
        {notice && <div className="success" role="status">{notice}</div>}
        {state === "loading" && <div className="state" role="status">{t("loading")}</div>}
        {state === "offline" && <div className="error error-summary" role="alert"><strong>{t("offline")}</strong><p>{t("internetRequired")}</p><button className="secondary" type="button" onClick={() => setState("ready")}>{t("retry")}</button></div>}
        {state === "expired" && <div className="error error-summary" role="alert"><strong>{t("sessionExpired")}</strong><p>{t("manageBookingDescription")}</p><button className="secondary" type="button" onClick={() => { setToken(""); setStep("LOOKUP"); setState("ready"); }}>{t("verify")}</button></div>}
        {state === "error" && <div className="error error-summary" role="alert"><strong>{t("retry")}</strong><p>{error}</p><div className="actions"><button className="secondary" type="button" onClick={() => setState("ready")}>{t("retry")}</button><button className="link-button" type="button" onClick={() => { setError(""); setStep("LOOKUP"); setState("ready"); }}>{t("changeDetails")}</button></div></div>}

        {state === "ready" && step === "LOOKUP" && (
          <div className="manage-layout">
            <form className="manage-main-panel" onSubmit={request} aria-labelledby="lookup-heading">
              <div className="manage-panel-heading">
                <span className="manage-panel-icon" aria-hidden="true">⌕</span>
                <div><p className="eyebrow">01 / {t("secureLookup")}</p><h2 id="lookup-heading">{t("manageBooking")}</h2><p>{t("lookupIntro")}</p></div>
              </div>
              <div className="manage-form-grid">
                <label className="field" htmlFor="manage-salon"><span>{t("salonCode")}</span><input id="manage-salon" required value={salonSlug} onChange={(event) => setSalonSlug(event.target.value.trim())} placeholder={t("salonCodePlaceholder")} /></label>
                <label className="field" htmlFor="manage-reference"><span>{t("bookingReference")}</span><input id="manage-reference" required value={reference} onChange={(event) => setReference(event.target.value.toUpperCase())} /></label>
                <label className="field manage-form-wide" htmlFor="manage-contact"><span>{t("phone")} / {t("email")}</span><input id="manage-contact" required value={contact} onChange={(event) => setContact(event.target.value)} /></label>
              </div>
              <div className="manage-form-actions"><button className="primary" type="submit">{t("sendCode")} <span aria-hidden="true">→</span></button></div>
              <p className="manage-neutral-note"><span aria-hidden="true">✓</span>{t("neutralResponse")}</p>
            </form>
            <aside className="manage-side-panel">
              <section className="manage-side-card manage-security-card">
                <span className="manage-side-icon" aria-hidden="true">✦</span>
                <h3>{t("secureLookup")}</h3>
                <p>{t("secureLookupHint")}</p>
                <ul><li>{t("verificationCode")}</li><li>{t("privacyTitle")}</li><li>{t("noPayment")}</li></ul>
              </section>
            </aside>
          </div>
        )}

        {state === "ready" && step === "OTP" && (
          <div className="manage-layout">
            <div className="manage-main-panel" aria-labelledby="manage-otp-heading">
              <div className="manage-panel-heading"><span className="manage-panel-icon" aria-hidden="true">◎</span><div><p className="eyebrow">02 / {t("verificationCode")}</p><h2 id="manage-otp-heading">{t("verificationTitle")}</h2><p>{t("verificationSentTo")} <strong>{contact.includes("@") ? `${contact.slice(0, 2)}•••${contact.slice(contact.indexOf("@"))}` : `•••• ${contact.replace(/\D/g, "").slice(-4)}`}</strong></p></div></div>
              {challengeExpired ? <div className="error error-summary manage-alert" role="alert"><strong>{t("verificationExpired")}</strong><p>{t("verificationExpiredHint")}</p><button className="secondary" type="button" onClick={() => { setStep("LOOKUP"); setChallenge(undefined); setChallengeExpiresAt(null); setChallengeRemaining(0); setChallengeExpired(false); setCode(""); }}>{t("requestNewCode")}</button></div> : <div className="manage-otp-card"><label className="field" htmlFor="manage-code"><span>{t("verificationCode")}</span><input id="manage-code" autoFocus inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} /></label><p className="muted">{t("verificationHint")}</p>{challengeRemaining > 0 && <p className="countdown" role="status">{t("verificationExpires")}: {Math.floor(challengeRemaining / 60)}:{String(challengeRemaining % 60).padStart(2, "0")}</p>}<div className="manage-form-actions"><button className="secondary" type="button" onClick={() => { setStep("LOOKUP"); setChallenge(undefined); setChallengeExpiresAt(null); setChallengeRemaining(0); setChallengeExpired(false); setCode(""); }}>{t("changeDetails")}</button><button className="primary" type="button" disabled={!/^\d{6}$/.test(code)} onClick={() => void verify()}>{t("verify")} <span aria-hidden="true">→</span></button></div></div>}
              <p className="manage-neutral-note"><span aria-hidden="true">✓</span>{t("verificationPrivacyHint")}</p>
            </div>
            <aside className="manage-side-panel"><section className="manage-side-card manage-security-card"><span className="manage-side-icon" aria-hidden="true">⌁</span><h3>{t("bookingPolicy")}</h3><p>{t("secureLookupHint")}</p><ul><li>{t("verificationExpires")}</li><li>{t("noPayment")}</li></ul></section></aside>
          </div>
        )}

        {state === "ready" && step === "DETAIL" && booking && (
          <div className="manage-detail-layout">
            <div className="manage-main-panel">
              <div className="manage-panel-heading manage-detail-heading"><div><p className="eyebrow">{salon?.name ?? salonSlug}</p><h2 id="detail-heading">{t("bookingDetails")}</h2><p>{booking.bookingReference}</p></div><span className="badge">{bookingStatusLabel(booking.status, locale)}</span></div>
              <div className="manage-booking-identity"><span className="manage-avatar" aria-hidden="true">{String(booking?.contact?.displayName ?? "?").slice(0, 1).toUpperCase()}</span><div><strong>{booking?.contact?.displayName ?? "—"}</strong><span>{booking?.contact?.phone ?? booking?.contact?.email ?? "—"}</span></div></div>
              <div className="manage-detail-grid"><section className="manage-detail-card"><span className="manage-detail-icon" aria-hidden="true">⌖</span><div><small>{t("branch")}</small><strong>{branch?.name ?? salon?.name ?? "—"}</strong><span>{branch?.timezone ?? salon?.timezone ?? "—"}</span></div></section><section className="manage-detail-card"><span className="manage-detail-icon" aria-hidden="true">◷</span><div><small>{t("chooseTime")}</small><strong>{booking.startAt && formatSalonDateTime(booking.startAt, locale, branch?.timezone ?? salon?.timezone)}</strong><span>{t("timezoneLabel")}: {branch?.timezone ?? salon?.timezone ?? "—"}</span></div></section><section className="manage-detail-card"><span className="manage-detail-icon" aria-hidden="true">✓</span><div><small>{t("status")}</small><strong>{bookingStatusLabel(booking.status, locale)}</strong><span>{booking.bookingReference}</span></div></section></div>
              <section className="manage-services-panel"><div className="manage-section-heading"><span className="manage-panel-icon" aria-hidden="true">✦</span><div><h3>{t("services")}</h3><small>{booking.items?.length ?? 0} {t("service").toLowerCase()}</small></div></div>{booking.items?.map((item: any) => <div className="manage-service-row" key={item.id}><span>{String(item.sequenceNo ?? 1).padStart(2, "0")}</span><div><strong>{localizedValue(item.service?.name, locale, item.service?.code)}</strong><small>{item.service?.durationMin ?? "—"} {t("minutes")}</small></div><b>{item.price?.amount ? `${item.price.amount} ${item.price.currency ?? ""}` : "—"}</b></div>)}</section>
              <PackagePanel locale={locale} packages={packages} booking={booking} packageReservation={packageReservation} loading={false} onReserve={reservePackage} />
              <section className="manage-actions-panel"><div className="manage-section-heading"><span className="manage-panel-icon" aria-hidden="true">↗</span><div><h3>{t("bookingActions")}</h3><small>{bookingCancelled ? t("bookingCancelledNotice") : t("cancelIntro")}</small></div></div>{!bookingCancelled ? <div className="manage-actions-row"><label className="field" htmlFor="manage-date"><span>{t("chooseTime")}</span><input id="manage-date" type="date" min={branch?.bookingWindow?.earliestDate} max={branch?.bookingWindow?.latestDate} value={date} onChange={(event) => setDate(event.target.value)} /></label><button className="secondary" type="button" disabled={!date} onClick={() => void findReplacementSlots()}>{t("chooseAnotherTime")} <span aria-hidden="true">→</span></button><button className="danger" type="button" onClick={() => void cancel()}>{t("cancelBooking")}</button></div> : <div className="manage-cancelled-state" role="status"><strong>{bookingStatusLabel(booking.status, locale)}</strong><span>{t("bookingCancelledNotice")}</span></div>}</section>
            </div>
            <aside className="manage-side-panel"><section className="manage-side-card"><div className="manage-section-heading"><span className="manage-panel-icon" aria-hidden="true">▦</span><div><h3>{t("bookingDetails")}</h3><small>{t("bookingReference")}</small></div></div><dl className="manage-facts"><div><dt>{t("bookingReference")}</dt><dd>{booking.bookingReference}</dd></div><div><dt>{t("bookingContact")}</dt><dd>{booking?.contact?.phone ?? booking?.contact?.email ?? "—"}</dd></div><div><dt>{t("branch")}</dt><dd>{branch?.name ?? salon?.name ?? "—"}</dd></div></dl></section><section className="manage-side-card manage-policy-card"><span className="manage-side-icon" aria-hidden="true">♡</span><h3>{t("bookingPolicy")}</h3><p>{branch?.policy?.summary ?? "—"}</p><small>{t("noPayment")}</small></section></aside>
          </div>
        )}

        {state === "ready" && step === "REPLACEMENT_AVAILABILITY" && (
          <div className="manage-layout"><div className="manage-main-panel"><div className="manage-panel-heading"><span className="manage-panel-icon" aria-hidden="true">◷</span><div><p className="eyebrow">03 / {t("chooseAnotherTime")}</p><h2 id="replacement-heading">{t("chooseAnotherTime")}</h2><p>{t("rescheduleIntro")}</p></div></div><label className="field manage-date-field" htmlFor="replacement-date"><span>{t("chooseTime")} · {branch?.timezone ?? salon?.timezone}</span><input id="replacement-date" type="date" min={branch?.bookingWindow?.earliestDate} max={branch?.bookingWindow?.latestDate} value={date} onChange={(event) => { setDate(event.target.value); void findReplacementSlots(); }} /></label>{slots.length ? <div className="manage-slot-grid">{slots.map((item: any) => <button className="choice slot" type="button" key={item.fingerprint} onClick={() => void holdReplacement(item)}><strong>{formatSalonTime(item.startAt, locale, branch?.timezone ?? salon?.timezone)}</strong><small>{t("anyStaff")}</small></button>)}</div> : <div className="state" role="status">{t("noAvailability")}</div>}<button className="secondary" type="button" onClick={() => setStep("DETAIL")}>{t("back")}</button></div><aside className="manage-side-panel"><section className="manage-side-card"><span className="manage-side-icon" aria-hidden="true">⌁</span><h3>{t("bookingDetails")}</h3><p>{booking?.bookingReference}</p><small>{booking?.startAt && formatSalonDateTime(booking.startAt, locale, branch?.timezone ?? salon?.timezone)}</small></section></aside></div>
        )}

        {state === "ready" && step === "RESCHEDULE_REVIEW" && replacementHold && (
          <div className="manage-layout"><div className="manage-main-panel"><div className="manage-panel-heading"><span className="manage-panel-icon" aria-hidden="true">✓</span><div><p className="eyebrow">04 / {t("review")}</p><h2 id="reschedule-heading">{t("review")}</h2><p>{t("rescheduleIntro")}</p></div></div><section className="manage-review-card"><div><small>{t("chooseTime")}</small><strong>{formatSalonDateTime(selectedSlot.startAt, locale, branch?.timezone ?? salon?.timezone)}</strong><span>{branch?.name ?? salon?.name ?? "—"}</span></div><div><small>{t("holdExpires")}</small><strong>{formatSalonTime(replacementHold.expiresAt, locale, branch?.timezone ?? salon?.timezone)}</strong><span>{t("noPayment")}</span></div></section><div className="manage-form-actions"><button className="secondary" type="button" onClick={() => setStep("REPLACEMENT_AVAILABILITY")}>{t("back")}</button><button className="primary" type="button" onClick={() => void confirmReschedule()}>{t("confirmBooking")} <span aria-hidden="true">→</span></button></div></div><aside className="manage-side-panel"><section className="manage-side-card manage-security-card"><span className="manage-side-icon" aria-hidden="true">◷</span><h3>{t("holdActive")}</h3><p>{t("holdHint")}</p></section></aside></div>
        )}
      </section>
    </main>
  );
}

function PackagePanel({ locale, packages, booking, packageReservation, loading, onReserve }: { locale: Locale; packages: any[]; booking: any; packageReservation: any; loading: boolean; onReserve: (entitlementId: string, itemId: string) => void }) {
  const t = (key: BookingMessageKey) => getMessage(locale, key);
  return <section className="manage-package-panel"><div className="manage-section-heading"><span className="manage-panel-icon" aria-hidden="true">✦</span><div><h3>{t("servicePackages")}</h3><small>{t("packageHint")}</small></div></div>{packages.length === 0 ? <p className="manage-empty-inline">{t("noActivePackage")}</p> : <div className="manage-package-list">{packages.map((item: any) => <div className="manage-package-row" key={item.id}><div><strong>{localizedValue(item.name, locale, item.code)}</strong><small>{item.availableUnits} {t("packageUnit")}</small></div>{booking.items?.[0]?.id && !packageReservation && <button className="secondary" type="button" disabled={loading || item.availableUnits < 1} onClick={() => onReserve(item.id, booking.items[0].id)}>{t("reserveUnit")}</button>}</div>)}</div>}{packageReservation && <p className="manage-package-success" role="status">{t("reservedUnit")} · {packageReservation.units} {t("packageUnit")}</p>}</section>;
}

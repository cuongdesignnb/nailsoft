/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  formatSalonDateTime,
  formatSalonTime,
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
  return cause?.message ?? getMessage(locale, "retry");
}

async function call(path: string, init?: RequestInit) {
  const response = await fetch(`${api}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(body.error?.message ?? "Unable to complete the request."), {
      code: body.error?.code,
      details: body.error?.details,
    });
  }
  return body.data;
}

export default function ManageBooking() {
  const [locale, setLocale] = useState<Locale>(() => getInitialLocale());
  const [step, setStep] = useState<ManageStep>("LOOKUP");
  const [state, setState] = useState<ManageState>("ready");
  const [salonSlug, setSalonSlug] = useState("");
  const [salon, setSalon] = useState<any>();
  const [reference, setReference] = useState("");
  const [contact, setContact] = useState("");
  const [challenge, setChallenge] = useState<any>();
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
  const [keys, setKeys] = useState({ hold: "", reschedule: "", cancel: "", package: "" });

  const t = (key: BookingMessageKey) => getMessage(locale, key);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("salon");
    if (value) setSalonSlug(value);
    document.documentElement.lang = locale;
  }, [locale]);

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
      const nextKeys = { ...keys, hold: keys.hold || crypto.randomUUID() };
      setKeys(nextKeys);
      const data = await call(path(`/${reference}/reschedule-holds`), {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": nextKeys.hold },
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
      const nextKeys = { ...keys, reschedule: keys.reschedule || crypto.randomUUID() };
      setKeys(nextKeys);
      await call(path(`/${reference}/reschedule`), {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": nextKeys.reschedule },
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
      const nextKeys = { ...keys, cancel: keys.cancel || crypto.randomUUID() };
      setKeys(nextKeys);
      const data = await call(path(`/${reference}/cancel`), {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": nextKeys.cancel },
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
      const nextKeys = { ...keys, package: keys.package || crypto.randomUUID() };
      setKeys(nextKeys);
      const value = await call(`/v1/public/salons/${encodeURIComponent(salonSlug)}/package-reservations`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": nextKeys.package },
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
    <main className="booking-shell" data-testid="manage-booking">
      <header className="brand">
        <a href="/" aria-label="Nailsoft">NAILSOFT</a>
        <div className="brand-tools">
          {salonSlug && <a href={`/book/${encodeURIComponent(salonSlug)}`}>{t("startBooking")}</a>}
          <label className="language-switcher"><span className="sr-only">{t("selectLanguage")}</span><select aria-label={t("selectLanguage")} value={locale} onChange={(event) => { const next = event.target.value as Locale; setLocale(next); persistLocale(next); }}><option value="vi-VN">vi-VN</option><option value="en-US">en-US</option></select></label>
        </div>
      </header>
      <section className="hero" aria-labelledby="manage-title"><p>{t("bookingManagement")}</p><h1 id="manage-title">{t("manageBooking")}</h1><p className="muted">{t("manageBookingDescription")}</p></section>
      <section className="card booking-card">
        {notice && <div className="success" role="status">{notice}</div>}
        {state === "loading" && <div className="state" role="status">{t("loading")}</div>}
        {state === "offline" && <div className="error error-summary" role="alert"><strong>{t("offline")}</strong><p>{t("internetRequired")}</p><button className="secondary" type="button" onClick={() => setState("ready")}>{t("retry")}</button></div>}
        {state === "expired" && <div className="error error-summary" role="alert"><strong>{t("sessionExpired")}</strong><p>{t("manageBookingDescription")}</p><button className="secondary" type="button" onClick={() => { setToken(""); setStep("LOOKUP"); setState("ready"); }}>{t("verify")}</button></div>}
        {state === "error" && <div className="error error-summary" role="alert"><strong>{t("retry")}</strong><p>{error}</p><div className="actions"><button className="secondary" type="button" onClick={() => setState("ready")}>{t("retry")}</button><button className="link-button" type="button" onClick={() => { setError(""); setStep("LOOKUP"); setState("ready"); }}>{t("changeDetails")}</button></div></div>}

        {state === "ready" && step === "LOOKUP" && <form className="grid" onSubmit={request} aria-labelledby="lookup-heading"><h2 id="lookup-heading">{t("manageBooking")}</h2><label className="field" htmlFor="manage-salon">{t("salonCode")}<input id="manage-salon" required value={salonSlug} onChange={(event) => setSalonSlug(event.target.value.trim())} placeholder={t("salonCodePlaceholder")} /></label><label className="field" htmlFor="manage-reference">{t("bookingReference")}<input id="manage-reference" required value={reference} onChange={(event) => setReference(event.target.value.toUpperCase())} /></label><label className="field" htmlFor="manage-contact">{t("phone")} / {t("email")}<input id="manage-contact" required value={contact} onChange={(event) => setContact(event.target.value)} /></label><button className="primary" type="submit">{t("sendCode")}</button><p className="muted">{t("neutralResponse")}</p></form>}

        {state === "ready" && step === "OTP" && <div className="grid" aria-labelledby="manage-otp-heading"><h2 id="manage-otp-heading">{t("verificationCode")}</h2><label className="field" htmlFor="manage-code">{t("verificationCode")}<input id="manage-code" autoFocus inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} /></label><p className="muted">{t("verificationHint")}</p><button className="primary" type="button" disabled={!/^\d{6}$/.test(code)} onClick={() => void verify()}>{t("verify")}</button></div>}

        {state === "ready" && step === "DETAIL" && booking && <div className="grid" aria-labelledby="detail-heading"><div className="section-heading"><div><p className="eyebrow">{salon?.name ?? salonSlug}</p><h2 id="detail-heading">{booking.bookingReference}</h2></div><span className="badge">{booking.status}</span></div><div className="summary"><span>{t("branch")}: {branch?.name ?? salon?.name}</span><span>{booking.startAt && formatSalonDateTime(booking.startAt, locale, branch?.timezone ?? salon?.timezone)}</span><span>{t("timezoneLabel")}: {branch?.timezone ?? salon?.timezone}</span><span>{booking.contact?.displayName}</span>{booking.items?.map((item: any) => <span key={item.id}>{item.sequenceNo}. {localizedValue(item.service?.name, locale, item.service?.code)}</span>)}</div><PackagePanel locale={locale} packages={packages} booking={booking} packageReservation={packageReservation} loading={false} onReserve={reservePackage} /><div className="actions">{!bookingCancelled && <><label className="field" htmlFor="manage-date">{t("chooseTime")}<input id="manage-date" type="date" min={branch?.bookingWindow?.earliestDate} max={branch?.bookingWindow?.latestDate} value={date} onChange={(event) => setDate(event.target.value)} /></label><button className="secondary" type="button" disabled={!date} onClick={() => void findReplacementSlots()}>{t("chooseAnotherTime")}</button><button className="danger" type="button" onClick={() => void cancel()}>{t("cancelBooking")}</button></>}</div></div>}

        {state === "ready" && step === "REPLACEMENT_AVAILABILITY" && <div className="grid" aria-labelledby="replacement-heading"><h2 id="replacement-heading">{t("chooseAnotherTime")}</h2><p className="muted">{t("salonTime")}: {branch?.timezone ?? salon?.timezone}</p>{slots.length ? <div className="slots">{slots.map((item: any) => <button className="choice slot" type="button" key={item.fingerprint} onClick={() => void holdReplacement(item)}><strong>{formatSalonTime(item.startAt, locale, branch?.timezone ?? salon?.timezone)}</strong><small>{t("anyStaff")}</small></button>)}</div> : <div className="state">{t("noAvailability")}</div>}<button className="secondary" type="button" onClick={() => setStep("DETAIL")}>{t("back")}</button></div>}

        {state === "ready" && step === "RESCHEDULE_REVIEW" && replacementHold && <div className="grid" aria-labelledby="reschedule-heading"><h2 id="reschedule-heading">{t("review")}</h2><div className="summary"><span>{t("chooseTime")}: {formatSalonDateTime(selectedSlot.startAt, locale, branch?.timezone ?? salon?.timezone)}</span><span>{t("holdExpires")}: {formatSalonTime(replacementHold.expiresAt, locale, branch?.timezone ?? salon?.timezone)}</span><span>{t("noPayment")}</span></div><div className="actions"><button className="secondary" type="button" onClick={() => setStep("REPLACEMENT_AVAILABILITY")}>{t("back")}</button><button className="primary" type="button" onClick={() => void confirmReschedule()}>{t("confirmBooking")}</button></div></div>}
      </section>
    </main>
  );
}

function PackagePanel({ locale, packages, booking, packageReservation, loading, onReserve }: { locale: Locale; packages: any[]; booking: any; packageReservation: any; loading: boolean; onReserve: (entitlementId: string, itemId: string) => void }) {
  const t = (key: BookingMessageKey) => getMessage(locale, key);
  return <div className="summary"><h3>{t("servicePackages")}</h3>{packages.length === 0 ? <span>{t("noActivePackage")}</span> : packages.map((item: any) => <span key={item.id}>{localizedValue(item.name, locale, item.code)}: {item.availableUnits} {t("packageUnit")} {booking.items?.[0]?.id && !packageReservation && <button className="secondary" type="button" disabled={loading || item.availableUnits < 1} onClick={() => onReserve(item.id, booking.items[0].id)}>{t("reserveUnit")}</button>}</span>)}{packageReservation && <strong>{t("reservedUnit")} · {packageReservation.units}</strong>}</div>;
}

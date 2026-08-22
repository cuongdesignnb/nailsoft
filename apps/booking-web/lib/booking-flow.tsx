/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  formatMinorAmount,
  formatSalonDateTime,
  formatSalonTime,
  getInitialLocale,
  getMessage,
  localizedValue,
  persistLocale,
  resolveLocale,
  type BookingMessageKey,
  type Locale,
} from "./i18n";

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type FlowStep =
  | "BRANCH"
  | "SERVICES"
  | "AVAILABILITY"
  | "CONTACT"
  | "OTP"
  | "REVIEW"
  | "RESULT";
type AsyncState = "loading" | "ready" | "empty" | "error" | "offline" | "unavailable";

const steps: Array<{ id: FlowStep; label: BookingMessageKey }> = [
  { id: "BRANCH", label: "branch" },
  { id: "SERVICES", label: "services" },
  { id: "AVAILABILITY", label: "chooseTime" },
  { id: "CONTACT", label: "contact" },
  { id: "OTP", label: "verificationCode" },
  { id: "REVIEW", label: "review" },
  { id: "RESULT", label: "bookingSuccess" },
];

async function call(path: string, init?: RequestInit) {
  const response = await fetch(`${api}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(
      new Error(body.error?.message ?? "Unable to complete the request."),
      { code: body.error?.code, details: body.error?.details },
    );
  }
  return body.data;
}

function localName(value: any, locale: Locale) {
  return localizedValue(value, locale, "Service");
}

export default function BookingFlow({ salonSlug }: { salonSlug: string }) {
  const [locale, setLocale] = useState<Locale>(() => getInitialLocale());
  const [state, setState] = useState<AsyncState>("loading");
  const [error, setError] = useState("");
  const [step, setStep] = useState<FlowStep>("BRANCH");
  const [salon, setSalon] = useState<any>();
  const [branches, setBranches] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [staffDirectory, setStaffDirectory] = useState<any[]>([]);
  const [branch, setBranch] = useState<any>();
  const [selectedServices, setSelectedServices] = useState<any[]>([]);
  const [date, setDate] = useState("");
  const [availability, setAvailability] = useState<any>();
  const [staffId, setStaffId] = useState("");
  const [slot, setSlot] = useState<any>();
  const [hold, setHold] = useState<any>();
  const [remaining, setRemaining] = useState(0);
  const [contact, setContact] = useState({
    displayName: "",
    phone: "",
    email: "",
    locale: "vi-VN" as Locale,
  });
  const [challenge, setChallenge] = useState<any>();
  const [code, setCode] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [result, setResult] = useState<any>();
  const keys = useRef({ hold: "", booking: "" });

  useEffect(() => {
    document.documentElement.lang = locale;
    setContact((current) => ({ ...current, locale }));
  }, [locale]);

  useEffect(() => {
    void loadSalon();
    // A new salon link starts a new flow; no booking state is persisted here.
  }, [salonSlug]);

  useEffect(() => {
    if (!hold?.expiresAt) return;
    const update = () => {
      const seconds = Math.max(
        0,
        Math.ceil((new Date(hold.expiresAt).getTime() - Date.now()) / 1000),
      );
      setRemaining(seconds);
      if (!seconds) {
        setHold(undefined);
        setSlot(undefined);
        setError(getMessage(locale, "holdExpired"));
        setState("error");
        setStep("AVAILABILITY");
      }
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [hold?.expiresAt, locale]);

  const t = (key: BookingMessageKey) => getMessage(locale, key);

  const staffOptions = useMemo(() => {
    const map = new Map<string, string>(
      staffDirectory.map((staff) => [staff.id, staff.displayName]),
    );
    for (const candidate of availability?.days?.flatMap((day: any) =>
      day.slots.flatMap(
        (candidateSlot: any) => candidateSlot.staffCandidates ?? [],
      ),
    ) ?? []) {
      map.set(candidate.staffId, candidate.displayName);
    }
    return [...map].map(([id, name]) => ({ id, name }));
  }, [availability, staffDirectory]);

  async function loadSalon() {
    setState("loading");
    setError("");
    setStep("BRANCH");
    try {
      const profile = await call(`/v1/public/salons/${encodeURIComponent(salonSlug)}`);
      setSalon(profile);
      if (!profile.bookingAvailable) {
        setBranches([]);
        setState("unavailable");
        return;
      }
      if (!window.localStorage.getItem("nailsoft.booking.locale")) {
        setLocale(resolveLocale(profile.locale));
      }
      const branchRows = await call(
        `/v1/public/salons/${encodeURIComponent(salonSlug)}/branches`,
      );
      setBranches(branchRows);
      setState(branchRows.length ? "ready" : "empty");
    } catch (cause: any) {
      fail(cause);
    }
  }

  async function chooseBranch(value: any) {
    setBranch(value);
    setDate(value.bookingWindow?.earliestDate ?? "");
    setSelectedServices([]);
    setStaffId("");
    setState("loading");
    setError("");
    try {
      const [rows, staff] = await Promise.all([
        call(
          `/v1/public/salons/${encodeURIComponent(salonSlug)}/services?branchId=${encodeURIComponent(value.id)}`,
        ),
        call(
          `/v1/public/salons/${encodeURIComponent(salonSlug)}/staff?branchId=${encodeURIComponent(value.id)}`,
        ),
      ]);
      setServices(rows);
      setStaffDirectory(staff);
      setState(rows.length ? "ready" : "empty");
      setStep("SERVICES");
    } catch (cause: any) {
      fail(cause);
    }
  }

  function toggleService(service: any) {
    setSelectedServices((current) => {
      if (current.some((item) => item.id === service.id))
        return current.filter((item) => item.id !== service.id);
      if (current.length >= Number(branch?.policy?.maxItems ?? 1)) return current;
      return [...current, service];
    });
  }

  function moveService(index: number, offset: number) {
    setSelectedServices((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function findSlots() {
    if (!selectedServices.length || !date || !branch) return;
    if (!branch.policy.allowAnyTechnician && !staffId) {
      setError(t("requiredStaff"));
      return;
    }
    setState("loading");
    setError("");
    try {
      const first = selectedServices[0];
      const params = new URLSearchParams({
        branchId: branch.id,
        serviceId: first.id,
        dateFrom: date,
        dateTo: date,
        slotIntervalMin: "15",
      });
      if (staffId) params.set("staffId", staffId);
      const data = await call(
        `/v1/public/salons/${encodeURIComponent(salonSlug)}/availability?${params}`,
      );
      setAvailability(data);
      setState(
        data.days.some((day: any) => day.slots.length) ? "ready" : "empty",
      );
      setStep("AVAILABILITY");
    } catch (cause: any) {
      fail(cause);
    }
  }

  async function publicPlan(firstSlot: any) {
    const items: any[] = [];
    let cursor = new Date(firstSlot.startAt);
    const dataVersion = Number(availability.dataVersion);
    for (let index = 0; index < selectedServices.length; index += 1) {
      const service = selectedServices[index];
      if (index > 0) {
        const previous = selectedServices[index - 1];
        cursor = new Date(
          cursor.getTime() +
            (Number(previous.durationMin) +
              Number(previous.cleanupTimeMin) +
              Number(previous.bufferAfterMin) +
              Number(service.prepTimeMin) +
              Number(service.bufferBeforeMin)) *
              60_000,
        );
      }
      let candidate = index === 0 ? firstSlot : undefined;
      if (index > 0) {
        const parts = new Intl.DateTimeFormat("en", {
          timeZone: branch.timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        })
          .formatToParts(cursor)
          .reduce<Record<string, string>>((resultValue, part) => {
            resultValue[part.type] = part.value;
            return resultValue;
          }, {});
        const serviceDate = `${parts.year}-${parts.month}-${parts.day}`;
        const params = new URLSearchParams({
          branchId: branch.id,
          serviceId: service.id,
          dateFrom: serviceDate,
          dateTo: serviceDate,
          slotIntervalMin: "5",
        });
        if (staffId) params.set("staffId", staffId);
        const data = await call(
          `/v1/public/salons/${encodeURIComponent(salonSlug)}/availability?${params}`,
        );
        if (Number(data.dataVersion) !== dataVersion)
          throw Object.assign(new Error("Availability changed."), {
            code: "AVAILABILITY_CHANGED",
          });
        candidate = data.days
          .flatMap((day: any) => day.slots)
          .find((value: any) => value.startAt === cursor.toISOString());
      }
      if (!candidate)
        throw Object.assign(
          new Error(`No continuous time is available for ${localName(service.name, locale)}.`),
          { code: "SLOT_UNAVAILABLE" },
        );
      items.push({
        serviceId: service.id,
        staffPreference: staffId
          ? { type: "SPECIFIC", staffId }
          : { type: "ANY" },
        availabilityFingerprint: candidate.fingerprint,
      });
    }
    return { items, dataVersion };
  }

  async function selectSlot(value: any) {
    setSlot(value);
    setState("loading");
    setError("");
    try {
      const plan = await publicPlan(value);
      keys.current.hold ||= crypto.randomUUID();
      const data = await call(
        `/v1/public/salons/${encodeURIComponent(salonSlug)}/slot-holds`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": keys.current.hold,
          },
          body: JSON.stringify({
            branchId: branch.id,
            desiredStartAt: value.startAt,
            availabilityDataVersion: plan.dataVersion,
            clientKey: getClientKey(),
            items: plan.items,
          }),
        },
      );
      setHold(data);
      setState("ready");
      setStep("CONTACT");
    } catch (cause: any) {
      fail(cause);
    }
  }

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hold) return;
    if (!contact.phone.trim() && !contact.email.trim()) {
      setError(`${t("phone")} or ${t("email")} is required.`);
      return;
    }
    setState("loading");
    setError("");
    try {
      const data = await call(
        `/v1/public/salons/${encodeURIComponent(salonSlug)}/contact-verification/request`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contact: contact.phone || contact.email,
            channel: contact.phone ? "SMS" : "EMAIL",
          }),
        },
      );
      setChallenge(data);
      // Test codes are intentionally never rendered in production.
      if (process.env.NODE_ENV !== "production") setCode(data.testCode ?? "");
      setState("ready");
      setStep("OTP");
    } catch (cause: any) {
      fail(cause);
    }
  }

  async function verify() {
    if (!challenge) return;
    setState("loading");
    setError("");
    try {
      const data = await call(
        `/v1/public/salons/${encodeURIComponent(salonSlug)}/contact-verification/verify`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ challengeId: challenge.challengeId, code }),
        },
      );
      setVerificationToken(data.verificationToken);
      setState("ready");
      setStep("REVIEW");
    } catch (cause: any) {
      fail(cause);
    }
  }

  async function create() {
    if (!policyAccepted) {
      setError(t("requiredPolicy"));
      return;
    }
    if (!navigator.onLine) {
      setState("offline");
      return;
    }
    setState("loading");
    setError("");
    try {
      keys.current.booking ||= crypto.randomUUID();
      const data = await call(
        `/v1/public/salons/${encodeURIComponent(salonSlug)}/bookings`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": keys.current.booking,
          },
          body: JSON.stringify({
            holdId: hold.holdId,
            holdToken: hold.holdToken,
            contactVerificationToken: verificationToken,
            customer: {
              displayName: contact.displayName,
              locale,
              ...(contact.phone.trim() ? { phone: contact.phone } : {}),
              ...(contact.email.trim() ? { email: contact.email } : {}),
            },
            marketingConsent,
            acceptedPolicyVersion: branch.policy.version,
            acceptedAt: new Date().toISOString(),
          }),
        },
      );
      setResult(data);
      setState("ready");
      setStep("RESULT");
    } catch (cause: any) {
      if (["SLOT_HOLD_EXPIRED", "AVAILABILITY_CHANGED"].includes(cause.code)) {
        setHold(undefined);
        setSlot(undefined);
        setStep("AVAILABILITY");
      }
      if (cause.code === "BOOKING_POLICY_CHANGED") setPolicyAccepted(false);
      fail(cause);
    }
  }

  function fail(cause: any) {
    if (cause.code === "PUBLIC_BOOKING_UNAVAILABLE") {
      setState("unavailable");
      setError(t("bookingUnavailable"));
      return;
    }
    setError(`${cause.code ? `${cause.code}: ` : ""}${cause.message}`);
    setState(!navigator.onLine ? "offline" : "error");
  }

  const visibleSlots =
    availability?.days
      ?.flatMap((day: any) => day.slots)
      .filter(
        (candidate: any) =>
          !staffId ||
          candidate.staffCandidates?.some(
            (staff: any) => staff.staffId === staffId,
          ),
      ) ?? [];

  const policy = branch?.policy ?? {};
  const staffSelectionAllowed =
    policy.allowCustomerSelectStaff && !policy.hideStaffNames;

  return (
    <main className="booking-shell" data-testid="public-booking-flow">
      <header className="brand">
        <a href="/" aria-label="Nailsoft">
          NAILSOFT
        </a>
        <div className="brand-tools">
          <a href={`/manage-booking?salon=${encodeURIComponent(salonSlug)}`}>
            {t("manageBooking")}
          </a>
          <label className="language-switcher">
            <span className="sr-only">{t("selectLanguage")}</span>
            <select
              aria-label={t("selectLanguage")}
              value={locale}
              onChange={(event) => {
                const next = event.target.value as Locale;
                setLocale(next);
                persistLocale(next);
              }}
            >
              <option value="vi-VN">vi-VN</option>
              <option value="en-US">en-US</option>
            </select>
          </label>
        </div>
      </header>

      <section className="hero" aria-labelledby="booking-title">
        <p>{t("brandEyebrow")} · {salon?.name ?? salonSlug}</p>
        <h1 id="booking-title">{t("selectServices")}</h1>
        <p className="muted">
          {t("salonTime")}: {branch?.timezone ?? salon?.timezone ?? "—"}
        </p>
      </section>

      <section className="card booking-card">
        {state !== "unavailable" && (
          <ol className="steps" aria-label={t("startBooking")} tabIndex={0}>
            {steps.map((item, index) => (
              <li
                className={step === item.id ? "active" : ""}
                key={item.id}
                aria-current={step === item.id ? "step" : undefined}
              >
                <span>{index + 1}</span> {t(item.label)}
              </li>
            ))}
          </ol>
        )}
        {hold && state !== "unavailable" && (
          <p className="countdown" role="status">
            {t("chooseTime")}: {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
          </p>
        )}
        <StatePanel state={state} error={error} retry={() => void loadSalon()} locale={locale} />

        {state === "ready" && step === "BRANCH" && (
          <div className="grid" aria-labelledby="branch-heading">
            <h2 id="branch-heading">{t("selectBranch")}</h2>
            <div className="choice-grid">
              {branches.map((item) => (
                <button
                  className="choice choice-card"
                  type="button"
                  key={item.id}
                  onClick={() => void chooseBranch(item)}
                >
                  <strong>{item.name}</strong>
                  <small>{item.timezone}</small>
                  {item.bookingWindow && (
                    <small>
                      {item.bookingWindow.earliestDate} – {item.bookingWindow.latestDate}
                    </small>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {state === "ready" && step === "SERVICES" && branch && (
          <div className="grid" aria-labelledby="services-heading">
            <div className="section-heading">
              <div>
                <p className="eyebrow">{branch.name}</p>
                <h2 id="services-heading">{t("selectServices")}</h2>
              </div>
              <span className="badge">{selectedServices.length}/{policy.maxItems ?? 1}</span>
            </div>
            <p className="muted">
              {t("services")} · {t("timezoneLabel")}: {branch.timezone}
            </p>
            <div className="choice-grid">
              {services.map((item) => {
                const selected = selectedServices.some((value) => value.id === item.id);
                return (
                  <button
                    className={`choice choice-card ${selected ? "selected" : ""}`}
                    type="button"
                    key={item.id}
                    aria-pressed={selected}
                    onClick={() => toggleService(item)}
                  >
                    <strong>{localName(item.name, locale)}</strong>
                    <span>
                      {item.durationMin} {t("duration").toLowerCase()} · {item.price?.amount ?? formatMinorAmount(item.price?.amountMinor ?? 0, item.price?.currency ?? salon?.currency ?? "VND", locale)} {item.price?.currency ?? salon?.currency}
                    </span>
                  </button>
                );
              })}
            </div>
            {!services.length && <EmptyState message={t("noAvailability")} />}
            {selectedServices.length > 0 && (
              <div className="summary" aria-label={t("services")}>
                <strong>{t("services")}</strong>
                {selectedServices.map((item, index) => (
                  <div className="ordered-item" key={item.id}>
                    <span>{index + 1}. {localName(item.name, locale)}</span>
                    <span className="inline-actions">
                      <button type="button" className="compact" onClick={() => moveService(index, -1)} aria-label={`${t("back")} ${localName(item.name, locale)}`}>↑</button>
                      <button type="button" className="compact" onClick={() => moveService(index, 1)} aria-label={`${t("next")} ${localName(item.name, locale)}`}>↓</button>
                      <button type="button" className="compact" onClick={() => toggleService(item)}>{t("back")}</button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <label className="field" htmlFor="booking-date">
              {t("chooseTime")} ({branch.timezone})
              <input
                id="booking-date"
                type="date"
                required
                min={branch.bookingWindow?.earliestDate}
                max={branch.bookingWindow?.latestDate}
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            {staffSelectionAllowed && staffOptions.length > 0 && (
              <label className="field" htmlFor="staff-selection">
                {t("selectStaff")}
                <select
                  id="staff-selection"
                  required={!policy.allowAnyTechnician}
                  value={staffId}
                  onChange={(event) => setStaffId(event.target.value)}
                >
                  {policy.allowAnyTechnician && <option value="">{t("anyStaff")}</option>}
                  {!policy.allowAnyTechnician && <option value="">{t("selectStaff")}</option>}
                  {staffOptions.map((staff) => <option key={staff.id} value={staff.id}>{staff.name}</option>)}
                </select>
              </label>
            )}
            {!staffSelectionAllowed && <p className="muted">{t("staffNamesHidden")}</p>}
            <button
              className="primary"
              type="button"
              disabled={!selectedServices.length || !date || (!policy.allowAnyTechnician && !staffId)}
              onClick={() => void findSlots()}
            >
              {t("findAvailability")}
            </button>
          </div>
        )}

        {(state === "ready" || state === "empty") && step === "AVAILABILITY" && branch && (
          <div className="grid" aria-labelledby="availability-heading">
            <div className="section-heading">
              <div><p className="eyebrow">{branch.name}</p><h2 id="availability-heading">{t("availableTimes")}</h2></div>
              <span className="badge">{branch.timezone}</span>
            </div>
            {staffSelectionAllowed && staffOptions.length > 0 && (
              <label className="field" htmlFor="availability-staff">
                {t("selectStaff")}
                <select id="availability-staff" value={staffId} onChange={(event) => setStaffId(event.target.value)}>
                  {policy.allowAnyTechnician && <option value="">{t("anyStaff")}</option>}
                  {staffOptions.map((staff) => <option key={staff.id} value={staff.id}>{staff.name}</option>)}
                </select>
              </label>
            )}
            <div className="slots" aria-live="polite">
              {visibleSlots.map((item: any) => (
                <button className="choice slot" type="button" key={item.fingerprint} onClick={() => void selectSlot(item)}>
                  <strong>{formatSalonTime(item.startAt, locale, branch.timezone)}</strong>
                  <small>{staffId ? staffOptions.find((staff) => staff.id === staffId)?.name : t("anyStaff")}</small>
                </button>
              ))}
            </div>
            {!visibleSlots.length && <EmptyState message={t("noAvailability")} />}
            <button className="secondary" type="button" onClick={() => { setState("ready"); setStep("SERVICES"); }}>{t("changeSelection")}</button>
          </div>
        )}

        {state === "ready" && step === "CONTACT" && (
          <form className="grid" onSubmit={requestCode} aria-labelledby="contact-heading">
            <h2 id="contact-heading">{t("contact")}</h2>
            <label className="field" htmlFor="contact-name">{t("displayName")}<input id="contact-name" required value={contact.displayName} onChange={(event) => setContact({ ...contact, displayName: event.target.value })} /></label>
            <label className="field" htmlFor="contact-phone">{t("phone")}<input id="contact-phone" inputMode="tel" value={contact.phone} onChange={(event) => setContact({ ...contact, phone: event.target.value })} /></label>
            <label className="field" htmlFor="contact-email">{t("email")} ({t("optional")})<input id="contact-email" type="email" value={contact.email} onChange={(event) => setContact({ ...contact, email: event.target.value })} /></label>
            <p className="muted">{t("verificationHint")}</p>
            <button className="primary" type="submit">{t("sendCode")}</button>
          </form>
        )}

        {state === "ready" && step === "OTP" && (
          <div className="grid" aria-labelledby="otp-heading">
            <h2 id="otp-heading">{t("verificationCode")}</h2>
            <label className="field" htmlFor="verification-code">{t("verificationCode")}<input id="verification-code" autoFocus inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} /></label>
            <p className="muted">{t("verificationHint")}</p>
            <button className="primary" type="button" disabled={!/^\d{6}$/.test(code)} onClick={() => void verify()}>{t("verify")}</button>
          </div>
        )}

        {state === "ready" && step === "REVIEW" && branch && slot && (
          <div className="grid" aria-labelledby="review-heading">
            <h2 id="review-heading">{t("review")}</h2>
            <div className="summary review-summary">
              <span><strong>{t("branch")}:</strong> {branch.name}</span>
              <span><strong>{t("timezoneLabel")}:</strong> {branch.timezone}</span>
              <span><strong>{t("chooseTime")}:</strong> {formatSalonDateTime(slot.startAt, locale, branch.timezone)}</span>
              {selectedServices.map((item, index) => <span key={item.id}><strong>{index + 1}.</strong> {localName(item.name, locale)} · {item.durationMin} {t("duration").toLowerCase()} · {item.price?.amount ?? "—"} {item.price?.currency ?? salon?.currency}</span>)}
            </div>
            <label className="check-field"><input type="checkbox" required checked={policyAccepted} onChange={(event) => setPolicyAccepted(event.target.checked)} /><span>{t("policyConsent")} <a href={branch.policy.documentUrl ?? "#policy"}>v{branch.policy.version}</a>. {branch.policy.summary}</span></label>
            <label className="check-field"><input type="checkbox" checked={marketingConsent} onChange={(event) => setMarketingConsent(event.target.checked)} /><span>{t("marketingConsent")} <small>({t("marketingConsentHint")})</small></span></label>
            <p className="muted">{t("noPayment")}</p>
            <div className="actions"><button className="secondary" type="button" onClick={() => setStep("AVAILABILITY")}>{t("chooseAnotherTime")}</button><button className="primary" type="button" disabled={!policyAccepted} onClick={() => void create()}>{t("confirmBooking")}</button></div>
          </div>
        )}

        {state === "ready" && step === "RESULT" && result && (
          <div className="success" role="status" tabIndex={-1} aria-labelledby="result-heading">
            <p className="eyebrow">{t("bookingSuccess")}</p>
            <h2 id="result-heading">{t("bookingSuccess")}</h2>
            <p>{t("bookingReference")}: <strong>{result.bookingReference}</strong></p>
            <p>{result.startAt && branch ? formatSalonDateTime(result.startAt, locale, branch.timezone) : ""} · {result.status}</p>
            <div className="actions"><a className="primary" href={`/manage-booking?salon=${encodeURIComponent(salonSlug)}`}>{t("manageBooking")}</a><a className="secondary" href="/">{t("bookAnother")}</a></div>
          </div>
        )}
      </section>
    </main>
  );
}

function StatePanel({ state, error, retry, locale }: { state: AsyncState; error: string; retry: () => void; locale: Locale }) {
  const t = (key: BookingMessageKey) => getMessage(locale, key);
  if (state === "loading") return <div className="state" role="status">{t("loading")}</div>;
  if (state === "unavailable") return <div className="error error-summary" role="alert"><strong>{t("bookingUnavailable")}</strong><p>{t("manageBookingDescription")}</p><a className="secondary" href="/manage-booking">{t("manageBooking")}</a></div>;
  if (state === "offline") return <div className="error error-summary" role="alert"><strong>Offline</strong><p>{t("noPayment")}</p><button className="secondary" type="button" onClick={retry}>{t("retry")}</button></div>;
  if (state === "error") return <div className="error error-summary" role="alert"><strong>{t("retry")}</strong><p>{error}</p><button className="secondary" type="button" onClick={retry}>{t("retry")}</button></div>;
  if (state === "empty") return <div className="state"><strong>{t("noAvailability")}</strong><button className="secondary" type="button" onClick={retry}>{t("retry")}</button></div>;
  return null;
}

function EmptyState({ message }: { message: string }) {
  return <div className="state" role="status">{message}</div>;
}

function getClientKey() {
  const key = "nailsoft-booking-client";
  let value = localStorage.getItem(key);
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem(key, value);
  }
  return value;
}

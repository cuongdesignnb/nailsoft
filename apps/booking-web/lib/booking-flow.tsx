/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  formatMinorAmount,
  formatBookingDate,
  formatSalonDateTime,
  formatSalonTime,
  bookingStatusLabel,
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

const heroLabels: Record<FlowStep, BookingMessageKey> = {
  BRANCH: "selectBranch",
  SERVICES: "selectServices",
  AVAILABILITY: "availableTimes",
  CONTACT: "contact",
  OTP: "verificationCode",
  REVIEW: "review",
  RESULT: "bookingSuccess",
};

async function call(path: string, init?: RequestInit) {
  const response = await fetch(`${api}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(
      new Error(body.error?.message ?? "Không thể hoàn tất yêu cầu."),
      { code: body.error?.code, details: body.error?.details },
    );
  }
  return body.data;
}

function localizedError(cause: any, locale: Locale) {
  const code = String(cause?.code ?? "");
  const messages: Partial<Record<string, BookingMessageKey>> = {
    PUBLIC_BOOKING_UNAVAILABLE: "bookingUnavailable",
    PUBLIC_BOOKING_DISABLED: "bookingUnavailable",
    SLOT_HOLD_EXPIRED: "holdExpired",
    AVAILABILITY_CHANGED: "bookingChanged",
    SLOT_UNAVAILABLE: "noAvailability",
  };
  const key = messages[code];
  return key ? getMessage(locale, key) : getMessage(locale, "retry");
}

function localName(value: any, locale: Locale) {
  return localizedValue(value, locale, "Service");
}

function servicePrice(value: any, locale: Locale, fallbackCurrency: string) {
  const currency = value?.currency ?? fallbackCurrency;
  if (value?.amount != null) {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "VND" ? 0 : 2,
    }).format(Number(value.amount));
  }
  return formatMinorAmount(value?.amountMinor ?? 0, currency, locale);
}

export default function BookingFlow({ salonSlug, attributionReference }: { salonSlug: string; attributionReference?: string }) {
  // Keep the first client render identical to the server render. Browser locale
  // and saved preferences are applied after hydration in the effect below.
  const [locale, setLocale] = useState<Locale>("vi-VN");
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
  const [challengeExpiresAt, setChallengeExpiresAt] = useState<number | null>(null);
  const [challengeRemaining, setChallengeRemaining] = useState(0);
  const [challengeExpired, setChallengeExpired] = useState(false);
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
    setLocale(getInitialLocale());
  }, []);

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
          new Error(getMessage(locale, "noContinuousTime")),
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
      setError(t("contactRequired"));
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
      const expiresIn = Number(data.expiresIn);
      setChallengeExpiresAt(Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : null);
      setChallengeRemaining(Number.isFinite(expiresIn) && expiresIn > 0 ? Math.ceil(expiresIn) : 0);
      setChallengeExpired(false);
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
      setChallengeExpiresAt(null);
      setChallengeRemaining(0);
      setChallengeExpired(false);
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
            ...(attributionReference ? { attributionReference } : {}),
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
    setError(localizedError(cause, locale));
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

      <section className="hero booking-flow-hero" aria-labelledby="booking-title">
        <div>
          <p>{t("brandEyebrow")} · {salon?.name ?? salonSlug}</p>
          <h1 id="booking-title">{t(heroLabels[step])}</h1>
          <p className="muted">
            {t("salonTime")}: {branch?.timezone ?? salon?.timezone ?? "—"}
          </p>
        </div>
        <aside className="booking-context-card" aria-label={t("workspace")}>
          <span className="booking-context-mark" aria-hidden="true">✦</span>
          <div><small>{t("workspace")}</small><strong>{salon?.name ?? salonSlug}</strong></div>
          <span className="booking-context-status">{salon?.bookingAvailable ? "●" : "—"}</span>
        </aside>
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
        {!(state === "empty" && step === "AVAILABILITY") && (
          <StatePanel state={state} error={error} retry={() => void loadSalon()} locale={locale} />
        )}

        {state === "ready" && step === "BRANCH" && (
          <div className="grid" aria-labelledby="branch-heading">
            <h2 id="branch-heading">{t("selectBranch")}</h2>
            <div className="choice-grid branch-choice-grid">
              {branches.map((item) => (
                <button
                  className="choice choice-card branch-choice"
                  type="button"
                  key={item.id}
                  onClick={() => void chooseBranch(item)}
                >
                  <span className="branch-choice-top"><span className="branch-choice-icon" aria-hidden="true">⌖</span><small>{t("branch")}</small><span className="branch-choice-arrow" aria-hidden="true">↗</span></span>
                  <strong>{item.name}</strong>
                  <small>{item.timezone}</small>
                  {item.bookingWindow ? <span className="branch-choice-window">{formatBookingDate(item.bookingWindow.earliestDate, locale)} – {formatBookingDate(item.bookingWindow.latestDate, locale)}</span> : null}
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
                      {item.durationMin} {t("minutes")} · {servicePrice(item.price, locale, salon?.currency ?? "VND")}
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
            {!visibleSlots.length && (
              <div className="state" role="status">
                <strong>{t("noAvailability")}</strong>
                <button className="secondary" type="button" onClick={() => void findSlots()}>{t("retry")}</button>
              </div>
            )}
            <button className="secondary" type="button" onClick={() => { setState("ready"); setStep("SERVICES"); }}>{t("changeSelection")}</button>
          </div>
        )}

        {state === "ready" && step === "CONTACT" && (
          <div className="booking-step-layout">
            <form className="booking-step-main" onSubmit={requestCode} aria-labelledby="contact-heading">
              <div className="booking-step-heading">
                <p className="eyebrow">04 / {t("contact")}</p>
                <h2 id="contact-heading">{t("contact")}</h2>
                <p>{t("contactIntro")}</p>
              </div>
              <div className="booking-form-section">
                <div className="booking-form-section-heading">
                  <span className="booking-section-icon" aria-hidden="true">♡</span>
                  <div><strong>{t("contactDetails")}</strong><small>{t("contactDetailsHint")}</small></div>
                </div>
                <div className="booking-form-fields">
                  <label className="field" htmlFor="contact-name">
                    <span>{t("displayName")}</span>
                    <input id="contact-name" name="name" autoComplete="name" required value={contact.displayName} onChange={(event) => setContact({ ...contact, displayName: event.target.value })} />
                  </label>
                  <label className="field" htmlFor="contact-phone">
                    <span>{t("phone")}</span>
                    <input id="contact-phone" name="phone" autoComplete="tel" inputMode="tel" value={contact.phone} onChange={(event) => setContact({ ...contact, phone: event.target.value })} />
                    <small>{t("verificationChannelHint")}</small>
                  </label>
                  <label className="field" htmlFor="contact-email">
                    <span>{t("email")} <em>({t("optional")})</em></span>
                    <input id="contact-email" name="email" autoComplete="email" type="email" value={contact.email} onChange={(event) => setContact({ ...contact, email: event.target.value })} />
                  </label>
                </div>
              </div>
              <div className="booking-trust-note" role="note">
                <span aria-hidden="true">✓</span>
                <p><strong>{t("privacyTitle")}</strong>{t("privacyHint")}</p>
              </div>
              <div className="booking-form-actions">
                <button className="secondary" type="button" onClick={() => { setState("ready"); setStep("AVAILABILITY"); }}>{t("chooseAnotherTime")}</button>
                <button className="primary" type="submit">{t("sendCode")} <span aria-hidden="true">→</span></button>
              </div>
            </form>
            <BookingSelectionSummary branch={branch} slot={slot} selectedServices={selectedServices} salon={salon} locale={locale} remaining={remaining} t={t} />
          </div>
        )}

        {state === "ready" && step === "OTP" && (
          <div className="booking-step-layout">
            <div className="booking-step-main" aria-labelledby="otp-heading">
              <div className="booking-step-heading">
                <p className="eyebrow">05 / {t("verificationCode")}</p>
                <h2 id="otp-heading">{t("verificationTitle")}</h2>
                <p>{t("verificationSentTo")} <strong>{maskVerificationDestination(contact)}</strong></p>
              </div>
              {challengeExpired ? (
                <div className="error error-summary booking-alert" role="alert">
                  <span className="booking-alert-icon" aria-hidden="true">!</span>
                  <div><strong>{t("verificationExpired")}</strong><p>{t("verificationExpiredHint")}</p></div>
                  <button className="secondary" type="button" onClick={() => { setStep("CONTACT"); setChallenge(undefined); setChallengeExpiresAt(null); setChallengeRemaining(0); setChallengeExpired(false); setCode(""); }}>{t("requestNewCode")}</button>
                </div>
              ) : (
                <div className="otp-panel">
                  <label className="field otp-field" htmlFor="verification-code">
                    <span>{t("verificationCode")}</span>
                    <input id="verification-code" autoFocus inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} />
                  </label>
                  <p className="muted">{t("verificationHint")}</p>
                  {challengeRemaining > 0 && <p className="countdown" role="status">{t("verificationExpires")}: {Math.floor(challengeRemaining / 60)}:{String(challengeRemaining % 60).padStart(2, "0")}</p>}
                  <div className="booking-form-actions"><button className="secondary" type="button" onClick={() => { setStep("CONTACT"); setChallenge(undefined); setChallengeExpiresAt(null); setChallengeRemaining(0); setChallengeExpired(false); setCode(""); }}>{t("changeContact")}</button><button className="primary" type="button" disabled={!/^\d{6}$/.test(code)} onClick={() => void verify()}>{t("verify")} <span aria-hidden="true">→</span></button></div>
                </div>
              )}
              <div className="booking-trust-note" role="note"><span aria-hidden="true">⌁</span><p><strong>{t("verificationPrivacyTitle")}</strong>{t("verificationPrivacyHint")}</p></div>
            </div>
            <BookingSelectionSummary branch={branch} slot={slot} selectedServices={selectedServices} salon={salon} locale={locale} remaining={remaining} t={t} />
          </div>
        )}

        {state === "ready" && step === "REVIEW" && branch && slot && (
          <div className="booking-step-layout booking-review-layout">
            <div className="booking-step-main" aria-labelledby="review-heading">
              <div className="booking-step-heading">
                <p className="eyebrow">06 / {t("review")}</p>
                <h2 id="review-heading">{t("reviewTitle")}</h2>
                <p>{t("reviewHint")}</p>
              </div>
              <div className="review-detail-grid">
                <section className="review-detail-card"><span className="booking-section-icon" aria-hidden="true">⌖</span><div><small>{t("branch")}</small><strong>{branch.name}</strong><span>{branch.timezone}</span></div></section>
                <section className="review-detail-card"><span className="booking-section-icon" aria-hidden="true">◷</span><div><small>{t("chooseTime")}</small><strong>{formatSalonDateTime(slot.startAt, locale, branch.timezone)}</strong><span>{t("holdExpires")}: {formatSalonTime(hold?.expiresAt, locale, branch.timezone)}</span></div></section>
              </div>
              <section className="review-services-card">
                <div className="booking-form-section-heading"><span className="booking-section-icon" aria-hidden="true">✦</span><div><strong>{t("services")}</strong><small>{selectedServices.length} {t("service").toLowerCase()}</small></div></div>
                <div className="review-service-list">{selectedServices.map((item, index) => <div className="review-service-row" key={item.id}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{localName(item.name, locale)}</strong><small>{item.durationMin} {t("minutes")}</small></div><b>{servicePrice(item.price, locale, salon?.currency ?? "VND")}</b></div>)}</div>
              </section>
              <div className="review-policy-stack">
                <label className="check-field"><input type="checkbox" required checked={policyAccepted} onChange={(event) => setPolicyAccepted(event.target.checked)} /><span>{t("policyConsent")} <a href={branch.policy.documentUrl ?? "#policy"}>v{branch.policy.version}</a>. {branch.policy.summary}</span></label>
                <label className="check-field"><input type="checkbox" checked={marketingConsent} onChange={(event) => setMarketingConsent(event.target.checked)} /><span>{t("marketingConsent")} <small>({t("marketingConsentHint")})</small></span></label>
              </div>
              <div className="booking-trust-note" role="note"><span aria-hidden="true">✓</span><p><strong>{t("noPayment")}</strong>{t("reviewPrivacyHint")}</p></div>
              <div className="booking-form-actions"><button className="secondary" type="button" onClick={() => setStep("AVAILABILITY")}>{t("chooseAnotherTime")}</button><button className="primary" type="button" disabled={!policyAccepted} onClick={() => void create()}>{t("confirmBooking")} <span aria-hidden="true">→</span></button></div>
            </div>
          </div>
        )}

        {state === "ready" && step === "RESULT" && result && (
          <div className="booking-result" role="status" tabIndex={-1} aria-labelledby="result-heading">
            <div className="booking-result-mark" aria-hidden="true">✓</div>
            <p className="eyebrow">07 / {t("bookingSuccess")}</p>
            <h2 id="result-heading">{t("bookingSuccess")}</h2>
            <p className="booking-result-lead">{t("bookingSuccessHint")}</p>
            <div className="booking-result-card">
              <div><small>{t("bookingReference")}</small><strong>{result.bookingReference}</strong></div>
              <div><small>{t("chooseTime")}</small><strong>{result.startAt && branch ? formatSalonDateTime(result.startAt, locale, branch.timezone) : "—"}</strong></div>
              <div><small>{t("status")}</small><strong>{bookingStatusLabel(result.status, locale)}</strong></div>
            </div>
            <div className="booking-form-actions"><a className="primary" href={`/manage-booking?salon=${encodeURIComponent(salonSlug)}`}>{t("manageBooking")} <span aria-hidden="true">→</span></a><a className="secondary" href="/">{t("bookAnother")}</a></div>
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
  if (state === "offline") return <div className="error error-summary" role="alert"><strong>{t("offline")}</strong><p>{t("noPayment")}</p><button className="secondary" type="button" onClick={retry}>{t("retry")}</button></div>;
  if (state === "error") return <div className="error error-summary" role="alert"><strong>{t("retry")}</strong><p>{error}</p><button className="secondary" type="button" onClick={retry}>{t("retry")}</button></div>;
  if (state === "empty") return <div className="state"><strong>{t("noAvailability")}</strong><button className="secondary" type="button" onClick={retry}>{t("retry")}</button></div>;
  return null;
}

function EmptyState({ message }: { message: string }) {
  return <div className="state" role="status">{message}</div>;
}

function BookingSelectionSummary({ branch, slot, selectedServices, salon, locale, remaining, t }: { branch: any; slot: any; selectedServices: any[]; salon: any; locale: Locale; remaining: number; t: (key: BookingMessageKey) => string }) {
  return (
    <aside className="booking-selection-summary" aria-label={t("bookingSummary")}>
      <div className="booking-summary-top"><span className="booking-summary-mark" aria-hidden="true">✦</span><div><small>{t("bookingSummary")}</small><strong>{salon?.name ?? "—"}</strong></div></div>
      <div className="booking-summary-highlight"><small>{t("chooseTime")}</small><strong>{slot?.startAt && branch ? formatSalonDateTime(slot.startAt, locale, branch.timezone) : "—"}</strong><span>{branch?.name ?? "—"}</span></div>
      <dl className="booking-summary-list">
        <div><dt>{t("branch")}</dt><dd>{branch?.name ?? "—"}</dd></div>
        <div><dt>{t("services")}</dt><dd>{selectedServices.length ? selectedServices.map((item) => localName(item.name, locale)).join(", ") : "—"}</dd></div>
        <div><dt>{t("contact")}</dt><dd>{t("afterVerification")}</dd></div>
      </dl>
      {remaining > 0 && <div className="booking-summary-hold"><span aria-hidden="true">◷</span><div><strong>{t("holdActive")}</strong><small>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")} · {t("holdHint")}</small></div></div>}
      <p className="booking-summary-footnote">{t("summaryUpdates")}</p>
    </aside>
  );
}

function maskVerificationDestination(contact: { phone?: string; email?: string }) {
  if (contact.phone?.trim()) {
    const digits = contact.phone.replace(/\D/g, "");
    return digits.length > 3 ? `•••• ${digits.slice(-4)}` : "••••";
  }
  if (contact.email?.includes("@")) {
    const [name = "", domain = ""] = contact.email.split("@");
    return `${name.slice(0, 2)}•••@${domain}`;
  }
  return "—";
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

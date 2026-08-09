"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  getInitialLocale,
  getMessage,
  persistLocale,
  type Locale,
} from "../lib/i18n";

export default function Home() {
  const [locale, setLocale] = useState<Locale>("vi-VN");
  const [salonSlug, setSalonSlug] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const next = getInitialLocale();
    setLocale(next);
    document.documentElement.lang = next;
  }, []);

  function changeLocale(next: Locale) {
    setLocale(next);
    persistLocale(next);
    document.documentElement.lang = next;
  }

  function startBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = salonSlug.trim();
    if (!value) {
      setError(getMessage(locale, "requiredSalonCode"));
      return;
    }
    window.location.assign(`/book/${encodeURIComponent(value)}`);
  }

  const t = (key: Parameters<typeof getMessage>[1]) => getMessage(locale, key);

  return (
    <main className="booking-shell">
      <header className="brand">
        <a href="/" aria-label="Nailsoft">
          NAILSOFT
        </a>
        <div className="brand-tools">
          <a href="/manage-booking">{t("manageBooking")}</a>
          <label className="language-switcher">
            <span className="sr-only">{t("language")}</span>
            <select
              aria-label={t("language")}
              value={locale}
              onChange={(event) => changeLocale(event.target.value as Locale)}
            >
              <option value="vi-VN">vi-VN</option>
              <option value="en-US">en-US</option>
            </select>
          </label>
        </div>
      </header>
      <section className="hero" aria-labelledby="landing-title">
        <p>{t("brandEyebrow")}</p>
        <h1 id="landing-title">{t("landingTitle")}</h1>
        <p className="muted">{t("landingDescription")}</p>
      </section>
      <section className="card landing-grid" aria-label={t("startBooking")}>
        <form className="grid landing-form" onSubmit={startBooking} noValidate>
          <label className="field" htmlFor="salon-code">
            {t("salonCode")}
            <input
              id="salon-code"
              value={salonSlug}
              onChange={(event) => {
                setSalonSlug(event.target.value);
                setError("");
              }}
              placeholder={t("salonCodePlaceholder")}
              autoComplete="off"
              required
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" type="submit">
            {t("startBooking")}
          </button>
        </form>
        <div className="summary landing-manage">
          <strong>{t("manageBooking")}</strong>
          <p className="muted">{t("manageBookingDescription")}</p>
          <a className="secondary" href="/manage-booking">
            {t("manageBooking")}
          </a>
        </div>
      </section>
    </main>
  );
}

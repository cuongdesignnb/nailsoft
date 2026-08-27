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
    <main className="booking-landing-page">
      <div className="booking-landing-shell">
        <header className="landing-header">
          <a className="landing-logo" href="/" aria-label="NailSoft">
            <span className="landing-logo-mark" aria-hidden="true">N</span>
            <span>
              <strong>NailSoft</strong>
              <small>Beauty booking</small>
            </span>
          </a>
          <nav className="landing-nav" aria-label={t("language")}>
            <a href="#start-booking">{t("startBooking")}</a>
            <a href="/manage-booking">{t("manageBooking")}</a>
            <label className="landing-language">
              <span className="sr-only">{t("language")}</span>
              <select
                aria-label={t("language")}
                value={locale}
                onChange={(event) => changeLocale(event.target.value as Locale)}
              >
                <option value="vi-VN">VI</option>
                <option value="en-US">EN</option>
              </select>
            </label>
          </nav>
        </header>

        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero-copy">
            <p className="landing-eyebrow">{t("brandEyebrow")}</p>
            <h1 id="landing-title">{t("landingTitle")}</h1>
            <p className="landing-lead">{t("landingLead")}</p>
            <div className="landing-hero-actions">
              <a className="landing-button landing-button-primary" href="#start-booking">
                {t("startBooking")}
                <span aria-hidden="true">→</span>
              </a>
              <a className="landing-text-link" href="/manage-booking">
                {t("manageBooking")}
              </a>
            </div>
            <ul className="landing-trust-list" aria-label={t("landingDescription")}>
              <li><span aria-hidden="true">✦</span>{t("landingTrustFast")}</li>
              <li><span aria-hidden="true">✓</span>{t("landingTrustSafe")}</li>
              <li><span aria-hidden="true">↗</span>{t("landingTrustManage")}</li>
            </ul>
          </div>
          <div className="landing-hero-art" aria-label={t("landingVisualTitle")}>
            <div className="landing-art-orbit landing-art-orbit-one" aria-hidden="true" />
            <div className="landing-art-orbit landing-art-orbit-two" aria-hidden="true" />
            <div className="landing-art-card">
              <div className="landing-art-card-top">
                <span className="landing-art-icon" aria-hidden="true">✦</span>
                <span>{t("landingVisualEyebrow")}</span>
              </div>
              <div className="landing-art-line landing-art-line-large" aria-hidden="true" />
              <div className="landing-art-line landing-art-line-small" aria-hidden="true" />
              <div className="landing-art-choice-row" aria-hidden="true">
                <span>09:30</span><span className="is-selected">11:00</span><span>14:30</span>
              </div>
              <div className="landing-art-footer">
                <span>{t("landingVisualHint")}</span>
                <span className="landing-art-arrow" aria-hidden="true">↗</span>
              </div>
            </div>
            <span className="landing-art-note landing-art-note-top">Nail care</span>
            <span className="landing-art-note landing-art-note-bottom">Your time</span>
          </div>
        </section>

        <section id="start-booking" className="landing-entry-grid" aria-label={t("startBooking")}>
          <div className="landing-entry-card">
            <div className="landing-section-heading">
              <div>
                <p className="landing-eyebrow">01 / {t("startBooking")}</p>
                <h2>{t("landingEntryTitle")}</h2>
              </div>
              <span className="landing-step-number" aria-hidden="true">01</span>
            </div>
            <p className="landing-section-copy">{t("landingEntryHint")}</p>
            <form className="landing-entry-form" onSubmit={startBooking} noValidate>
              <label className="landing-field" htmlFor="salon-code">
                <span>{t("salonCode")}</span>
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
              {error ? <p className="landing-error" role="alert">{error}</p> : null}
              <button className="landing-button landing-button-primary landing-submit" type="submit">
                {t("startBooking")} <span aria-hidden="true">→</span>
              </button>
            </form>
            <p className="landing-help">{t("landingNeedHelp")}</p>
          </div>
          <aside className="landing-manage-card">
            <p className="landing-eyebrow">{t("landingManageEyebrow")}</p>
            <h2>{t("landingManageTitle")}</h2>
            <p>{t("landingManageHint")}</p>
            <a className="landing-button landing-button-light" href="/manage-booking">
              {t("manageBooking")} <span aria-hidden="true">→</span>
            </a>
          </aside>
        </section>

        <footer className="landing-footer">
          <span>© NailSoft</span>
          <span>{t("landingDescription")}</span>
        </footer>
      </div>
    </main>
  );
}

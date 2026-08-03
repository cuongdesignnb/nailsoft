"use client";

import { useId } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Dialog } from "radix-ui";
import { FiAlertCircle, FiArrowLeft, FiBarChart2, FiBell, FiBox, FiCalendar, FiCheck, FiChevronDown, FiChevronLeft, FiChevronRight, FiClock, FiCreditCard, FiDownload, FiEdit2, FiExternalLink, FiFileText, FiFilter, FiGift, FiHome, FiLock, FiLogOut, FiMenu, FiMoreHorizontal, FiPackage, FiPhone, FiPlus, FiRefreshCw, FiSearch, FiSettings, FiShield, FiShoppingBag, FiSliders, FiTag, FiTrendingUp, FiUser, FiUsers, FiX } from "react-icons/fi";
import type { IconType } from "react-icons";
import type { IconName } from "@nailsoft/icons";
import { iconLabels } from "@nailsoft/icons";

const webIcons: Record<IconName, IconType> = {
  activity: FiTrendingUp, alert: FiAlertCircle, archive: FiBox, arrowLeft: FiArrowLeft, arrowRight: FiChevronRight,
  calendar: FiCalendar, camera: FiFileText, chart: FiBarChart2, check: FiCheck, chevronDown: FiChevronDown,
  chevronLeft: FiChevronLeft, chevronRight: FiChevronRight, clock: FiClock, close: FiX, creditCard: FiCreditCard,
  customer: FiUser, download: FiDownload, edit: FiEdit2, externalLink: FiExternalLink, file: FiFileText, filter: FiFilter,
  gift: FiGift, home: FiHome, inventory: FiBox, lock: FiLock, logout: FiLogOut, menu: FiMenu, more: FiMoreHorizontal,
  notification: FiBell, package: FiPackage, payment: FiCreditCard, people: FiUsers, phone: FiPhone, plus: FiPlus,
  receipt: FiFileText, refresh: FiRefreshCw, search: FiSearch, settings: FiSettings, shield: FiShield, staff: FiUsers,
  store: FiShoppingBag, tag: FiTag, transfer: FiSliders, trend: FiTrendingUp, user: FiUser, wallet: FiCreditCard,
};

export function Icon({ name, label, decorative = true }: { name: IconName; label?: string; decorative?: boolean }) {
  const Glyph = webIcons[name];
  return <Glyph aria-hidden={decorative ? true : undefined} aria-label={decorative ? undefined : label ?? iconLabels[name]} focusable={false} />;
}

export type ButtonVariant = "primary" | "secondary" | "danger" | "quiet";
export function Button({ variant = "primary", className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button {...props} className={`ns-button ns-button--${variant} ${className}`.trim()}>{children}</button>;
}

export function StatusBadge({ tone, children }: { tone: "info" | "success" | "warning" | "danger" | "neutral"; children: ReactNode }) {
  return <span className={`ns-status ns-status--${tone}`}><span aria-hidden="true" className="ns-status__dot" />{children}</span>;
}

export function StatePanel({ state, title, detail, onRetry }: { state: "loading" | "empty" | "error" | "forbidden" | "offline" | "partial"; title: string; detail?: string; onRetry?: () => void }) {
  const icon: Record<typeof state, IconName> = { loading: "activity", empty: "file", error: "alert", forbidden: "lock", offline: "alert", partial: "alert" };
  return <section className={`ns-state ns-state--${state}`} aria-busy={state === "loading"} role={state === "error" || state === "forbidden" || state === "offline" ? "alert" : "status"}>
    <Icon name={icon[state]} decorative />
    <div><h2>{title}</h2>{detail ? <p>{detail}</p> : null}{onRetry ? <Button variant="secondary" onClick={onRetry}><Icon name="refresh" />Retry</Button> : null}</div>
  </section>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <header className="ns-page-header"><div>{eyebrow ? <p className="ns-eyebrow">{eyebrow}</p> : null}<h1>{title}</h1>{description ? <p>{description}</p> : null}</div>{actions ? <div className="ns-page-header__actions">{actions}</div> : null}</header>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) { return <section className={`ns-card ${className}`.trim()}>{children}</section>; }

export function AppDialog({ title, description, trigger, children }: { title: string; description?: string; trigger: ReactNode; children: ReactNode }) {
  return <Dialog.Root><Dialog.Trigger asChild>{trigger}</Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="ns-dialog__overlay" /><Dialog.Content className="ns-dialog"><Dialog.Title>{title}</Dialog.Title>{description ? <Dialog.Description>{description}</Dialog.Description> : null}{children}<Dialog.Close asChild><Button variant="quiet" aria-label="Close dialog"><Icon name="close" /></Button></Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

export function ChartFallback({ title, description, rows, empty = false, loading = false }: { title: string; description?: string; rows: Array<{ label: string; value: string }>; empty?: boolean; loading?: boolean }) {
  const id = useId().replace(/:/g, "");
  const descriptionId = `${id}-chart-description`;
  const state = loading ? "loading" : empty || rows.length === 0 ? "empty" : "ready";
  return <section role="group" className="ns-chart" aria-label={`${title} (${state})`} aria-describedby={description ? descriptionId : undefined} aria-busy={loading}>
    <div><h3>{title}</h3>{description ? <p id={descriptionId}>{description}</p> : null}</div>
    {state === "loading" ? <div className="ns-skeleton" role="status" aria-label="Loading chart" /> : state === "empty" ? <p role="status">No chart data available.</p> : <>
      <div className="ns-chart__bars" aria-hidden="true">{rows.map((row, index) => <span key={row.label} style={{ height: `${Math.max(12, 100 - index * 12)}%` }} />)}</div>
      <table aria-label={title}><caption>{title}</caption><thead><tr><th scope="col">Label</th><th scope="col">Value</th></tr></thead><tbody>{rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.value}</td></tr>)}</tbody></table>
    </>}
  </section>;
}

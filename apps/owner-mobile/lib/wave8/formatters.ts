import type { Locale } from "@nailsoft/domain-types";

/** Formats an authoritative minor-unit amount without converting the amount to a JS Number. */
export function formatMinor(value: string | number | bigint | null | undefined, currency: string, locale: Locale) {
  if (value === null || value === undefined || value === "") return "\u2014";
  const raw = typeof value === "bigint" ? value.toString() : String(value);
  if (!/^[-]?\d+$/.test(raw)) return "\u2014";
  const minorDigits = ["VND", "JPY", "KRW"].includes(currency.toUpperCase()) ? 0 : 2;
  const amount = BigInt(raw);
  const negative = amount < 0n;
  const absolute = (negative ? -amount : amount).toString().padStart(minorDigits + 1, "0");
  const integerPart = minorDigits ? absolute.slice(0, -minorDigits) : absolute;
  const fractionPart = minorDigits ? absolute.slice(-minorDigits) : "";
  const groupedInteger = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(BigInt(integerPart));
  const numberText = minorDigits ? `${groupedInteger}.${fractionPart}` : groupedInteger;
  const parts = new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: minorDigits, maximumFractionDigits: minorDigits }).formatToParts(0);
  const currencyPart = parts.find((part) => part.type === "currency")?.value ?? currency;
  const formatted = locale === "vi-VN" ? `${numberText} ${currencyPart}` : `${currencyPart}${numberText}`;
  return negative ? `-${formatted}` : formatted;
}

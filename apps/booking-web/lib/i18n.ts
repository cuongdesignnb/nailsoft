import type { Locale } from "@nailsoft/localization";

export { locales } from "@nailsoft/localization";
export type { Locale } from "@nailsoft/localization";

const supportedLocales: readonly Locale[] = ["vi-VN", "en-US"];
const localeStorageKey = "nailsoft.booking.locale";

type BookingMessageKey =
  | "language"
  | "brandEyebrow"
  | "landingTitle"
  | "landingDescription"
  | "salonCode"
  | "salonCodePlaceholder"
  | "startBooking"
  | "manageBooking"
  | "manageBookingDescription"
  | "bookingUnavailable"
  | "loading"
  | "retry"
  | "back"
  | "next"
  | "workspace"
  | "salonTime"
  | "services"
  | "staff"
  | "continue"
  | "requiredSalonCode";

const messages: Record<Locale, Record<BookingMessageKey, string>> = {
  "vi-VN": {
    language: "Ngôn ngữ",
    brandEyebrow: "ĐẶT LỊCH TRỰC TUYẾN",
    landingTitle: "Thời gian làm đẹp dành riêng cho bạn.",
    landingDescription:
      "Xem giờ trống, dịch vụ và chính sách của salon trước khi xác nhận.",
    salonCode: "Mã salon",
    salonCodePlaceholder: "Nhập mã salon",
    startBooking: "Bắt đầu đặt lịch",
    manageBooking: "Quản lý lịch hẹn",
    manageBookingDescription:
      "Tra cứu, đổi lịch hoặc hủy lịch bằng mã đặt lịch và thông tin liên hệ.",
    bookingUnavailable: "Đặt lịch trực tuyến hiện không khả dụng.",
    loading: "Đang tải...",
    retry: "Thử lại",
    back: "Quay lại",
    next: "Tiếp tục",
    workspace: "Không gian salon",
    salonTime: "Giờ hiển thị theo giờ địa phương của salon",
    services: "Dịch vụ",
    staff: "Kỹ thuật viên",
    continue: "Tiếp tục",
    requiredSalonCode: "Vui lòng nhập mã salon.",
  },
  "en-US": {
    language: "Language",
    brandEyebrow: "ONLINE BOOKING",
    landingTitle: "Time reserved for you.",
    landingDescription:
      "See salon availability, services and policies before you confirm.",
    salonCode: "Salon code",
    salonCodePlaceholder: "Enter salon code",
    startBooking: "Start booking",
    manageBooking: "Manage booking",
    manageBookingDescription:
      "Look up, reschedule or cancel a booking with its reference and contact details.",
    bookingUnavailable: "Online booking is currently unavailable.",
    loading: "Loading...",
    retry: "Try again",
    back: "Back",
    next: "Continue",
    workspace: "Salon workspace",
    salonTime: "Times are shown in the salon's local timezone",
    services: "Services",
    staff: "Staff",
    continue: "Continue",
    requiredSalonCode: "Enter a salon code to continue.",
  },
};

export const getMessage = (locale: Locale, key: BookingMessageKey) =>
  messages[locale][key];

export const isLocale = (value: string | null | undefined): value is Locale =>
  Boolean(value && supportedLocales.includes(value as Locale));

export function resolveLocale(value?: string | null): Locale {
  if (isLocale(value)) return value;
  const language = value?.toLowerCase() ?? "";
  if (language.startsWith("en")) return "en-US";
  return "vi-VN";
}

export function getInitialLocale(): Locale {
  if (typeof window !== "undefined") {
    const saved = window.localStorage.getItem(localeStorageKey);
    if (isLocale(saved)) return saved;
    return resolveLocale(window.navigator.language);
  }
  return "vi-VN";
}

export function persistLocale(locale: Locale) {
  if (typeof window !== "undefined")
    window.localStorage.setItem(localeStorageKey, locale);
}

export function localizedValue(
  value: Record<string, string> | string | null | undefined,
  locale: Locale,
  fallback = "",
) {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  return value[locale] ?? value[locale === "vi-VN" ? "en-US" : "vi-VN"] ?? fallback;
}

export function formatSalonDateTime(
  value: string | Date,
  locale: Locale,
  timeZone: string,
) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

export function formatMinorAmount(
  amountMinor: string | number,
  currency: string,
  locale: Locale,
) {
  const divisor = currency === "VND" ? 1 : 100;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "VND" ? 0 : 2,
  }).format(Number(amountMinor) / divisor);
}

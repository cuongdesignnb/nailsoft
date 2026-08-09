import type { Locale } from "@nailsoft/localization";

export { locales } from "@nailsoft/localization";
export type { Locale } from "@nailsoft/localization";

const supportedLocales: readonly Locale[] = ["vi-VN", "en-US"];
const localeStorageKey = "nailsoft.booking.locale";

export type BookingMessageKey =
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
  | "service"
  | "duration"
  | "price"
  | "branch"
  | "branches"
  | "selectBranch"
  | "selectServices"
  | "selectStaff"
  | "anyStaff"
  | "staffNamesHidden"
  | "chooseTime"
  | "availableTimes"
  | "noAvailability"
  | "findAvailability"
  | "contact"
  | "displayName"
  | "phone"
  | "email"
  | "optional"
  | "sendCode"
  | "verificationCode"
  | "verificationHint"
  | "verify"
  | "review"
  | "policyConsent"
  | "marketingConsent"
  | "marketingConsentHint"
  | "confirmBooking"
  | "noPayment"
  | "bookingSuccess"
  | "bookingReference"
  | "bookAnother"
  | "cancelBooking"
  | "changeDetails"
  | "servicePackages"
  | "noActivePackage"
  | "reserveUnit"
  | "reservedUnit"
  | "sessionExpired"
  | "holdExpired"
  | "requiredSalonCode"
  | "requiredStaff"
  | "requiredPolicy"
  | "chooseAnotherTime"
  | "changeSelection"
  | "timezoneLabel"
  | "selectLanguage";

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
    loading: "Đang tải…",
    retry: "Thử lại",
    back: "Quay lại",
    next: "Tiếp tục",
    workspace: "Không gian salon",
    salonTime: "Giờ hiển thị theo múi giờ địa phương của salon",
    services: "Dịch vụ",
    service: "Dịch vụ",
    duration: "Thời lượng",
    price: "Giá",
    branch: "Chi nhánh",
    branches: "Chi nhánh",
    selectBranch: "Chọn chi nhánh",
    selectServices: "Chọn dịch vụ",
    selectStaff: "Chọn kỹ thuật viên",
    anyStaff: "Bất kỳ kỹ thuật viên phù hợp",
    staffNamesHidden: "Salon sẽ chọn kỹ thuật viên phù hợp cho bạn.",
    chooseTime: "Chọn thời gian",
    availableTimes: "Giờ còn trống",
    noAvailability: "Không còn giờ phù hợp với lựa chọn này.",
    findAvailability: "Tìm giờ trống",
    contact: "Thông tin liên hệ",
    displayName: "Họ và tên",
    phone: "Số điện thoại",
    email: "Email",
    optional: "không bắt buộc",
    sendCode: "Gửi mã xác minh",
    verificationCode: "Mã xác minh",
    verificationHint: "Nhập mã gồm 6 số. Mã có hiệu lực trong thời gian ngắn.",
    verify: "Xác minh",
    review: "Xem lại lịch hẹn",
    policyConsent: "Tôi đã đọc và đồng ý với chính sách đặt và hủy lịch",
    marketingConsent: "Tôi đồng ý nhận thông tin ưu đãi",
    marketingConsentHint: "Không bắt buộc và không ảnh hưởng đến việc đặt lịch.",
    confirmBooking: "Xác nhận đặt lịch",
    noPayment: "Không thu tiền trong quá trình đặt lịch trực tuyến.",
    bookingSuccess: "Đặt lịch thành công",
    bookingReference: "Mã lịch hẹn",
    bookAnother: "Đặt lịch khác",
    cancelBooking: "Hủy lịch hẹn",
    changeDetails: "Đổi thông tin",
    servicePackages: "Gói dịch vụ",
    noActivePackage: "Không có gói dịch vụ đang hoạt động cho khách hàng này.",
    reserveUnit: "Giữ một lượt",
    reservedUnit: "Đã giữ lượt",
    sessionExpired: "Phiên làm việc đã hết hạn. Vui lòng thử lại.",
    holdExpired: "Thời gian giữ chỗ đã hết. Vui lòng chọn lại giờ.",
    requiredSalonCode: "Vui lòng nhập mã salon.",
    requiredStaff: "Vui lòng chọn kỹ thuật viên cho chi nhánh này.",
    requiredPolicy: "Vui lòng đồng ý với chính sách để tiếp tục.",
    chooseAnotherTime: "Chọn giờ khác",
    changeSelection: "Đổi dịch vụ hoặc ngày",
    timezoneLabel: "Múi giờ",
    selectLanguage: "Chọn ngôn ngữ",
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
    loading: "Loading…",
    retry: "Try again",
    back: "Back",
    next: "Continue",
    workspace: "Salon workspace",
    salonTime: "Times are shown in the salon's local timezone",
    services: "Services",
    service: "Service",
    duration: "Duration",
    price: "Price",
    branch: "Branch",
    branches: "Branches",
    selectBranch: "Select a branch",
    selectServices: "Select services",
    selectStaff: "Select technician",
    anyStaff: "Any suitable technician",
    staffNamesHidden: "The salon will choose a suitable technician for you.",
    chooseTime: "Choose a time",
    availableTimes: "Available times",
    noAvailability: "No suitable times are available for this selection.",
    findAvailability: "Find available times",
    contact: "Contact details",
    displayName: "Full name",
    phone: "Phone",
    email: "Email",
    optional: "optional",
    sendCode: "Send verification code",
    verificationCode: "Verification code",
    verificationHint: "Enter the 6-digit code. The code expires shortly.",
    verify: "Verify",
    review: "Review booking",
    policyConsent: "I have read and agree to the booking and cancellation policy",
    marketingConsent: "I agree to receive offers",
    marketingConsentHint: "Optional and does not affect your booking.",
    confirmBooking: "Confirm booking",
    noPayment: "No payment is collected during online booking.",
    bookingSuccess: "Booking confirmed",
    bookingReference: "Booking reference",
    bookAnother: "Book another appointment",
    cancelBooking: "Cancel booking",
    changeDetails: "Change details",
    servicePackages: "Service packages",
    noActivePackage: "No active package covers this customer.",
    reserveUnit: "Reserve one unit",
    reservedUnit: "Reserved unit",
    sessionExpired: "Your session has expired. Please try again.",
    holdExpired: "Your slot hold expired. Please choose another time.",
    requiredSalonCode: "Enter a salon code to continue.",
    requiredStaff: "Select a technician for this branch.",
    requiredPolicy: "Accept the policy to continue.",
    chooseAnotherTime: "Choose another time",
    changeSelection: "Change services or date",
    timezoneLabel: "Timezone",
    selectLanguage: "Select language",
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
  return (
    value[locale] ?? value[locale === "vi-VN" ? "en-US" : "vi-VN"] ?? fallback
  );
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

export function formatSalonTime(
  value: string | Date,
  locale: Locale,
  timeZone: string,
) {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
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

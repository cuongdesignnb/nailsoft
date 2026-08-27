import type { Locale } from "@nailsoft/localization";

export { locales } from "@nailsoft/localization";
export type { Locale } from "@nailsoft/localization";

const supportedLocales: readonly Locale[] = ["vi-VN", "en-US"];
const localeStorageKey = "nailsoft.booking.locale";

export type BookingMessageKey =
  | "language"
  | "bookingManagement"
  | "lookupIntro"
  | "secureLookup"
  | "secureLookupHint"
  | "bookingDetails"
  | "bookingContact"
  | "bookingActions"
  | "bookingPolicy"
  | "rescheduleIntro"
  | "cancelIntro"
  | "packageHint"
  | "offline"
  | "internetRequired"
  | "neutralResponse"
  | "noServiceToReschedule"
  | "noContinuousTime"
  | "newTimeConfirmed"
  | "bookingCancelledNotice"
  | "packageUnit"
  | "holdExpires"
  | "bookingChanged"
  | "brandEyebrow"
  | "landingTitle"
  | "landingDescription"
  | "landingLead"
  | "landingTrustFast"
  | "landingTrustSafe"
  | "landingTrustManage"
  | "landingEntryTitle"
  | "landingEntryHint"
  | "landingManageEyebrow"
  | "landingManageTitle"
  | "landingManageHint"
  | "landingVisualEyebrow"
  | "landingVisualTitle"
  | "landingVisualHint"
  | "landingNeedHelp"
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
  | "minutes"
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
  | "contactIntro"
  | "contactDetails"
  | "contactDetailsHint"
  | "verificationChannelHint"
  | "privacyTitle"
  | "privacyHint"
  | "displayName"
  | "phone"
  | "email"
  | "optional"
  | "sendCode"
  | "contactRequired"
  | "verificationCode"
  | "verificationTitle"
  | "verificationSentTo"
  | "verificationHint"
  | "verificationExpires"
  | "verificationExpired"
  | "verificationExpiredHint"
  | "changeContact"
  | "verificationPrivacyTitle"
  | "verificationPrivacyHint"
  | "requestNewCode"
  | "verify"
  | "review"
  | "reviewTitle"
  | "reviewHint"
  | "reviewPrivacyHint"
  | "policyConsent"
  | "marketingConsent"
  | "marketingConsentHint"
  | "confirmBooking"
  | "noPayment"
  | "bookingSuccess"
  | "bookingSuccessHint"
  | "bookingReference"
  | "status"
  | "bookingSummary"
  | "afterVerification"
  | "holdActive"
  | "holdHint"
  | "summaryUpdates"
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

const bookingStatusLabels: Record<Locale, Record<string, string>> = {
  "vi-VN": {
    PENDING: "Đang chờ xác nhận",
    PENDING_CONFIRMATION: "Đang chờ xác nhận",
    CONFIRMED: "Đã xác nhận",
    CHECKED_IN: "Đã check-in",
    IN_SERVICE: "Đang phục vụ",
    COMPLETED: "Đã hoàn tất",
    CANCELLED: "Đã hủy",
    CANCELLED_BY_CUSTOMER: "Khách đã hủy",
    CANCELLED_BY_SALON: "Salon đã hủy",
    NO_SHOW: "Không đến",
  },
  "en-US": {
    PENDING: "Pending confirmation",
    PENDING_CONFIRMATION: "Pending confirmation",
    CONFIRMED: "Confirmed",
    CHECKED_IN: "Checked in",
    IN_SERVICE: "In service",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
    CANCELLED_BY_CUSTOMER: "Cancelled by customer",
    CANCELLED_BY_SALON: "Cancelled by salon",
    NO_SHOW: "No-show",
  },
};

export function bookingStatusLabel(value: unknown, locale: Locale) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized) return "—";
  return bookingStatusLabels[locale][normalized] ?? normalized.replaceAll("_", " ");
}

export function formatBookingDate(value: unknown, locale: Locale) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

const messages: Record<Locale, Record<BookingMessageKey, string>> = {
  "vi-VN": {
    language: "Ngôn ngữ",
    bookingManagement: "QUẢN LÝ ĐẶT LỊCH",
    lookupIntro: "Tra cứu lịch hẹn bằng mã lịch và thông tin liên hệ đã dùng khi đặt.",
    secureLookup: "Tra cứu riêng tư",
    secureLookupHint: "Salon chỉ hiển thị chi tiết sau khi mã xác minh được kiểm tra.",
    bookingDetails: "Chi tiết lịch hẹn",
    bookingContact: "Thông tin người đặt",
    bookingActions: "Thao tác lịch hẹn",
    bookingPolicy: "Chính sách và bảo mật",
    rescheduleIntro: "Chọn một khung giờ khác đang còn trống. Lịch cũ chỉ được giải phóng sau khi bạn xác nhận.",
    cancelIntro: "Lịch hẹn vẫn được lưu trong lịch sử sau khi hủy theo chính sách của salon.",
    packageHint: "Nếu khách hàng có gói dịch vụ phù hợp, bạn có thể giữ một lượt cho lịch hẹn này.",
    offline: "Ngoại tuyến",
    internetRequired: "Cần kết nối internet để thay đổi lịch hẹn.",
    neutralResponse: "Thông tin phản hồi sẽ giữ ở trạng thái trung lập cho đến khi xác minh.",
    noServiceToReschedule: "Không có dịch vụ nào để đổi lịch.",
    noContinuousTime: "Không có khung giờ liên tục phù hợp với dịch vụ đã chọn.",
    newTimeConfirmed: "Thời gian mới đã được xác nhận. Lịch cũ chỉ được giải phóng sau khi xác nhận thành công.",
    bookingCancelledNotice: "Lịch hẹn đã được hủy và vẫn được lưu trong lịch sử đặt lịch.",
    packageUnit: "lượt",
    holdExpires: "Giữ chỗ hết hạn lúc",
    bookingChanged: "Lịch hẹn đã thay đổi từ lúc bạn mở. Vui lòng tải lại chi tiết lịch hẹn.",
    brandEyebrow: "ĐẶT LỊCH TRỰC TUYẾN",
    landingTitle: "Thời gian làm đẹp dành riêng cho bạn.",
    landingDescription:
      "Xem giờ trống, dịch vụ và chính sách của salon trước khi xác nhận.",
    landingLead:
      "Một trải nghiệm đặt lịch nhẹ nhàng, rõ ràng và riêng tư — từ lựa chọn đầu tiên đến khi bạn bước vào salon.",
    landingTrustFast: "Đặt lịch nhanh",
    landingTrustSafe: "Xác nhận an toàn",
    landingTrustManage: "Dễ dàng đổi lịch",
    landingEntryTitle: "Bắt đầu từ salon bạn yêu thích",
    landingEntryHint:
      "Nhập mã salon được chia sẻ trong tin nhắn hoặc đường dẫn đặt lịch của bạn.",
    landingManageEyebrow: "Đã có lịch hẹn?",
    landingManageTitle: "Quản lý lịch hẹn thật dễ dàng",
    landingManageHint:
      "Tra cứu, đổi lịch hoặc hủy lịch bằng mã đặt lịch và thông tin liên hệ.",
    landingVisualEyebrow: "MỘT KHOẢNG THỜI GIAN CHO BẠN",
    landingVisualTitle: "Chọn điều khiến bạn thấy đẹp hơn hôm nay.",
    landingVisualHint:
      "Dịch vụ, kỹ thuật viên và khung giờ đều được hiển thị theo dữ liệu thực của salon.",
    landingNeedHelp: "Cần hỗ trợ? Hãy liên hệ trực tiếp với salon.",
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
    minutes: "phút",
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
    contactIntro: "Để salon xác nhận lịch hẹn, hãy để lại thông tin liên hệ của bạn.",
    contactDetails: "Thông tin của bạn",
    contactDetailsHint: "Chỉ dùng cho lịch hẹn này và bước xác minh an toàn.",
    verificationChannelHint: "Bạn sẽ nhận mã xác minh qua số điện thoại này.",
    privacyTitle: "Thông tin được bảo vệ",
    privacyHint: " Chúng tôi chỉ dùng thông tin này để xác minh và quản lý lịch hẹn.",
    displayName: "Họ và tên",
    phone: "Số điện thoại",
    email: "Email",
    optional: "không bắt buộc",
    sendCode: "Gửi mã xác minh",
    contactRequired: "Vui lòng nhập số điện thoại hoặc email để nhận mã xác minh.",
    verificationCode: "Mã xác minh",
    verificationTitle: "Xác minh thông tin liên hệ",
    verificationSentTo: "Mã xác minh đã được gửi tới",
    verificationHint: "Nhập mã gồm 6 số. Mã có hiệu lực trong thời gian ngắn.",
    verificationExpires: "Mã còn hiệu lực",
    verificationExpired: "Mã xác minh đã hết hạn. Hãy yêu cầu mã mới để tiếp tục.",
    verificationExpiredHint: "Bạn có thể quay lại chỉnh sửa thông tin hoặc nhận một mã mới.",
    changeContact: "Đổi thông tin",
    verificationPrivacyTitle: "Xác minh một lần",
    verificationPrivacyHint: " Mã này chỉ dùng để hoàn tất lịch hẹn hiện tại.",
    requestNewCode: "Gửi mã mới",
    verify: "Xác minh",
    review: "Xem lại lịch hẹn",
    reviewTitle: "Mọi thứ đã sẵn sàng",
    reviewHint: "Kiểm tra lại thông tin trước khi gửi yêu cầu đặt lịch tới salon.",
    reviewPrivacyHint: " Bạn sẽ không bị thu tiền trong bước này.",
    policyConsent: "Tôi đã đọc và đồng ý với chính sách đặt và hủy lịch",
    marketingConsent: "Tôi đồng ý nhận thông tin ưu đãi",
    marketingConsentHint: "Không bắt buộc và không ảnh hưởng đến việc đặt lịch.",
    confirmBooking: "Xác nhận đặt lịch",
    noPayment: "Không thu tiền trong quá trình đặt lịch trực tuyến.",
    bookingSuccess: "Đặt lịch thành công",
    bookingSuccessHint: "Lịch hẹn của bạn đã được ghi nhận. Bạn có thể quản lý hoặc thay đổi lịch bất cứ lúc nào theo chính sách của salon.",
    bookingReference: "Mã lịch hẹn",
    status: "Trạng thái",
    bookingSummary: "Tóm tắt lịch hẹn",
    afterVerification: "Sau khi xác minh",
    holdActive: "Khung giờ đang được giữ",
    holdHint: "hoàn tất trước khi hết thời gian giữ chỗ",
    summaryUpdates: "Thông tin này được lấy từ dữ liệu đặt lịch hiện tại của salon.",
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
    bookingManagement: "BOOKING MANAGEMENT",
    lookupIntro: "Look up a booking with its reference and the contact details used at booking.",
    secureLookup: "Private lookup",
    secureLookupHint: "The salon shows booking details only after the verification code is checked.",
    bookingDetails: "Booking details",
    bookingContact: "Booking contact",
    bookingActions: "Booking actions",
    bookingPolicy: "Policy and privacy",
    rescheduleIntro: "Choose another available time. The current time is released only after confirmation.",
    cancelIntro: "The booking remains in history after cancellation according to salon policy.",
    packageHint: "If the customer has an eligible service package, you can reserve one unit for this booking.",
    offline: "Offline",
    internetRequired: "An internet connection is required for booking changes.",
    neutralResponse: "Responses remain neutral until verification.",
    noServiceToReschedule: "No service is available to reschedule.",
    noContinuousTime: "No continuous time is available for the selected service.",
    newTimeConfirmed: "Your new time is confirmed. The previous slot was released only after confirmation.",
    bookingCancelledNotice: "Your booking was cancelled and remains in booking history.",
    packageUnit: "unit",
    holdExpires: "Hold expires",
    bookingChanged: "This booking changed since you opened it. Reload booking details.",
    brandEyebrow: "ONLINE BOOKING",
    landingTitle: "Time reserved for you.",
    landingDescription:
      "See salon availability, services and policies before you confirm.",
    landingLead:
      "A calm, clear and private booking experience — from your first choice to the moment you arrive at the salon.",
    landingTrustFast: "Quick booking",
    landingTrustSafe: "Secure confirmation",
    landingTrustManage: "Easy rescheduling",
    landingEntryTitle: "Start with your salon",
    landingEntryHint:
      "Enter the salon code shared in your booking message or salon link.",
    landingManageEyebrow: "ALREADY HAVE A BOOKING?",
    landingManageTitle: "Manage your appointment with ease",
    landingManageHint:
      "Look up, reschedule or cancel using your booking reference and contact details.",
    landingVisualEyebrow: "A LITTLE TIME FOR YOU",
    landingVisualTitle: "Choose what helps you feel beautiful today.",
    landingVisualHint:
      "Services, technicians and available times come from the salon's live booking data.",
    landingNeedHelp: "Need help? Please contact your salon directly.",
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
    minutes: "min",
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
    contactIntro: "Leave your contact details so the salon can confirm your appointment.",
    contactDetails: "Your details",
    contactDetailsHint: "Used for this booking and its secure verification step.",
    verificationChannelHint: "A verification code will be sent to this phone number.",
    privacyTitle: "Your details stay protected",
    privacyHint: " We only use them to verify and manage this booking.",
    displayName: "Full name",
    phone: "Phone",
    email: "Email",
    optional: "optional",
    sendCode: "Send verification code",
    contactRequired: "Enter a phone number or email to receive a verification code.",
    verificationCode: "Verification code",
    verificationTitle: "Verify your contact details",
    verificationSentTo: "A verification code was sent to",
    verificationHint: "Enter the 6-digit code. The code expires shortly.",
    verificationExpires: "Code valid for",
    verificationExpired: "This verification code has expired. Request a new code to continue.",
    verificationExpiredHint: "You can go back to edit your details or request a fresh code.",
    changeContact: "Change details",
    verificationPrivacyTitle: "One-time verification",
    verificationPrivacyHint: " This code only completes the current appointment request.",
    requestNewCode: "Send a new code",
    verify: "Verify",
    review: "Review booking",
    reviewTitle: "Everything looks ready",
    reviewHint: "Review the details before sending your booking request to the salon.",
    reviewPrivacyHint: " You will not be charged at this step.",
    policyConsent: "I have read and agree to the booking and cancellation policy",
    marketingConsent: "I agree to receive offers",
    marketingConsentHint: "Optional and does not affect your booking.",
    confirmBooking: "Confirm booking",
    noPayment: "No payment is collected during online booking.",
    bookingSuccess: "Booking confirmed",
    bookingSuccessHint: "Your appointment request has been recorded. You can manage or change it later according to the salon policy.",
    bookingReference: "Booking reference",
    status: "Status",
    bookingSummary: "Booking summary",
    afterVerification: "After verification",
    holdActive: "Your time is held",
    holdHint: "finish before the hold expires",
    summaryUpdates: "These details come from the salon's live booking data.",
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

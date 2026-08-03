/** Semantic icon names shared between Feather renderers on Web and Mobile. */
export const iconNames = [
  "activity", "alert", "archive", "arrowLeft", "arrowRight", "calendar", "camera", "chart", "check",
  "chevronDown", "chevronLeft", "chevronRight", "clock", "close", "creditCard", "customer", "download",
  "edit", "externalLink", "file", "filter", "gift", "home", "inventory", "lock", "logout", "menu",
  "more", "notification", "package", "payment", "people", "phone", "plus", "receipt", "refresh",
  "search", "settings", "shield", "staff", "store", "tag", "transfer", "trend", "user", "wallet",
] as const;

export type IconName = (typeof iconNames)[number];

export const iconLabels: Record<IconName, string> = {
  activity: "Activity", alert: "Alert", archive: "Archive", arrowLeft: "Back", arrowRight: "Next", calendar: "Calendar",
  camera: "Camera", chart: "Analytics", check: "Complete", chevronDown: "Expand", chevronLeft: "Previous", chevronRight: "Next",
  clock: "Time", close: "Close", creditCard: "Payment", customer: "Customer", download: "Download", edit: "Edit",
  externalLink: "Open", file: "Document", filter: "Filter", gift: "Gift", home: "Home", inventory: "Inventory", lock: "Security",
  logout: "Sign out", menu: "Menu", more: "More", notification: "Notifications", package: "Package", payment: "Payment",
  people: "People", phone: "Phone", plus: "Add", receipt: "Receipt", refresh: "Refresh", search: "Search", settings: "Settings",
  shield: "Access", staff: "Staff", store: "Branch", tag: "Tag", transfer: "Transfer", trend: "Trend", user: "Profile",
  wallet: "Wallet",
};

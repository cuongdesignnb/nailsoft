const blockedKeys = /password|secret|token|hash|provider|routing|bankaccount|bank_account|internalnote|private|credential|encryption/i;
const allowedKeys = new Set(["id", "status", "state", "name", "displayName", "code", "bookingReference", "branchId", "currency", "version", "createdAt", "updatedAt", "startAt", "endAt", "totalMinor", "requestedMinor", "completedMinor", "amountMinor", "count", "message", "title", "description", "reason", "vendorName", "vendorId", "poNumber", "invoiceNumber", "freshnessStatus"]);

export function safeKey(key: string) {
  return allowedKeys.has(key) && !blockedKeys.test(key);
}

export function safeRecord(input: unknown): Record<string, string | number | boolean | null> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!safeKey(key)) continue;
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") output[key] = value;
  }
  return output;
}

export function displayRecordValue(record: Record<string, string | number | boolean | null>) {
  return record.displayName ?? record.name ?? record.bookingReference ?? record.title ?? record.code ?? record.status ?? "Record";
}

const blocked = /password|secret|token|hash|provider|routing|bank|credential|encryption|internalnote|private|customerid|accountid/i;
const allowed = new Set(["id", "status", "state", "name", "displayName", "code", "bookingReference", "branchName", "serviceName", "currency", "version", "createdAt", "updatedAt", "startAt", "endAt", "scheduledStartAt", "serverNow", "totalMinor", "amountMinor", "requestedMinor", "completedMinor", "count", "title", "description", "reason", "customerDisplayName", "assignedStaffName", "freshnessStatus"]);

export function safeStaffRecord(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {} as Record<string, string | number | boolean | null>;
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key) || blocked.test(key)) continue;
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") output[key] = value;
  }
  return output;
}

export function safeStaffDisplay(record: Record<string, string | number | boolean | null>) {
  return record.displayName ?? record.customerDisplayName ?? record.name ?? record.bookingReference ?? record.title ?? record.code ?? record.status ?? "Record";
}

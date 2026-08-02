import { BadRequestException } from "@nestjs/common";

export type ComparisonMode = "NONE" | "PREVIOUS_PERIOD" | "PREVIOUS_YEAR" | "CUSTOM_RANGE";
export type FreshnessStatus = "FRESH" | "DELAYED" | "STALE" | "REBUILDING" | "DEGRADED";

export interface AnalyticsFilters {
  from: string;
  to: string;
  branchIds: string[];
  staffId?: string;
  serviceId?: string;
  comparisonMode: ComparisonMode;
  comparisonFrom?: string;
  comparisonTo?: string;
  granularity: "DAY" | "WEEK" | "MONTH";
  currency?: string;
}

export const parseFilters = (query: Record<string, unknown> = {}, now = new Date()): AnalyticsFilters => {
  const to = String(query.to ?? now.toISOString().slice(0, 10));
  const fallback = new Date(`${to}T00:00:00Z`);
  fallback.setUTCDate(fallback.getUTCDate() - 29);
  const from = String(query.from ?? fallback.toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to)
    throw new BadRequestException({ code: "ANALYTICS_DATE_RANGE_INVALID" });
  const fromDate = new Date(`${from}T00:00:00Z`), toDate = new Date(`${to}T00:00:00Z`);
  const days = Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
  if (days > 366) throw new BadRequestException({ code: "ANALYTICS_DATE_RANGE_TOO_LARGE" });
  const rawBranches = query.branchIds ?? query.branchId;
  const branchIds = Array.isArray(rawBranches) ? rawBranches.map(String) : rawBranches ? [String(rawBranches)] : [];
  const mode = String(query.comparisonMode ?? "NONE").toUpperCase() as ComparisonMode;
  if (!["NONE", "PREVIOUS_PERIOD", "PREVIOUS_YEAR", "CUSTOM_RANGE"].includes(mode)) throw new BadRequestException({ code: "ANALYTICS_COMPARISON_INVALID" });
  const result: AnalyticsFilters = { from, to, branchIds, comparisonMode: mode, granularity: (String(query.granularity ?? "DAY").toUpperCase() as AnalyticsFilters["granularity"]) };
  if (query.staffId) result.staffId = String(query.staffId);
  if (query.serviceId) result.serviceId = String(query.serviceId);
  if (query.comparisonFrom) result.comparisonFrom = String(query.comparisonFrom);
  if (query.comparisonTo) result.comparisonTo = String(query.comparisonTo);
  if (query.currency) result.currency = String(query.currency).toUpperCase();
  return result;
};

export const signedMinor = (value: unknown): bigint => {
  if (typeof value === "bigint") return value;
  const text = String(value ?? "0");
  if (!/^-?\d+$/.test(text)) throw new BadRequestException({ code: "ANALYTICS_MONEY_INVALID" });
  return BigInt(text);
};

export const safePercentage = (current: bigint | number, comparison: bigint | number) => {
  const c = BigInt(current), p = BigInt(comparison);
  if (p === 0n) return { value: null as number | null, state: "ZERO_BASELINE" as const };
  const basisPoints = ((c - p) * 10_000n) / (p < 0n ? -p : p);
  return { value: Number(basisPoints) / 100, state: "CALCULATED" as const };
};

export const comparison = (current: bigint, previous: bigint, mode: ComparisonMode) => ({
  current: current.toString(), comparison: previous.toString(), absoluteChange: (current - previous).toString(),
  percentageChange: mode === "NONE" ? null : safePercentage(current, previous).value,
  comparisonMode: mode, comparisonState: mode === "NONE" ? "NOT_REQUESTED" : safePercentage(current, previous).state,
});

export const freshness = (lastRefresh: Date | string | null, now = new Date(), rebuilding = false, degraded = false) => {
  if (rebuilding) return { status: "REBUILDING" as FreshnessStatus, lagSeconds: null };
  if (degraded) return { status: "DEGRADED" as FreshnessStatus, lagSeconds: null };
  if (!lastRefresh) return { status: "STALE" as FreshnessStatus, lagSeconds: null };
  const lagSeconds = Math.max(0, Math.floor((now.getTime() - new Date(lastRefresh).getTime()) / 1000));
  return { status: lagSeconds <= 300 ? "FRESH" as FreshnessStatus : lagSeconds <= 1800 ? "DELAYED" as FreshnessStatus : "STALE" as FreshnessStatus, lagSeconds };
};

export const businessDate = (instant: Date | string, timezone: string) => {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
  return date;
};

export const metricVersion = 1;

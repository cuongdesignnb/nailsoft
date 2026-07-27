export type CommissionRule = {
  id: string;
  branchId?: string | null;
  staffId?: string | null;
  serviceId?: string | null;
  priority: number;
  ruleType: "SERVICE_PERCENT" | "SERVICE_FIXED";
  percentBasisPoints?: number | null;
  fixedMinor?: number | null;
};

export function resolveCommissionRule(
  rules: readonly CommissionRule[],
  input: { branchId: string; staffId: string; serviceId: string },
) {
  const candidates = rules.filter(
    (rule) =>
      (!rule.branchId || rule.branchId === input.branchId) &&
      (!rule.staffId || rule.staffId === input.staffId) &&
      (!rule.serviceId || rule.serviceId === input.serviceId),
  );
  const specificity = (rule: CommissionRule) =>
    Number(Boolean(rule.staffId)) * 4 +
    Number(Boolean(rule.serviceId)) * 2 +
    Number(Boolean(rule.branchId));
  return (
    candidates.sort(
      (a, b) =>
        specificity(b) - specificity(a) ||
        b.priority - a.priority ||
        a.id.localeCompare(b.id),
    )[0] ?? null
  );
}

export function calculateCommissionMinor(
  rule: CommissionRule,
  baseMinor: number,
) {
  if (!Number.isSafeInteger(baseMinor) || baseMinor < 0)
    throw new Error("Invalid commission base");
  if (rule.ruleType === "SERVICE_FIXED") return rule.fixedMinor ?? 0;
  return Number(
    (BigInt(baseMinor) * BigInt(rule.percentBasisPoints ?? 0) + 5000n) / 10000n,
  );
}

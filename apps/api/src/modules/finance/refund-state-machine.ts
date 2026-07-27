export type RefundStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "UNKNOWN"
  | "REJECTED"
  | "CANCELLED";

const transitions: Record<RefundStatus, readonly RefundStatus[]> = {
  DRAFT: ["PENDING_APPROVAL", "APPROVED", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["PROCESSING", "COMPLETED", "CANCELLED"],
  PROCESSING: ["COMPLETED", "FAILED", "UNKNOWN"],
  UNKNOWN: ["PROCESSING", "COMPLETED", "FAILED"],
  FAILED: ["PROCESSING"],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
};

export function canTransitionRefund(from: RefundStatus, to: RefundStatus) {
  return transitions[from].includes(to);
}

export function assertRefundTransition(from: RefundStatus, to: RefundStatus) {
  if (!canTransitionRefund(from, to)) {
    const error = new Error(`Refund cannot transition from ${from} to ${to}`);
    Object.assign(error, { code: "REFUND_STATUS_INVALID" });
    throw error;
  }
}

export function prorateMinor(
  total: number,
  weights: readonly { key: string; amount: number }[],
) {
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    weights.some((x) => !Number.isSafeInteger(x.amount) || x.amount < 0)
  )
    throw new Error("Money must use non-negative safe integer minor units");
  const denominator = weights.reduce((sum, x) => sum + x.amount, 0);
  if (denominator === 0) return weights.map((x) => ({ key: x.key, amount: 0 }));
  const rows = weights.map((x) => {
    const exact = BigInt(total) * BigInt(x.amount);
    return {
      key: x.key,
      amount: Number(exact / BigInt(denominator)),
      remainder: exact % BigInt(denominator),
    };
  });
  let remainder = total - rows.reduce((sum, x) => sum + x.amount, 0);
  for (const row of [...rows].sort((a, b) =>
    a.remainder === b.remainder
      ? a.key.localeCompare(b.key)
      : a.remainder > b.remainder
        ? -1
        : 1,
  )) {
    if (remainder-- <= 0) break;
    row.amount += 1;
  }
  return rows.map(({ key, amount }) => ({ key, amount }));
}

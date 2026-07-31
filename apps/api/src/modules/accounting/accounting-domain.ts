export type JournalState = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "POSTED" | "REJECTED";

export const JOURNAL_TRANSITIONS: Record<JournalState, JournalState[]> = {
  DRAFT: ["PENDING_APPROVAL", "REJECTED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED"],
  APPROVED: ["POSTED"],
  POSTED: [],
  REJECTED: [],
};

export function isBalanced(lines: ReadonlyArray<{ debitMinor?: number | bigint; creditMinor?: number | bigint }>) {
  if (lines.length < 2) return false;
  const debit = lines.reduce((sum, line) => sum + BigInt(line.debitMinor ?? 0), 0n);
  const credit = lines.reduce((sum, line) => sum + BigInt(line.creditMinor ?? 0), 0n);
  return debit > 0n && debit === credit;
}

export function canTransition(from: JournalState, to: JournalState) {
  return JOURNAL_TRANSITIONS[from]?.includes(to) ?? false;
}

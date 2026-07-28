import { ConflictException, Injectable } from "@nestjs/common";

export type RoundingMode = "HALF_UP" | "HALF_EVEN";
export type TaxMode = "EXCLUSIVE" | "INCLUSIVE" | "NONE";

export interface PricingLineInput {
  id: string;
  grossMinor: bigint;
  lineDiscountMinor: bigint;
  taxMode: TaxMode;
  rateBasisPoints: number;
  roundingMode: RoundingMode;
  discountEligible?: boolean;
}

export interface PricingLineResult {
  id: string;
  grossMinor: bigint;
  discountMinor: bigint;
  taxableMinor: bigint;
  taxMinor: bigint;
  netMinor: bigint;
}

@Injectable()
export class PosPricingService {
  assertMoney(value: unknown, code = "POS_ORDER_TOTAL_INVALID"): bigint {
    if (
      (typeof value !== "number" &&
        typeof value !== "bigint" &&
        typeof value !== "string") ||
      !/^[0-9]+$/.test(String(value))
    )
      throw new ConflictException({
        code,
        message: "Money must be a non-negative integer minor-unit amount",
      });
    const amount = BigInt(value);
    if (amount > BigInt(Number.MAX_SAFE_INTEGER))
      throw new ConflictException({
        code,
        message: "Money exceeds the supported safe API range",
      });
    return amount;
  }

  calculate(
    lines: PricingLineInput[],
    orderDiscountMinor: bigint,
    tipMinor: bigint,
    amountPaidMinor: bigint,
  ) {
    if (!lines.length)
      throw new ConflictException({
        code: "POS_ORDER_TOTAL_INVALID",
        message: "At least one active line is required",
      });
    const subtotalMinor = sum(lines.map((line) => line.grossMinor));
    const lineDiscountTotal = sum(lines.map((line) => line.lineDiscountMinor));
    if (lineDiscountTotal > subtotalMinor || orderDiscountMinor < 0n)
      throw new ConflictException({
        code: "DISCOUNT_EXCEEDS_AMOUNT",
        message: "Discount exceeds eligible amount",
      });
    const eligible = lines
      .filter((line) => line.discountEligible !== false)
      .map((line) => ({
        id: line.id,
        amount: line.grossMinor - line.lineDiscountMinor,
      }));
    const orderAllocations = allocateProRata(orderDiscountMinor, eligible);
    const results = lines.map((line): PricingLineResult => {
      const discountMinor =
        line.lineDiscountMinor + (orderAllocations.get(line.id) ?? 0n);
      if (discountMinor > line.grossMinor)
        throw new ConflictException({
          code: "DISCOUNT_EXCEEDS_AMOUNT",
          message: "Discount exceeds line amount",
        });
      const discounted = line.grossMinor - discountMinor;
      if (line.taxMode === "NONE")
        return {
          id: line.id,
          grossMinor: line.grossMinor,
          discountMinor,
          taxableMinor: 0n,
          taxMinor: 0n,
          netMinor: discounted,
        };
      if (line.taxMode === "EXCLUSIVE") {
        const taxMinor = roundRatio(
          discounted * BigInt(line.rateBasisPoints),
          10000n,
          line.roundingMode,
        );
        return {
          id: line.id,
          grossMinor: line.grossMinor,
          discountMinor,
          taxableMinor: discounted,
          taxMinor,
          netMinor: discounted + taxMinor,
        };
      }
      const base = roundRatio(
        discounted * 10000n,
        10000n + BigInt(line.rateBasisPoints),
        line.roundingMode,
      );
      return {
        id: line.id,
        grossMinor: line.grossMinor,
        discountMinor,
        taxableMinor: base,
        taxMinor: discounted - base,
        netMinor: discounted,
      };
    });
    const discountMinor = sum(results.map((line) => line.discountMinor));
    const taxableMinor = sum(results.map((line) => line.taxableMinor));
    const taxMinor = sum(results.map((line) => line.taxMinor));
    const totalMinor = sum(results.map((line) => line.netMinor));
    const grandTotalMinor = totalMinor + tipMinor;
    if (
      tipMinor < 0n ||
      amountPaidMinor < 0n ||
      amountPaidMinor > grandTotalMinor
    )
      throw new ConflictException({
        code: "POS_ORDER_TOTAL_INVALID",
        message: "Paid or tip amount violates order totals",
      });
    return {
      lines: results,
      subtotalMinor,
      discountMinor,
      taxableMinor,
      taxMinor,
      totalMinor,
      tipMinor,
      grandTotalMinor,
      amountPaidMinor,
      amountDueMinor: grandTotalMinor - amountPaidMinor,
    };
  }

  discountAmount(
    type: "FIXED" | "PERCENT",
    value: number,
    eligibleMinor: bigint,
  ) {
    if (value < 0 || !Number.isFinite(value))
      throw new ConflictException({
        code: "DISCOUNT_INVALID",
        message: "Discount is invalid",
      });
    const amount =
      type === "FIXED"
        ? this.assertMoney(value, "DISCOUNT_INVALID")
        : roundRatio(
            eligibleMinor * BigInt(Math.trunc(value)),
            10000n,
            "HALF_UP",
          );
    if (type === "PERCENT" && value > 10000)
      throw new ConflictException({
        code: "DISCOUNT_INVALID",
        message: "Percent basis points must be between 0 and 10000",
      });
    if (amount > eligibleMinor)
      throw new ConflictException({
        code: "DISCOUNT_EXCEEDS_AMOUNT",
        message: "Discount exceeds eligible amount",
      });
    return amount;
  }

  allocateTip(
    total: bigint,
    basis: "MANUAL" | "EQUAL" | "WORK_SECONDS",
    rows: Array<{
      staffId: string;
      appointmentItemId?: string;
      amountMinor?: bigint;
      workSeconds?: number;
    }>,
  ) {
    const unique = new Set(
      rows.map((row) => `${row.staffId}:${row.appointmentItemId ?? ""}`),
    );
    if (!rows.length || unique.size !== rows.length)
      throw new ConflictException({
        code: "TIP_ALLOCATION_INVALID",
        message: "Tip recipients must be unique and non-empty",
      });
    if (basis === "MANUAL") {
      const allocated = sum(rows.map((row) => row.amountMinor ?? -1n));
      if (allocated !== total)
        throw new ConflictException({
          code: "TIP_ALLOCATION_TOTAL_MISMATCH",
          message: "Tip allocations must equal tip amount",
        });
      return rows.map((row) => ({ ...row, amountMinor: row.amountMinor! }));
    }
    const weights = rows.map((row) => ({
      id: `${row.staffId}:${row.appointmentItemId ?? ""}`,
      amount: BigInt(
        basis === "EQUAL" ? 1 : Math.max(0, Math.trunc(row.workSeconds ?? 0)),
      ),
    }));
    if (weights.every((row) => row.amount === 0n))
      throw new ConflictException({
        code: "TIP_ALLOCATION_INVALID",
        message: "Positive contribution is required",
      });
    const allocations = allocateProRata(total, weights);
    return rows.map((row) => ({
      ...row,
      amountMinor:
        allocations.get(`${row.staffId}:${row.appointmentItemId ?? ""}`) ?? 0n,
    }));
  }
}

export function roundRatio(
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode,
): bigint {
  if (denominator <= 0n || numerator < 0n)
    throw new Error("Invalid rounding ratio");
  const whole = numerator / denominator;
  const remainder = numerator % denominator;
  const doubled = remainder * 2n;
  if (doubled > denominator) return whole + 1n;
  if (doubled < denominator) return whole;
  return mode === "HALF_UP" || whole % 2n === 1n ? whole + 1n : whole;
}

export function allocateProRata(
  total: bigint,
  rows: Array<{ id: string; amount: bigint }>,
) {
  if (total < 0n || rows.some((row) => row.amount < 0n))
    throw new Error("Invalid allocation");
  const eligible = sum(rows.map((row) => row.amount));
  const result = new Map<string, bigint>();
  if (total === 0n) {
    rows.forEach((row) => result.set(row.id, 0n));
    return result;
  }
  if (eligible === 0n)
    throw new ConflictException({
      code: "DISCOUNT_EXCEEDS_AMOUNT",
      message: "No eligible amount",
    });
  let assigned = 0n;
  const ranked = rows
    .map((row) => {
      const product = total * row.amount;
      const base = product / eligible;
      assigned += base;
      result.set(row.id, base);
      return { ...row, remainder: product % eligible };
    })
    .sort((a, b) =>
      a.remainder === b.remainder
        ? a.id.localeCompare(b.id)
        : a.remainder > b.remainder
          ? -1
          : 1,
    );
  for (let index = 0n; index < total - assigned; index++) {
    const row = ranked[Number(index % BigInt(ranked.length))];
    if (!row)
      throw new ConflictException({
        code: "ALLOCATION_FAILED",
        message: "No eligible allocation row",
      });
    result.set(row.id, (result.get(row.id) ?? 0n) + 1n);
  }
  return result;
}

const sum = (values: bigint[]) =>
  values.reduce((total, value) => total + value, 0n);
export const minorNumber = (value: bigint | string | number) => Number(value);

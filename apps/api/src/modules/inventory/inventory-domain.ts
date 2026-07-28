export const QUANTITY_SCALE = 1_000_000n;

export function parseQuantity(value: string): bigint {
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(value))
    throw new Error("INVENTORY_QUANTITY_INVALID");
  const negative = value.startsWith("-"),
    raw = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = raw.split(".");
  const scaled =
    BigInt(whole) * QUANTITY_SCALE + BigInt(fraction.padEnd(6, "0"));
  return negative ? -scaled : scaled;
}

export function formatQuantity(value: bigint): string {
  const negative = value < 0n,
    absolute = negative ? -value : value;
  const whole = absolute / QUANTITY_SCALE;
  const fraction = (absolute % QUANTITY_SCALE)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("INVENTORY_DIVISOR_INVALID");
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const rounded = (absolute + denominator / 2n) / denominator;
  return negative ? -rounded : rounded;
}

export function convertQuantity(
  value: string,
  numerator: bigint,
  denominator: bigint,
): string {
  if (numerator <= 0n || denominator <= 0n)
    throw new Error("INVENTORY_UOM_CONVERSION_INVALID");
  const scaled = parseQuantity(value) * numerator;
  if (scaled % denominator !== 0n)
    throw new Error("INVENTORY_UOM_PRECISION_EXCEEDED");
  return formatQuantity(scaled / denominator);
}

export function lineTotalMinor(
  quantity: string,
  unitPriceMinor: string,
): string {
  const scaled = parseQuantity(quantity),
    unit = BigInt(unitPriceMinor);
  if (scaled <= 0n || unit < 0n) throw new Error("INVENTORY_MONEY_INVALID");
  return ((scaled * unit + QUANTITY_SCALE / 2n) / QUANTITY_SCALE).toString();
}

export function movingAverage(
  currentQuantity: string,
  currentValueMinor: string,
  incomingQuantity: string,
  incomingUnitCostMinor: string,
) {
  const cq = parseQuantity(currentQuantity),
    iq = parseQuantity(incomingQuantity);
  if (iq <= 0n) throw new Error("INVENTORY_RECEIPT_QUANTITY_INVALID");
  const value =
    parseQuantity(currentValueMinor) +
    divideRounded(iq * parseQuantity(incomingUnitCostMinor), QUANTITY_SCALE);
  const quantity = cq + iq;
  return {
    quantity: formatQuantity(quantity),
    totalCostMinor: formatQuantity(value),
    averageUnitCostMinor: formatQuantity(
      divideRounded(value * QUANTITY_SCALE, quantity),
    ),
  };
}

export function assertPurchaseOrderTransition(from: string, to: string) {
  const allowed: Record<string, string[]> = {
    DRAFT: ["SUBMITTED", "CANCELLED"],
    SUBMITTED: ["APPROVED", "CANCELLED"],
    APPROVED: ["PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"],
    PARTIALLY_RECEIVED: ["RECEIVED", "CLOSED"],
    RECEIVED: ["CLOSED"],
  };
  if (!allowed[from]?.includes(to))
    throw new Error("PURCHASE_ORDER_STATUS_INVALID");
}

export function assertTransferTransition(from: string, to: string) {
  const allowed: Record<string, string[]> = {
    DRAFT: ["REQUESTED", "CANCELLED"],
    REQUESTED: ["APPROVED", "CANCELLED"],
    APPROVED: ["IN_TRANSIT", "SHIPPED", "CANCELLED"],
    IN_TRANSIT: ["PARTIALLY_RECEIVED", "RECEIVED"],
    SHIPPED: ["PARTIALLY_RECEIVED", "RECEIVED"],
    PARTIALLY_RECEIVED: ["RECEIVED"],
  };
  if (!allowed[from]?.includes(to))
    throw new Error("INVENTORY_TRANSFER_STATUS_INVALID");
}

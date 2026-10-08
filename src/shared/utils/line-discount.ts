const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface ResolvedLineDiscount {
  /** qty x unitPrice (tax-inclusive, before discount) -- OSCU `splyAmt`. */
  gross: number;
  /** Discount rate in percent -- OSCU `dcRt`. */
  rate: number;
  /** Discount amount, tax-inclusive -- OSCU `dcAmt`. */
  amount: number;
  /** gross - amount -- OSCU `totAmt`, the figure tax is split out of. */
  net: number;
}

/**
 * One rule for a line's discount, shared by the OSCU request, the sale report,
 * the document totals and the receipt so they cannot disagree. Either input may
 * be given; an amount wins over a rate. The discount can never exceed the line.
 */
export function resolveLineDiscount(
  quantity: number,
  unitPrice: number,
  discountRate?: number | null,
  discountAmount?: number | null,
): ResolvedLineDiscount {
  const gross = round2(Math.abs(quantity) * unitPrice);
  let amount = 0;
  if (discountAmount && discountAmount > 0) amount = round2(discountAmount);
  else if (discountRate && discountRate > 0) amount = round2((gross * discountRate) / 100);
  amount = Math.min(amount, gross);
  const rate = gross > 0 ? round2((amount / gross) * 100) : 0;
  return { gross, rate, amount, net: round2(gross - amount) };
}

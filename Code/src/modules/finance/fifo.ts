import { addMinor, parseMinorUnits, subtractMinor, type MinorUnits } from "@/core/money";

export type FifoChargeItem = {
  id: string;
  totalMinor: string;
  descriptionSnapshot: string;
  /** Stable order for FIFO (created_at ascending, then id). */
  sortKey: string;
};

export type FifoItemSettlement = {
  id: string;
  descriptionSnapshot: string;
  totalMinor: string;
  paidMinor: string;
  remainingMinor: string;
  fullyPaid: boolean;
};

/**
 * Apply charge-level allocated payments across line items in FIFO order.
 * Does not mutate storage — derived view only.
 */
export function deriveFifoItemSettlements(
  items: readonly FifoChargeItem[],
  appliedMinor: string | MinorUnits,
): FifoItemSettlement[] {
  const ordered = [...items].sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.id.localeCompare(b.id));
  let remainingApplied =
    typeof appliedMinor === "bigint" ? appliedMinor : parseMinorUnits(appliedMinor);
  if (remainingApplied < 0n) remainingApplied = 0n;

  return ordered.map((item) => {
    const total = parseMinorUnits(item.totalMinor);
    const paid = remainingApplied >= total ? total : remainingApplied;
    remainingApplied = subtractMinor(remainingApplied, paid);
    const remaining = subtractMinor(total, paid);
    return {
      id: item.id,
      descriptionSnapshot: item.descriptionSnapshot,
      totalMinor: total.toString(),
      paidMinor: paid.toString(),
      remainingMinor: remaining.toString(),
      fullyPaid: remaining === 0n,
    };
  });
}

export function sumMinorStrings(values: readonly string[]): string {
  let total = 0n;
  for (const value of values) {
    total = addMinor(total, parseMinorUnits(value));
  }
  return total.toString();
}

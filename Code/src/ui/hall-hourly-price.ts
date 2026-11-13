/**
 * A station is ready for the Main Hall only when its resolved hourly rate
 * is a positive minor-unit amount. Null, blank, zero, and non-numeric values
 * stay off the hall.
 */
export function isPositiveHourlyRate(rate: bigint | string | number | null | undefined): boolean {
  if (rate == null) return false;
  if (typeof rate === "bigint") return rate > 0n;
  if (typeof rate === "number") {
    if (!Number.isFinite(rate) || !Number.isInteger(rate)) return false;
    return rate > 0;
  }
  const text = rate.trim();
  if (!/^\d+$/.test(text)) return false;
  return BigInt(text) > 0n;
}

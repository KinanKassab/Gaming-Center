import { describe, expect, it } from "vitest";
import { isPositiveHourlyRate } from "@/ui/hall-hourly-price";

describe("hall hourly price", () => {
  it("accepts only a positive minor-unit rate", () => {
    expect(isPositiveHourlyRate(null)).toBe(false);
    expect(isPositiveHourlyRate(undefined)).toBe(false);
    expect(isPositiveHourlyRate("")).toBe(false);
    expect(isPositiveHourlyRate("0")).toBe(false);
    expect(isPositiveHourlyRate(0n)).toBe(false);
    expect(isPositiveHourlyRate(0)).toBe(false);
    expect(isPositiveHourlyRate("10000")).toBe(true);
    expect(isPositiveHourlyRate(1n)).toBe(true);
  });
});

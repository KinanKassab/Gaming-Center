import { describe, expect, it } from "vitest";
import {
  addMinor,
  currencyFractionDigits,
  formatMinorAmount,
  INT64_MAX,
  majorToMinor,
  minorToMajorString,
  multiplyMinor,
  parseMinorUnits,
  subtractMinor,
} from "@/core/money";
import { MoneyError } from "@/core/errors";

describe("money helpers", () => {
  it("parses integer minor units", () => {
    expect(parseMinorUnits("15000")).toBe(15000n);
  });

  it("rejects decimal strings as minor units", () => {
    expect(() => parseMinorUnits("10.50")).toThrow(MoneyError);
  });

  it("converts major units with integer math only", () => {
    expect(majorToMinor("10.50", 2)).toBe(1050n);
    expect(majorToMinor("15000", 0)).toBe(15000n);
  });

  it("adds and subtracts bigint amounts", () => {
    expect(addMinor(100n, 40n)).toBe(140n);
    expect(subtractMinor(100n, 40n)).toBe(60n);
  });

  it("multiplies bigint amounts and rejects int64 overflow", () => {
    expect(multiplyMinor(100n, 3n)).toBe(300n);
    expect(() => multiplyMinor(INT64_MAX, 2n)).toThrow(MoneyError);
  });

  it("formats SYP as whole units matching existing cashier integers", () => {
    expect(currencyFractionDigits("SYP")).toBe(0);
    expect(minorToMajorString(10000n, 0)).toBe("10000");
    expect(formatMinorAmount(10000n, "SYP")).toBe("10,000 SYP");
    expect(majorToMinor("10000", 0)).toBe(10000n);
    expect(majorToMinor("10,000", 0)).toBe(10000n);
    expect(majorToMinor("10,000.50", 2)).toBe(1000050n);
  });
});

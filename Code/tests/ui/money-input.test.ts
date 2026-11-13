import { describe, expect, it } from "vitest";
import { sanitizeMoneyInput } from "@/app/_components/money-input";

describe("money input", () => {
  it("accepts digits only for currencies without fractional units", () => {
    expect(sanitizeMoneyInput("12a ٣4-5", 0)).toBe("1245");
  });

  it("keeps one decimal separator and the supported fraction length", () => {
    expect(sanitizeMoneyInput("12.3a45.6", 2)).toBe("12.34");
  });
});

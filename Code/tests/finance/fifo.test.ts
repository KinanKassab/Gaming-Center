import { describe, expect, it } from "vitest";
import { deriveFifoItemSettlements } from "@/modules/finance/fifo";

describe("FIFO charge-item settlement", () => {
  it("applies 20 across 15+10+20 as 15 paid, 5 of second, 20 remaining", () => {
    const items = [
      { id: "a", totalMinor: "15000", descriptionSnapshot: "Cola", sortKey: "1" },
      { id: "b", totalMinor: "10000", descriptionSnapshot: "Water", sortKey: "2" },
      { id: "c", totalMinor: "20000", descriptionSnapshot: "Coffee", sortKey: "3" },
    ];
    const first = deriveFifoItemSettlements(items, "20000");
    expect(first.map((row) => row.paidMinor)).toEqual(["15000", "5000", "0"]);
    expect(first.map((row) => row.remainingMinor)).toEqual(["0", "5000", "20000"]);

    const second = deriveFifoItemSettlements(items, "45000");
    expect(second.every((row) => row.fullyPaid)).toBe(true);
    expect(second.map((row) => row.remainingMinor)).toEqual(["0", "0", "0"]);
  });
});

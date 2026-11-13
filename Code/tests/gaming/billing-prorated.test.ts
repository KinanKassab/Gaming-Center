import { describe, expect, it } from "vitest";
import { BillingError } from "@/core/errors";
import { INT64_MAX } from "@/core/money";
import { createId } from "@/core/ids";
import {
  BILLING_RULE_VERSION,
  BILLING_RULE_VERSION_PRORATED,
  calculateSessionBilling,
  type BillingSegmentFact,
} from "@/modules/gaming/billing-calculator";
import {
  applyMinPositiveDuration,
  allocateTotalByWeights,
  PRORATED_SNAPSHOT_FIELDS,
  proratedHourlyAmountMinor,
  roundBillableSecondsProrated,
  roundToMultipleHalfUp,
} from "@/modules/gaming/billing-prorated";

function seconds(minutes: number, extra = 0): bigint {
  return BigInt(minutes * 60 + extra);
}

function priceForRoundedMinutes(hourlyRate: bigint, minutes: number): bigint {
  return proratedHourlyAmountMinor({
    hourlyRateMinor: hourlyRate,
    roundedSeconds: seconds(minutes),
    hourSeconds: 3600n,
    priceRoundMultipleMinor: 5n,
  });
}

describe("roundToMultipleHalfUp (5 minutes)", () => {
  it("rounds documented minute boundaries", () => {
    expect(roundToMultipleHalfUp(seconds(31), 300n)).toBe(seconds(30));
    expect(roundToMultipleHalfUp(seconds(32), 300n)).toBe(seconds(30));
    expect(roundToMultipleHalfUp(seconds(33), 300n)).toBe(seconds(35));
    expect(roundToMultipleHalfUp(seconds(34), 300n)).toBe(seconds(35));
    expect(roundToMultipleHalfUp(seconds(37), 300n)).toBe(seconds(35));
    expect(roundToMultipleHalfUp(seconds(38), 300n)).toBe(seconds(40));
  });

  it("uses HALF-UP / away from zero on exact midpoints", () => {
    expect(roundToMultipleHalfUp(seconds(2, 29), 300n)).toBe(0n);
    expect(roundToMultipleHalfUp(seconds(2, 30), 300n)).toBe(seconds(5));
    expect(roundToMultipleHalfUp(seconds(2, 31), 300n)).toBe(seconds(5));
    expect(roundToMultipleHalfUp(seconds(7, 29), 300n)).toBe(seconds(5));
    expect(roundToMultipleHalfUp(seconds(7, 30), 300n)).toBe(seconds(10));
    expect(roundToMultipleHalfUp(seconds(7, 31), 300n)).toBe(seconds(10));
    expect(roundToMultipleHalfUp(seconds(32, 30), 300n)).toBe(seconds(35));
  });
});

describe("minimum positive billable duration", () => {
  it("keeps exact zero at zero", () => {
    expect(applyMinPositiveDuration(0n, 0n, 300n)).toBe(0n);
    expect(
      roundBillableSecondsProrated({
        billableSeconds: 0n,
        timeRoundMultipleSeconds: 300n,
        minPositiveSeconds: 300n,
      }),
    ).toBe(0n);
  });

  it("raises short positive time to 5 minutes", () => {
    expect(
      roundBillableSecondsProrated({
        billableSeconds: 1n,
        timeRoundMultipleSeconds: 300n,
        minPositiveSeconds: 300n,
      }),
    ).toBe(300n);
    expect(
      roundBillableSecondsProrated({
        billableSeconds: seconds(2),
        timeRoundMultipleSeconds: 300n,
        minPositiveSeconds: 300n,
      }),
    ).toBe(300n);
    expect(
      roundBillableSecondsProrated({
        billableSeconds: seconds(2, 29),
        timeRoundMultipleSeconds: 300n,
        minPositiveSeconds: 300n,
      }),
    ).toBe(300n);
  });
});

describe("prorated hourly amount (integer/rational)", () => {
  it("matches approved prices for hourly rate 100", () => {
    const rate = 100n;
    const expected: Array<[number, bigint]> = [
      [5, 10n],
      [10, 15n],
      [15, 25n],
      [20, 35n],
      [25, 40n],
      [30, 50n],
      [35, 60n],
      [40, 65n],
      [45, 75n],
      [50, 85n],
      [55, 90n],
      [60, 100n],
      [65, 110n],
      [90, 150n],
      [120, 200n],
    ];
    for (const [minutes, amount] of expected) {
      expect(priceForRoundedMinutes(rate, minutes)).toBe(amount);
    }
  });

  it("matches approved prices for hourly rate 120", () => {
    const rate = 120n;
    expect(priceForRoundedMinutes(rate, 5)).toBe(10n);
    expect(priceForRoundedMinutes(rate, 10)).toBe(20n);
    expect(priceForRoundedMinutes(rate, 15)).toBe(30n);
    expect(priceForRoundedMinutes(rate, 30)).toBe(60n);
    expect(priceForRoundedMinutes(rate, 60)).toBe(120n);
    expect(priceForRoundedMinutes(rate, 90)).toBe(180n);
  });

  it("returns 0 for zero rounded duration", () => {
    expect(
      proratedHourlyAmountMinor({
        hourlyRateMinor: 100n,
        roundedSeconds: 0n,
        hourSeconds: 3600n,
        priceRoundMultipleMinor: 5n,
      }),
    ).toBe(0n);
  });

  it("keeps large hourly values in bigint without float", () => {
    const rate = 10_000_000n;
    expect(priceForRoundedMinutes(rate, 60)).toBe(10_000_000n);
    expect(priceForRoundedMinutes(rate, 30)).toBe(5_000_000n);
  });

  it("fails closed when the final amount exceeds int64", () => {
    expect(() =>
      proratedHourlyAmountMinor({
        hourlyRateMinor: INT64_MAX,
        roundedSeconds: 216_000n,
        hourSeconds: 3600n,
        priceRoundMultipleMinor: 5n,
      }),
    ).toThrow(BillingError);
  });
});

const ORIGIN = new Date("2026-01-01T00:00:00.000Z");
function at(totalSeconds: number): Date {
  return new Date(ORIGIN.getTime() + totalSeconds * 1000);
}

function unitSnapshot(overrides?: Record<string, unknown>) {
  return {
    assignmentId: createId(),
    pricingPlanId: createId(),
    code: "STD",
    name: "Standard",
    pricingModel: "TIME_BASED",
    currency: "SYP",
    rateMinor: "100",
    billingUnitSeconds: 60,
    roundingMode: "CEIL",
    minimumBillableSeconds: 0,
    minimumChargeMinor: "0",
    packageDurationSeconds: null,
    packagePriceMinor: null,
    capturedAt: ORIGIN.toISOString(),
    ...overrides,
  };
}

function proratedSnapshot(overrides?: Record<string, unknown>) {
  const pricingPlanId = (overrides?.pricingPlanId as string | undefined) ?? createId();
  return {
    assignmentId: createId(),
    code: "HOUR",
    name: "Hourly",
    pricingModel: "TIME_BASED",
    currency: "SYP",
    rateMinor: "100",
    billingUnitSeconds: 3600,
    roundingMode: "NEAREST",
    minimumBillableSeconds: 0,
    minimumChargeMinor: "0",
    packageDurationSeconds: null,
    packagePriceMinor: null,
    capturedAt: ORIGIN.toISOString(),
    ...PRORATED_SNAPSHOT_FIELDS,
    ...overrides,
    pricingPlanId,
  };
}

function segment(
  startedAt: Date,
  endedAt: Date,
  snap: Record<string, unknown>,
): BillingSegmentFact {
  return {
    id: createId(),
    deviceId: createId(),
    pricingPlanId: snap.pricingPlanId as string,
    startedAt,
    endedAt,
    pricingSnapshot: snap,
  };
}

describe("session calculator UNIT vs PRORATED_HOUR", () => {
  it("keeps legacy UNIT CEIL math when timeBillingMode is omitted", () => {
    const snap = unitSnapshot();
    const result = calculateSessionBilling({
      sessionId: createId(),
      sessionStatus: "COMPLETED",
      asOf: at(90),
      mode: "final",
      pauses: [],
      segments: [segment(at(0), at(90), snap)],
    });
    expect(result.ruleVersion).toBe(BILLING_RULE_VERSION);
    expect(result.totalMinor).toBe("200");
    expect(result.segments[0]?.timeBillingMode).toBe("UNIT");
  });

  it("bills a 1-second prorated session at the 5-minute minimum", () => {
    const snap = proratedSnapshot();
    const result = calculateSessionBilling({
      sessionId: createId(),
      sessionStatus: "COMPLETED",
      asOf: at(1),
      mode: "final",
      pauses: [],
      segments: [segment(at(0), at(1), snap)],
    });
    expect(result.ruleVersion).toBe(BILLING_RULE_VERSION_PRORATED);
    expect(result.billableSeconds).toBe("1");
    expect(result.segments[0]?.billedDurationSeconds).toBe("300");
    expect(result.totalMinor).toBe("10");
  });

  it("does not apply UNIT CEIL to a PRORATED_HOUR snapshot", () => {
    const snap = proratedSnapshot({ rateMinor: "100" });
    const result = calculateSessionBilling({
      sessionId: createId(),
      sessionStatus: "COMPLETED",
      asOf: at(90),
      mode: "final",
      pauses: [],
      segments: [segment(at(0), at(90), snap)],
    });
    expect(result.totalMinor).toBe("10");
    expect(result.ruleVersion).toBe(BILLING_RULE_VERSION_PRORATED);
  });

  it("applies minimum charge after prorated rounding", () => {
    const snap = proratedSnapshot({ minimumChargeMinor: "50" });
    const result = calculateSessionBilling({
      sessionId: createId(),
      sessionStatus: "COMPLETED",
      asOf: at(300),
      mode: "final",
      pauses: [],
      segments: [segment(at(0), at(300), snap)],
    });
    expect(result.totalMinor).toBe("50");
    expect(result.segments[0]?.minimumAppliedMinor).toBe("40");
  });

  it("excludes non-billable pause time before prorated rounding", () => {
    const snap = proratedSnapshot();
    const result = calculateSessionBilling({
      sessionId: createId(),
      sessionStatus: "COMPLETED",
      asOf: at(600),
      mode: "final",
      pauses: [{ id: createId(), startedAt: at(0), endedAt: at(600), isBillable: false }],
      segments: [segment(at(0), at(600), snap)],
    });
    expect(result.billableSeconds).toBe("0");
    expect(result.totalMinor).toBe("0");
  });

  it("fails closed when a PRORATED_HOUR snapshot omits rounding parameters", () => {
    expect(() =>
      calculateSessionBilling({
        sessionId: createId(),
        sessionStatus: "COMPLETED",
        asOf: at(60),
        mode: "final",
        pauses: [],
        segments: [
          segment(at(0), at(60), {
            ...proratedSnapshot(),
            timeRoundMultipleSeconds: undefined,
            minPositiveBillableSeconds: undefined,
            hourSeconds: undefined,
            priceRoundMultipleMinor: undefined,
          }),
        ],
      }),
    ).toThrow(BillingError);
  });
});

describe("allocateTotalByWeights", () => {
  it("uses largest remainder so parts sum to the total", () => {
    expect(allocateTotalByWeights([12n, 21n], 300n)).toEqual([109n, 191n]);
    expect(allocateTotalByWeights([1n], 300n)).toEqual([300n]);
    expect(allocateTotalByWeights([5n, 5n], 10n)).toEqual([5n, 5n]);
  });

  it("puts a positive total on the last bucket when every weight is zero", () => {
    expect(allocateTotalByWeights([0n, 0n], 50n)).toEqual([0n, 50n]);
  });
});

describe("PRORATED_HOUR session-wide minimum after MOVE", () => {
  it("charges the 5-minute minimum once for two short device segments", () => {
    const snap = proratedSnapshot();
    const result = calculateSessionBilling({
      sessionId: createId(),
      sessionStatus: "COMPLETED",
      asOf: at(33),
      mode: "final",
      pauses: [],
      segments: [segment(at(0), at(12), snap), segment(at(12), at(33), snap)],
    });
    expect(result.ruleVersion).toBe(BILLING_RULE_VERSION_PRORATED);
    expect(result.segments).toHaveLength(2);
    expect(result.billableSeconds).toBe("33");
    expect(result.segments.reduce((sum, line) => sum + Number(line.billedDurationSeconds), 0)).toBe(300);
    expect(result.segments.reduce((sum, line) => sum + Number(line.amountMinor), 0)).toBe(10);
    expect(result.totalMinor).toBe("10");
    expect(result.segments.every((line) => line.amountMinor !== "20")).toBe(true);
  });

  it("does not multiply the minimum across three MOVE segments", () => {
    const snap = proratedSnapshot();
    const result = calculateSessionBilling({
      sessionId: createId(),
      sessionStatus: "COMPLETED",
      asOf: at(15),
      mode: "final",
      pauses: [],
      segments: [
        segment(at(0), at(5), snap),
        segment(at(5), at(10), snap),
        segment(at(10), at(15), snap),
      ],
    });
    expect(result.segments).toHaveLength(3);
    expect(result.billableSeconds).toBe("15");
    expect(result.totalMinor).toBe("10");
    expect(result.segments.reduce((sum, line) => sum + Number(line.amountMinor), 0)).toBe(10);
  });

  it("excludes non-billable pause time before the session-wide minimum", () => {
    const snap = proratedSnapshot();
    const result = calculateSessionBilling({
      sessionId: createId(),
      sessionStatus: "COMPLETED",
      asOf: at(60),
      mode: "final",
      pauses: [{ id: createId(), startedAt: at(10), endedAt: at(40), isBillable: false }],
      segments: [segment(at(0), at(30), snap), segment(at(30), at(60), snap)],
    });
    expect(result.billableSeconds).toBe("30");
    expect(result.pausedNonBillableSeconds).toBe("30");
    expect(result.totalMinor).toBe("10");
  });

  it("rounds once at the session boundary after MOVE (8 minutes → 10 minutes)", () => {
    const snap = proratedSnapshot();
    const result = calculateSessionBilling({
      sessionId: createId(),
      sessionStatus: "COMPLETED",
      asOf: at(480),
      mode: "final",
      pauses: [],
      segments: [segment(at(0), at(120), snap), segment(at(120), at(480), snap)],
    });
    expect(result.billableSeconds).toBe("480");
    expect(result.segments.reduce((sum, line) => sum + Number(line.billedDurationSeconds), 0)).toBe(600);
    expect(result.totalMinor).toBe("15");
  });

  it("bills a tiny first segment plus a longer second segment from session duration", () => {
    const snap = proratedSnapshot();
    const result = calculateSessionBilling({
      sessionId: createId(),
      sessionStatus: "COMPLETED",
      asOf: at(492),
      mode: "final",
      pauses: [],
      segments: [segment(at(0), at(12), snap), segment(at(12), at(492), snap)],
    });
    expect(result.billableSeconds).toBe("492");
    expect(result.totalMinor).toBe("15");
  });

  it("keeps one session minimum when MOVE segments have different hourly rates", () => {
    const first = proratedSnapshot({ rateMinor: "100" });
    const second = proratedSnapshot({ rateMinor: "120" });
    const result = calculateSessionBilling({
      sessionId: createId(),
      sessionStatus: "COMPLETED",
      asOf: at(33),
      mode: "final",
      pauses: [],
      segments: [segment(at(0), at(12), first), segment(at(12), at(33), second)],
    });
    expect(result.totalMinor).toBe("10");
    expect(result.segments).toHaveLength(2);
  });

  it("does not apply a per-segment UNIT minimum to legacy CEIL MOVE segments", () => {
    const first = unitSnapshot({ rateMinor: "100" });
    const second = unitSnapshot({ rateMinor: "250" });
    const result = calculateSessionBilling({
      sessionId: createId(),
      sessionStatus: "COMPLETED",
      asOf: at(120),
      mode: "final",
      pauses: [],
      segments: [segment(at(0), at(60), first), segment(at(60), at(120), second)],
    });
    expect(result.ruleVersion).toBe(BILLING_RULE_VERSION);
    expect(result.segments[0]?.amountMinor).toBe("100");
    expect(result.segments[1]?.amountMinor).toBe("250");
    expect(result.totalMinor).toBe("350");
  });
});

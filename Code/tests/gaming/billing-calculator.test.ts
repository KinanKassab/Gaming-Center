import { describe, expect, it } from "vitest";
import { BillingError } from "@/core/errors";
import { INT64_MAX } from "@/core/money";
import { createId } from "@/core/ids";
import {
  billedUnitsFromSeconds,
  calculateSessionBilling,
  parsePricingSnapshot,
  type BillingPauseFact,
  type BillingSegmentFact,
} from "@/modules/gaming/billing-calculator";

const ORIGIN = new Date("2026-01-01T00:00:00.000Z");

function at(seconds: number): Date {
  return new Date(ORIGIN.getTime() + seconds * 1000);
}

function snapshot(overrides?: Record<string, unknown>) {
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

function segment(startedAt: Date, endedAt: Date, snap = snapshot(), extra?: Partial<BillingSegmentFact>): BillingSegmentFact {
  return {
    id: createId(),
    deviceId: createId(),
    pricingPlanId: snap.pricingPlanId as string,
    startedAt,
    endedAt,
    pricingSnapshot: snap,
    ...extra,
  };
}

describe("billedUnitsFromSeconds", () => {
  const cases: Array<{
    seconds: bigint;
    unit: bigint;
    mode: "CEIL" | "FLOOR" | "NEAREST";
    units: bigint;
  }> = [
    { seconds: 0n, unit: 60n, mode: "CEIL", units: 0n },
    { seconds: 1n, unit: 60n, mode: "CEIL", units: 1n },
    { seconds: 59n, unit: 60n, mode: "CEIL", units: 1n },
    { seconds: 60n, unit: 60n, mode: "CEIL", units: 1n },
    { seconds: 61n, unit: 60n, mode: "CEIL", units: 2n },
    { seconds: 120n, unit: 60n, mode: "CEIL", units: 2n },
    { seconds: 0n, unit: 60n, mode: "FLOOR", units: 0n },
    { seconds: 1n, unit: 60n, mode: "FLOOR", units: 0n },
    { seconds: 59n, unit: 60n, mode: "FLOOR", units: 0n },
    { seconds: 60n, unit: 60n, mode: "FLOOR", units: 1n },
    { seconds: 61n, unit: 60n, mode: "FLOOR", units: 1n },
    { seconds: 29n, unit: 60n, mode: "NEAREST", units: 0n },
    { seconds: 30n, unit: 60n, mode: "NEAREST", units: 1n },
    { seconds: 31n, unit: 60n, mode: "NEAREST", units: 1n },
    { seconds: 90n, unit: 60n, mode: "NEAREST", units: 2n },
    { seconds: 10_000n, unit: 60n, mode: "CEIL", units: 167n },
  ];

  it.each(cases)("seconds=$seconds unit=$unit $mode => $units", ({ seconds, unit, mode, units }) => {
    expect(billedUnitsFromSeconds(seconds, unit, mode)).toBe(units);
  });
});

describe("calculateSessionBilling TIME_BASED", () => {
  it("bills 90 seconds at 100/60 CEIL as 200", () => {
    const snap = snapshot();
    const result = calculateSessionBilling({
      sessionId: createId(),
      sessionStatus: "COMPLETED",
      asOf: at(90),
      mode: "final",
      pauses: [],
      segments: [segment(at(0), at(90), snap)],
    });
    expect(result.totalMinor).toBe("200");
    expect(result.billableSeconds).toBe("90");
    expect(result.segments[0]?.billedUnits).toBe("2");
    expect(result.currency).toBe("SYP");
  });

  it("excludes non-billable pause overlap", () => {
    const snap = snapshot();
    const pauses: BillingPauseFact[] = [
      { id: createId(), startedAt: at(10), endedAt: at(40), isBillable: false },
    ];
    const result = calculateSessionBilling({
      sessionId: createId(),
      sessionStatus: "COMPLETED",
      asOf: at(90),
      mode: "final",
      pauses,
      segments: [segment(at(0), at(90), snap)],
    });
    // 90 elapsed - 30 pause = 60 billable → 1 unit → 100
    expect(result.billableSeconds).toBe("60");
    expect(result.pausedNonBillableSeconds).toBe("30");
    expect(result.totalMinor).toBe("100");
  });

  it("includes billable pause overlap", () => {
    const snap = snapshot();
    const pauses: BillingPauseFact[] = [
      { id: createId(), startedAt: at(10), endedAt: at(40), isBillable: true },
    ];
    const result = calculateSessionBilling({
      sessionId: createId(),
      sessionStatus: "COMPLETED",
      asOf: at(90),
      mode: "final",
      pauses,
      segments: [segment(at(0), at(90), snap)],
    });
    expect(result.billableSeconds).toBe("90");
    expect(result.pausedBillableSeconds).toBe("30");
    expect(result.totalMinor).toBe("200");
  });

  it("applies minimum billable seconds before rounding", () => {
    const snap = snapshot({ minimumBillableSeconds: 60, roundingMode: "FLOOR" });
    const result = calculateSessionBilling({
      sessionId: createId(),
      sessionStatus: "COMPLETED",
      asOf: at(1),
      mode: "final",
      pauses: [],
      segments: [segment(at(0), at(1), snap)],
    });
    expect(result.segments[0]?.billedDurationSeconds).toBe("60");
    expect(result.totalMinor).toBe("100");
  });

  it("applies minimum charge after unit math", () => {
    const snap = snapshot({ roundingMode: "FLOOR", minimumChargeMinor: "250" });
    const result = calculateSessionBilling({
      sessionId: createId(),
      sessionStatus: "COMPLETED",
      asOf: at(30),
      mode: "final",
      pauses: [],
      segments: [segment(at(0), at(30), snap)],
    });
    expect(result.segments[0]?.amountMinor).toBe("250");
    expect(result.segments[0]?.minimumAppliedMinor).toBe("250");
    expect(result.totalMinor).toBe("250");
  });

  it("sums independent segment snapshots", () => {
    const first = snapshot({ rateMinor: "100" });
    const second = snapshot({ rateMinor: "200", pricingPlanId: createId() });
    const result = calculateSessionBilling({
      sessionId: createId(),
      sessionStatus: "COMPLETED",
      asOf: at(120),
      mode: "final",
      pauses: [],
      segments: [segment(at(0), at(60), first), segment(at(60), at(120), second)],
    });
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]?.amountMinor).toBe("100");
    expect(result.segments[1]?.amountMinor).toBe("200");
    expect(result.totalMinor).toBe("300");
  });

  it("uses integer math for a very long duration", () => {
    const snap = snapshot({ rateMinor: "3" });
    const result = calculateSessionBilling({
      sessionId: createId(),
      sessionStatus: "COMPLETED",
      asOf: at(360_000),
      mode: "final",
      pauses: [],
      segments: [segment(at(0), at(360_000), snap)],
    });
    expect(result.billableSeconds).toBe("360000");
    expect(result.segments[0]?.billedUnits).toBe("6000");
    expect(result.totalMinor).toBe("18000");
  });

  it("fails closed on int64 overflow", () => {
    const snap = snapshot({ rateMinor: INT64_MAX.toString() });
    expect(() =>
      calculateSessionBilling({
        sessionId: createId(),
        sessionStatus: "COMPLETED",
        asOf: at(61),
        mode: "final",
        pauses: [],
        segments: [segment(at(0), at(61), snap)],
      }),
    ).toThrow(BillingError);
  });

  it("fails closed on overlapping segments", () => {
    const snap = snapshot();
    expect(() =>
      calculateSessionBilling({
        sessionId: createId(),
        sessionStatus: "COMPLETED",
        asOf: at(90),
        mode: "final",
        pauses: [],
        segments: [segment(at(0), at(60), snap), segment(at(30), at(90), snapshot())],
      }),
    ).toThrow(/overlap/i);
  });

  it("fails closed on mismatched currencies", () => {
    expect(() =>
      calculateSessionBilling({
        sessionId: createId(),
        sessionStatus: "COMPLETED",
        asOf: at(120),
        mode: "final",
        pauses: [],
        segments: [
          segment(at(0), at(60), snapshot({ currency: "SYP" })),
          segment(at(60), at(120), snapshot({ currency: "USD", pricingPlanId: createId() })),
        ],
      }),
    ).toThrow(BillingError);
  });

  it("fails closed on a missing snapshot", () => {
    expect(() =>
      calculateSessionBilling({
        sessionId: createId(),
        sessionStatus: "COMPLETED",
        asOf: at(60),
        mode: "final",
        pauses: [],
        segments: [
          {
            id: createId(),
            deviceId: createId(),
            pricingPlanId: createId(),
            startedAt: at(0),
            endedAt: at(60),
            pricingSnapshot: { nope: true },
          },
        ],
      }),
    ).toThrow(BillingError);
  });

  it("fails closed on an open pause in final mode", () => {
    expect(() =>
      calculateSessionBilling({
        sessionId: createId(),
        sessionStatus: "COMPLETED",
        asOf: at(90),
        mode: "final",
        pauses: [{ id: createId(), startedAt: at(10), endedAt: null, isBillable: false }],
        segments: [segment(at(0), at(90))],
      }),
    ).toThrow(/pause/i);
  });
});

describe("calculateSessionBilling PACKAGE", () => {
  const pack = snapshot({
    pricingModel: "PACKAGE",
    rateMinor: null,
    billingUnitSeconds: null,
    packageDurationSeconds: 3600,
    packagePriceMinor: "5000",
  });

  it("charges the package price when billable time is within the package", () => {
    const result = calculateSessionBilling({
      sessionId: createId(),
      sessionStatus: "COMPLETED",
      asOf: at(600),
      mode: "final",
      pauses: [],
      segments: [segment(at(0), at(600), pack)],
    });
    expect(result.totalMinor).toBe("5000");
    expect(result.segments[0]?.billedUnits).toBe("1");
  });

  it("does not charge package price for zero billable seconds", () => {
    const result = calculateSessionBilling({
      sessionId: createId(),
      sessionStatus: "COMPLETED",
      asOf: at(0),
      mode: "final",
      pauses: [],
      segments: [segment(at(0), at(0), pack)],
    });
    expect(result.totalMinor).toBe("0");
  });

  it("fails closed on package overage", () => {
    expect(() =>
      calculateSessionBilling({
        sessionId: createId(),
        sessionStatus: "COMPLETED",
        asOf: at(3601),
        mode: "final",
        pauses: [],
        segments: [segment(at(0), at(3601), pack)],
      }),
    ).toThrow(/overage/i);
  });

  it("fails closed when PACKAGE is billed across more than one segment", () => {
    expect(() =>
      calculateSessionBilling({
        sessionId: createId(),
        sessionStatus: "COMPLETED",
        asOf: at(120),
        mode: "final",
        pauses: [],
        segments: [segment(at(0), at(60), pack), segment(at(60), at(120), pack)],
      }),
    ).toThrow(/PACKAGE \+ MOVE is not supported/i);
  });
});

describe("parsePricingSnapshot", () => {
  it("rejects unknown plan types", () => {
    expect(() => parsePricingSnapshot(snapshot({ pricingModel: "FLAT" }))).toThrow(BillingError);
  });
});

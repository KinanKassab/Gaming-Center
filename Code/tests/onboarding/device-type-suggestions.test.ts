import { describe, expect, it } from "vitest";
import {
  additionalDevicesToCreate,
  findMatchingDeviceType,
  foldDeviceTypeName,
  isExistingDeviceTypeName,
  matchDeviceTypeSuggestion,
} from "@/modules/onboarding/device-type-suggestions";

const labels = {
  ps5: "بلايستيشن 5",
  ps4: "بلايستيشن 4",
  xbox: "إكس بوكس",
  pc: "كمبيوتر",
  billiards: "بلياردو",
  vr: "في آر",
  switch: "نينتندو سويتش",
};

describe("wizard device type suggestions", () => {
  it("treats short aliases as the same suggestion as the localized label", () => {
    expect(matchDeviceTypeSuggestion("PS5", labels)).toBe("ps5");
    expect(matchDeviceTypeSuggestion("بلايستيشن 5", labels)).toBe("ps5");
    expect(matchDeviceTypeSuggestion("playstation-5", labels)).toBe("ps5");
    expect(matchDeviceTypeSuggestion("كمبيوتر", labels)).toBe("pc");
    expect(matchDeviceTypeSuggestion("PC", labels)).toBe("pc");
  });

  it("marks a typed name as already added when an alias already exists", () => {
    const existing = [{ name: "PS5" }];
    expect(isExistingDeviceTypeName("بلايستيشن 5", existing, labels)).toBe(true);
    expect(isExistingDeviceTypeName("ps5", existing, labels)).toBe(true);
    expect(isExistingDeviceTypeName("بلايستيشن 4", existing, labels)).toBe(false);
    expect(isExistingDeviceTypeName("فيفا", existing, labels)).toBe(false);
  });

  it("keeps custom names distinct from suggestions", () => {
    expect(matchDeviceTypeSuggestion("فيفا", labels)).toBeNull();
    expect(isExistingDeviceTypeName("فيفا", [{ name: "PS5" }], labels)).toBe(false);
    expect(isExistingDeviceTypeName("فيفا", [{ name: "فيفا" }], labels)).toBe(true);
    expect(foldDeviceTypeName("  PS 5  ")).toBe("ps 5");
    expect(findMatchingDeviceType("بلايستيشن 5", [{ id: "1", name: "PS5" }], labels)?.id).toBe("1");
  });

  it("creates only the extra devices needed to reach the typed total", () => {
    expect(additionalDevicesToCreate(8, 0, 50)).toBe(8);
    expect(additionalDevicesToCreate(8, 3, 50)).toBe(5);
    expect(additionalDevicesToCreate(3, 3, 50)).toBe(0);
    expect(additionalDevicesToCreate(2, 5, 50)).toBe(0);
    expect(additionalDevicesToCreate(80, 0, 50)).toBe(50);
    expect(additionalDevicesToCreate(Number.NaN, 0, 50)).toBe(0);
  });
});

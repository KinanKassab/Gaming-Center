import { describe, expect, it } from "vitest";
import { matchesSmartDeviceSearch, normalizeSearchText } from "@/ui/smart-device-search";

describe("smart device search", () => {
  const ps10 = {
    name: "بلايستيشن 10",
    code: "PS-10",
    deviceTypeName: "بلايستيشن 4",
    areaName: "الصالة الرئيسية",
  };

  it("normalizes Arabic digits and alef variants", () => {
    expect(normalizeSearchText("إبـلايستيشن ١٠")).toContain("10");
    expect(normalizeSearchText("أ")).toBe("ا");
  });

  it("matches playstation 10 with the user's example query", () => {
    expect(matchesSmartDeviceSearch(ps10, "بلايستيشن 10")).toBe(true);
  });

  it("tolerates a small typo in the brand token", () => {
    expect(matchesSmartDeviceSearch(ps10, "بلايستيشن 10")).toBe(true);
    expect(matchesSmartDeviceSearch(ps10, "بلايستيشنن 10")).toBe(true);
    expect(matchesSmartDeviceSearch(ps10, "playstation 10")).toBe(true);
  });

  it("requires the number token so device 10 is preferred over device 1", () => {
    const ps1 = { name: "بلايستيشن 1", code: "PS-1", deviceTypeName: "بلايستيشن 4" };
    expect(matchesSmartDeviceSearch(ps10, "بلايستيشن 10")).toBe(true);
    expect(matchesSmartDeviceSearch(ps1, "بلايستيشن 10")).toBe(false);
  });

  it("does not match a number token inside a larger number", () => {
    const ps100 = { name: "بلايستيشن 100", code: "PS-100", deviceTypeName: "بلايستيشن 4" };
    expect(matchesSmartDeviceSearch(ps100, "بلايستيشن 10")).toBe(false);
  });

  it("matches by code number alone when typed", () => {
    expect(matchesSmartDeviceSearch(ps10, "10")).toBe(true);
    expect(matchesSmartDeviceSearch(ps10, "١٠")).toBe(true);
  });

  it("returns all devices for an empty query", () => {
    expect(matchesSmartDeviceSearch(ps10, "   ")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { sessionDeviceDisplayName } from "@/ui/session-device";

const names = new Map([
  ["dev-a", "PS5 - 01"],
  ["dev-b", "PS5 - 02"],
]);

describe("BUG-013 completed session device display", () => {
  it("shows the current device for an active session", () => {
    expect(
      sessionDeviceDisplayName({
        currentDeviceId: "dev-a",
        segments: [{ deviceId: "dev-a" }],
        deviceNameById: names,
        locale: "en",
      }),
    ).toBe("PS5 - 01");
  });

  it("shows the historical device for a completed single-device session", () => {
    expect(
      sessionDeviceDisplayName({
        currentDeviceId: null,
        segments: [{ deviceId: "dev-a" }],
        deviceNameById: names,
        locale: "ar",
      }),
    ).toBe("PS5 - 01");
  });

  it("shows the last device with a move hint for a completed MOVE session", () => {
    expect(
      sessionDeviceDisplayName({
        currentDeviceId: null,
        segments: [{ deviceId: "dev-a" }, { deviceId: "dev-b" }],
        deviceNameById: names,
        locale: "en",
      }),
    ).toBe("PS5 - 02 (after move)");
    expect(
      sessionDeviceDisplayName({
        currentDeviceId: null,
        segments: [{ deviceId: "dev-a" }, { deviceId: "dev-b" }],
        deviceNameById: names,
        locale: "ar",
      }),
    ).toBe("PS5 - 02 (بعد النقل)");
  });
});

import { describe, expect, it } from "vitest";
import {
  GUIDED_SETUP_DONE_COOKIE,
  appendGuidedSetupDoneOrg,
  guidedSetupCookieOptions,
  isGuidedSetupCompleteForOrg,
  shouldAutoOpenGuidedSetup,
  shouldPresentGuidedSetup,
} from "@/modules/onboarding/presentation";

const ORG_A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ORG_B = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

describe("guided setup presentation (BUG-008)", () => {
  it("hides Guided Setup once the floor is operationally ready", () => {
    expect(shouldPresentGuidedSetup({ completed: false })).toBe(true);
    expect(shouldPresentGuidedSetup({ completed: false, operationallyReady: true })).toBe(false);
    expect(
      shouldAutoOpenGuidedSetup({ completed: false, operationallyReady: true }),
    ).toBe(false);
  });

  it("auto-opens only while required setup is still incomplete", () => {
    expect(
      shouldAutoOpenGuidedSetup({ completed: false, operationallyReady: false }),
    ).toBe(true);
  });

  it("stops presenting and auto-opening after genuine completion", () => {
    expect(shouldPresentGuidedSetup({ completed: true })).toBe(false);
    expect(
      shouldAutoOpenGuidedSetup({ completed: true, operationallyReady: true }),
    ).toBe(false);
  });

  it("records completion per organization in the presentation cookie", () => {
    const value = appendGuidedSetupDoneOrg(undefined, ORG_A);
    expect(isGuidedSetupCompleteForOrg(value, ORG_A)).toBe(true);
    expect(isGuidedSetupCompleteForOrg(value, ORG_B)).toBe(false);
    expect(appendGuidedSetupDoneOrg(value, ORG_A)).toBe(value);
    expect(isGuidedSetupCompleteForOrg(appendGuidedSetupDoneOrg(value, ORG_B), ORG_B)).toBe(true);
  });

  it("uses a presentation-only HttpOnly cookie name", () => {
    expect(GUIDED_SETUP_DONE_COOKIE).toBe("gc_guided_setup_done");
    const options = guidedSetupCookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });
});

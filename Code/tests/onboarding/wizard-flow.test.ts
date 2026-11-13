import { describe, expect, it } from "vitest";
import type { SetupStepId, SetupStepStatus } from "@/modules/onboarding/setup-types";
import {
  WIZARD_STEP_IDS,
  canAdvanceWizard,
  canOpenWizardStep,
  canSkipWizardStep,
  initialWizardIndex,
  isMultiEntryWizardStep,
  shouldAutoAdvanceWizardForm,
  wizardReviewItems,
} from "@/modules/onboarding/wizard-flow";

function step(id: SetupStepId, done: boolean, optional = false): SetupStepStatus {
  return { id, label: id, done, optional, href: "/" };
}

function steps(done: Partial<Record<SetupStepId, boolean>>): SetupStepStatus[] {
  const ids: SetupStepId[] = [
    "branch",
    "area",
    "deviceType",
    "device",
    "pricing",
    "assignment",
    "payments",
    "staff",
  ];
  return ids.map((id) => step(id, done[id] ?? false, id === "staff"));
}

const BRANCH = WIZARD_STEP_IDS.indexOf("branch");
const AREA = WIZARD_STEP_IDS.indexOf("area");
const DEVICE_TYPE = WIZARD_STEP_IDS.indexOf("deviceType");
const PRICING = WIZARD_STEP_IDS.indexOf("pricing");
const CUSTOMERS = WIZARD_STEP_IDS.indexOf("customers");
const PRODUCTS = WIZARD_STEP_IDS.indexOf("products");
const STAFF = WIZARD_STEP_IDS.indexOf("staff");
const ROLES = WIZARD_STEP_IDS.indexOf("roles");
const REVIEW = WIZARD_STEP_IDS.indexOf("review");
const WELCOME = WIZARD_STEP_IDS.indexOf("welcome");

describe("onboarding wizard gating (BUG-017)", () => {
  it("exposes only the user-facing stepper, without device/payment/assignment UI steps", () => {
    expect([...WIZARD_STEP_IDS]).toEqual([
      "welcome",
      "branch",
      "area",
      "deviceType",
      "pricing",
      "customers",
      "products",
      "staff",
      "roles",
      "review",
    ]);
    expect(WIZARD_STEP_IDS.includes("device" as never)).toBe(false);
    expect(WIZARD_STEP_IDS.includes("payments" as never)).toBe(false);
    expect(WIZARD_STEP_IDS.includes("assignment" as never)).toBe(false);
  });

  it("blocks Next on a required step when that data is missing", () => {
    const current = steps({ payments: true });
    expect(canAdvanceWizard(BRANCH, current)).toBe(false);
    expect(canOpenWizardStep(AREA, current)).toBe(false);
    expect(canOpenWizardStep(DEVICE_TYPE, current)).toBe(false);
  });

  it("allows Next once the required step data exists", () => {
    const current = steps({ branch: true, payments: true });
    expect(canAdvanceWizard(BRANCH, current)).toBe(true);
    expect(canOpenWizardStep(AREA, current)).toBe(true);
  });

  it("requires both a device type and a device before leaving Devices", () => {
    const typesOnly = steps({
      branch: true,
      area: true,
      deviceType: true,
      payments: true,
    });
    expect(canAdvanceWizard(DEVICE_TYPE, typesOnly)).toBe(false);
    const withDevices = steps({
      branch: true,
      area: true,
      deviceType: true,
      device: true,
      payments: true,
    });
    expect(canAdvanceWizard(DEVICE_TYPE, withDevices)).toBe(true);
  });

  it("requires pricing and an internal assignment before leaving Pricing", () => {
    const planOnly = steps({
      branch: true,
      area: true,
      deviceType: true,
      device: true,
      pricing: true,
      payments: true,
    });
    expect(canAdvanceWizard(PRICING, planOnly)).toBe(false);
    const assigned = steps({
      branch: true,
      area: true,
      deviceType: true,
      device: true,
      pricing: true,
      assignment: true,
      payments: true,
    });
    expect(canAdvanceWizard(PRICING, assigned)).toBe(true);
  });

  it("keeps multi-entry steps from auto-advancing after one create", () => {
    expect(isMultiEntryWizardStep("area")).toBe(true);
    expect(isMultiEntryWizardStep("deviceType")).toBe(true);
    expect(isMultiEntryWizardStep("pricing")).toBe(true);
    expect(isMultiEntryWizardStep("customers")).toBe(true);
    expect(isMultiEntryWizardStep("products")).toBe(true);
    expect(isMultiEntryWizardStep("roles")).toBe(true);
    expect(shouldAutoAdvanceWizardForm("area")).toBe(false);
    expect(shouldAutoAdvanceWizardForm("deviceType")).toBe(false);
    expect(shouldAutoAdvanceWizardForm("pricing")).toBe(false);
    expect(shouldAutoAdvanceWizardForm("customers")).toBe(false);
    expect(shouldAutoAdvanceWizardForm("products")).toBe(false);
    expect(shouldAutoAdvanceWizardForm("roles")).toBe(false);
    expect(shouldAutoAdvanceWizardForm("branch")).toBe(true);
  });

  it("does not allow a blocked step title to jump ahead", () => {
    const current = steps({ branch: true, payments: true });
    expect(canOpenWizardStep(DEVICE_TYPE, current)).toBe(false);
    expect(canOpenWizardStep(REVIEW, current)).toBe(false);
  });

  it("allows Skip only on optional staff, not required steps", () => {
    const current = steps({
      branch: true,
      area: true,
      deviceType: true,
      device: true,
      pricing: true,
      assignment: true,
      payments: true,
    });
    expect(canSkipWizardStep(STAFF, current)).toBe(true);
    expect(canSkipWizardStep(WELCOME, current)).toBe(false);
    expect(canSkipWizardStep(BRANCH, current)).toBe(false);
    expect(canSkipWizardStep(AREA, current)).toBe(false);
    expect(canSkipWizardStep(PRICING, current)).toBe(false);
  });

  it("lets completed and dependency-satisfied future steps be opened", () => {
    const current = steps({
      branch: true,
      area: true,
      deviceType: true,
      device: true,
      pricing: true,
      assignment: true,
      payments: true,
    });
    expect(canOpenWizardStep(WELCOME, current)).toBe(true);
    expect(canOpenWizardStep(BRANCH, current)).toBe(true);
    expect(canOpenWizardStep(STAFF, current)).toBe(true);
    expect(canOpenWizardStep(CUSTOMERS, current)).toBe(true);
    expect(canOpenWizardStep(PRODUCTS, current)).toBe(true);
    expect(canOpenWizardStep(ROLES, current)).toBe(true);
    expect(canOpenWizardStep(REVIEW, current)).toBe(true);
    expect(canAdvanceWizard(CUSTOMERS, current)).toBe(true);
    expect(canAdvanceWizard(PRODUCTS, current)).toBe(true);
    expect(canAdvanceWizard(STAFF, current)).toBe(true);
    expect(canAdvanceWizard(ROLES, current)).toBe(true);
  });

  it("resumes from real setup data rather than a stale local index", () => {
    expect(initialWizardIndex(steps({ payments: true }), false)).toBe(0);
    expect(initialWizardIndex(steps({ branch: true, payments: true }), false)).toBe(AREA);
    expect(
      initialWizardIndex(
        steps({
          branch: true,
          area: true,
          deviceType: true,
          device: true,
          pricing: true,
          assignment: true,
          payments: true,
        }),
        true,
      ),
    ).toBe(REVIEW);
  });

  it("summarizes Devices and Pricing without exposing assignment or payment review rows", () => {
    const items = wizardReviewItems(
      steps({
        branch: true,
        area: true,
        deviceType: true,
        device: true,
        pricing: true,
        assignment: true,
        payments: true,
      }),
    );
    expect(items.map((item) => item.id)).toEqual(["branch", "area", "devices", "pricing", "staff"]);
    expect(items.find((item) => item.id === "devices")?.done).toBe(true);
    expect(items.find((item) => item.id === "pricing")?.done).toBe(true);
  });
});

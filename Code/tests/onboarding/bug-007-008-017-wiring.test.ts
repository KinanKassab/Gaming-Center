import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../src");

function source(relative: string): string {
  return readFileSync(resolve(root, relative), "utf8");
}

describe("BUG-007 / BUG-008 / BUG-017 wiring", () => {
  it("Floor End navigates from the End response session id to checkout", () => {
    const floor = source("app/admin/gaming/_components/floor-device-actions.tsx");
    expect(floor).toContain("EndSessionControl");
    expect(floor).toContain("endedSessionCheckoutHref");
    expect(floor).toContain("router.push(href)");
    expect(floor).toContain(`/api/gaming/sessions/\${props.sessionId}/end`);
    expect(source("ui/session-checkout.ts")).toContain("/admin/gaming/sessions/");
  });

  it("hides Guided Setup on the dashboard when the floor is operationally ready or Finish is recorded", () => {
    const host = source("app/admin/_components/guided-setup-host.tsx");
    expect(host).not.toContain("if (props.operationallyReady) return null");
    expect(host).toContain("shouldAutoOpenGuidedSetup");
    const dashboard = source("app/admin/page.tsx");
    expect(dashboard).toContain("isGuidedSetupCompleteForOrg");
    expect(dashboard).toContain("shouldPresentGuidedSetup");
    expect(dashboard).toContain("operationallyReady: setup.operationallyReady");
    expect(dashboard).toContain("showGuidedSetup && setup && wizardLists");
  });

  it("gates wizard Next, Skip, and step titles on setup status", () => {
    const wizard = source("app/admin/onboarding/onboarding-wizard.tsx");
    expect(wizard).toContain("canAdvanceWizard");
    expect(wizard).toContain("canSkipWizardStep");
    expect(wizard).toContain("canOpenWizardStep");
    expect(wizard).toContain("shouldAutoAdvanceWizardForm");
    expect(wizard).not.toContain('onClick={() => setIndex((value) => value + 1)}');
  });

  it("pricing step binds a device-type hourly price and optional offer, not a named plan form", () => {
    const wizard = source("app/admin/onboarding/onboarding-wizard.tsx");
    const form = source("app/admin/gaming/_components/device-pricing-form.tsx");
    expect(wizard).toContain("DevicePricingForm");
    expect(wizard).not.toContain("PricingPlanForm");
    expect(wizard).not.toContain("BulkDeviceCreateForm");
    expect(wizard).not.toContain("paymentMethods");
    expect(wizard).toContain("WizardPricingReview");
    expect(wizard).toContain('stepId === "pricing"');
    expect(wizard).toContain("setPricingReviewOpen(true)");
    expect(wizard).toContain("currentUserId");
    expect(wizard).toContain("onboarding.staffAdded");
    expect(wizard).toContain("router.refresh()");
    expect(form).toContain("/api/gaming/device-prices");
    expect(form).toContain('kind: "HOURLY"');
    expect(form).toContain('kind: "OFFER"');
    expect(form).toContain("deviceTypeIds");
    expect(form).not.toContain("deviceIds:");
    expect(form).toContain("pricing.offerToggle");
    expect(form).toContain("pricing.hourlyDeviceType");
    expect(form).not.toContain("pricing.minimumCharge");
  });

  it("keeps device edits local until one explicit save persists the draft", () => {
    const wizard = source("app/admin/onboarding/onboarding-wizard.tsx");
    const step = source("app/admin/onboarding/wizard-device-type-step.tsx");
    const persistence = source("app/admin/onboarding/persist-device-type-draft.ts");
    expect(wizard).toContain("WizardDeviceTypeStep");
    expect(wizard).toContain("onSaveChanges={saveDeviceTypeChanges}");
    expect(wizard).toContain("showSaveAction={false}");
    expect(wizard).toContain("onDraftStateChange={updateDeviceDraft}");
    expect(wizard).toContain("await saveDeviceTypeChanges(deviceDraft.changes)");
    expect(wizard).not.toContain("onboarding.saveLater");
    expect(wizard).not.toContain('!canAdvance && index < lastIndex ? <p className="hint">');
    expect(persistence).toContain("wizard-archive");
    expect(persistence).toContain("/api/gaming/devices/bulk");
    expect(step).toContain("onboarding.typeSuggestions");
    expect(step).toContain("onboarding.typeCustom");
    expect(step).toContain("<Toggle");
    expect(step).toContain("onboarding.typeDeviceCount");
    expect(step).toContain('type="checkbox"');
    expect(step).toContain("DEVICE_TYPE_SUGGESTION_IDS");
    expect(step).toContain("additionalDevicesToCreate");
    expect(step).toContain("onSaveChanges");
    expect(step).toContain("onboarding.saveDevices");
    expect(step).not.toContain("onBlur=");
    expect(step).not.toContain("onCreateDevices");
    expect(step).not.toContain("onArchiveType");
  });

  it("keeps the annotated onboarding controls visually scoped", () => {
    const css = source("app/globals.css");
    expect(css).toMatch(/\.combobox-control\s*\{[^}]*align-items:[^}]*min-height:/s);
    expect(css).not.toMatch(/\.combobox-control\s*\{[^}]*(?:gap|padding-inline):/s);
    expect(css).toMatch(/\.combobox-control input\s*\{[^}]*padding-inline:\s*0\.75rem;/s);
    expect(css).toMatch(/\.combobox-option\s*\{[^}]*gap:\s*0;[^}]*padding-inline:\s*0;/s);
    expect(css).toContain(".stepper li.done button:hover:not(:disabled)");
    expect(css).toContain("background: var(--success-soft)");
  });

  it("does not keep assignment or payment editors on the pricing page or wizard", () => {
    const pricing = source("app/admin/gaming/pricing/page.tsx");
    const wizard = source("app/admin/onboarding/onboarding-wizard.tsx");
    expect(pricing).not.toContain("PricingAssignmentForm");
    expect(pricing).not.toContain("pricing.applyTitle");
    expect(pricing).not.toContain("pricing.assignTitle");
    expect(pricing).toContain("hourlyPricedTypeIds");
    expect(wizard).not.toContain("stepPayments");
    expect(wizard).not.toContain("stepAssignment");
  });

  it("uses existing customer, catalog, and role contracts in the optional setup steps", () => {
    const wizard = source("app/admin/onboarding/onboarding-wizard.tsx");
    const loader = source("app/admin/onboarding/load-wizard-data.ts");
    expect(wizard).toContain("CustomerCreateForm");
    expect(wizard).toContain("CatalogProductCreateForm");
    expect(wizard).toContain("SelectAction");
    expect(wizard).toContain("/api/memberships/${member.membershipId}/roles/{value}");
    expect(loader).toContain("listCustomers");
    expect(loader).toContain("listProducts");
    expect(loader).toContain("listRoles");
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canEditStaffMembership,
  membershipHasOwnerRole,
  shouldShowStaffBranchControls,
} from "@/ui/staff-membership";

const root = resolve(__dirname, "../../src");

function source(relative: string): string {
  return readFileSync(resolve(root, relative), "utf8");
}

describe("staff membership UI rules", () => {
  it("hides branch grants when there is only one branch with an existing grant, and shows repair when a non-owner has none", () => {
    expect(
      shouldShowStaffBranchControls({ activeBranchCount: 1, isOwner: false, grantCount: 1 }),
    ).toBe(false);
    expect(
      shouldShowStaffBranchControls({ activeBranchCount: 0, isOwner: false, grantCount: 0 }),
    ).toBe(false);
    expect(
      shouldShowStaffBranchControls({ activeBranchCount: 2, isOwner: false, grantCount: 0 }),
    ).toBe(true);
    expect(
      shouldShowStaffBranchControls({ activeBranchCount: 1, isOwner: false, grantCount: 0 }),
    ).toBe(true);
    expect(
      shouldShowStaffBranchControls({ activeBranchCount: 1, isOwner: true, grantCount: 0 }),
    ).toBe(false);
    expect(canEditStaffMembership("m1", "m1")).toBe(false);
    expect(canEditStaffMembership("m1", "m2")).toBe(true);
    expect(membershipHasOwnerRole([{ code: "OWNER" }])).toBe(true);
    expect(membershipHasOwnerRole([{ code: "CASHIER" }])).toBe(false);
  });

  it("uses mobile staff cards and hides self/owner edit controls", () => {
    const page = source("app/admin/users/page.tsx");
    expect(page).toContain("staff-card");
    expect(page).toContain("users.name");
    expect(page).toContain("users.email");
    expect(page).toContain("users.role");
    expect(page).toContain("shouldShowStaffBranchControls");
    expect(page).toContain("canEditStaffMembership");
    expect(page).toContain("users.ownerManagesAll");
    expect(page).toContain("record-cards");
    expect(page).toContain("StaffEditTrigger");
    expect(page).toContain("revoke");
    expect(page).not.toContain('body={{ action: "suspend" }}');
  });
});

describe("bottom navigation layout and icons", () => {
  it("lays out compact nav items as a flex column with 22px icons", () => {
    const css = source("app/globals.css");
    expect(css).toMatch(/\.app-bottom-nav a,\s*\n\s*\.app-bottom-nav button \{[\s\S]*display: flex;/);
    expect(css).toMatch(/\.app-bottom-nav svg \{\s*width: 22px;\s*height: 22px;/);
    const shell = source("app/admin/_components/admin-shell.tsx");
    expect(shell).toContain("IconDashboard");
    expect(shell).toContain("IconFloor");
    expect(shell).toContain("IconReports");
    expect(shell).toContain("IconPeople");
    expect(shell).toContain("IconMore");
    expect(shell).not.toContain("IconSessions");
    expect(shell).not.toContain('href: "/admin/gaming/sessions"');
    const icons = source("app/_components/icons.tsx");
    expect(icons).toContain('stroke="currentColor"');
    expect(icons).toContain("<path d=\"M6 12h.01M12 12h.01M18 12h.01\" />");
  });
});

describe("pricing review popup and staff refresh", () => {
  it("opens Overlay review from Pricing Next instead of a stepper step", () => {
    const review = source("app/admin/onboarding/wizard-pricing-review.tsx");
    const wizard = source("app/admin/onboarding/onboarding-wizard.tsx");
    expect(review).toContain("from \"@/app/_components/overlay\"");
    expect(review).toContain("onboarding.stayAndEdit");
    expect(review).toContain("onboarding.saveAndContinue");
    expect(wizard).toContain("WizardPricingReview");
  });
});

import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/modules/identity";
import {
  ADMIN_NAV_HREFS,
  hasViewBranchGrant,
  isGamingSessionsListPath,
  retiredSessionsListHref,
  shouldShowAdminNavHref,
} from "@/ui/admin-nav";

describe("admin nav visibility", () => {
  it("hides management and floor when the actor lacks those grants", () => {
    const visibility = {
      permissions: [PERMISSIONS.customersRead],
      hasViewBranchGrant: false,
    };
    expect(shouldShowAdminNavHref(ADMIN_NAV_HREFS.dashboard, visibility)).toBe(true);
    expect(shouldShowAdminNavHref(ADMIN_NAV_HREFS.customers, visibility)).toBe(true);
    expect(shouldShowAdminNavHref(ADMIN_NAV_HREFS.floor, visibility)).toBe(false);
    expect(shouldShowAdminNavHref(ADMIN_NAV_HREFS.reports, visibility)).toBe(false);
    expect(shouldShowAdminNavHref(ADMIN_NAV_HREFS.roles, visibility)).toBe(false);
    expect(shouldShowAdminNavHref(ADMIN_NAV_HREFS.branches, visibility)).toBe(false);
    expect(shouldShowAdminNavHref("/admin/gaming/sessions", visibility)).toBe(false);
  });

  it("shows setup for a signed-in user who still needs to create the first center", () => {
    expect(
      shouldShowAdminNavHref(ADMIN_NAV_HREFS.onboarding, {
        permissions: [],
        hasViewBranchGrant: false,
        canCreateFirstOrganization: true,
      }),
    ).toBe(true);
    expect(
      shouldShowAdminNavHref(ADMIN_NAV_HREFS.onboarding, {
        permissions: [],
        hasViewBranchGrant: false,
        canCreateFirstOrganization: false,
      }),
    ).toBe(false);
  });

  it("hides Branches when the organization has exactly one visible location", () => {
    const permissions = [PERMISSIONS.branchesRead];
    expect(
      shouldShowAdminNavHref(ADMIN_NAV_HREFS.branches, {
        permissions,
        hasViewBranchGrant: true,
        visibleBranchCount: 1,
      }),
    ).toBe(false);
    expect(
      shouldShowAdminNavHref(ADMIN_NAV_HREFS.branches, {
        permissions,
        hasViewBranchGrant: true,
        visibleBranchCount: 0,
      }),
    ).toBe(true);
    expect(
      shouldShowAdminNavHref(ADMIN_NAV_HREFS.branches, {
        permissions,
        hasViewBranchGrant: true,
        visibleBranchCount: 2,
      }),
    ).toBe(true);
  });

  it("shows floor and reports only with session read and a view-capable branch grant", () => {
    const permissions = [PERMISSIONS.gamingSessionsRead];
    expect(
      shouldShowAdminNavHref(ADMIN_NAV_HREFS.floor, { permissions, hasViewBranchGrant: false }),
    ).toBe(false);
    expect(
      shouldShowAdminNavHref(ADMIN_NAV_HREFS.floor, { permissions, hasViewBranchGrant: true }),
    ).toBe(true);
    expect(
      shouldShowAdminNavHref(ADMIN_NAV_HREFS.reports, { permissions, hasViewBranchGrant: true }),
    ).toBe(true);
    expect(hasViewBranchGrant([{ accessMode: "OPERATE" }])).toBe(true);
    expect(hasViewBranchGrant([])).toBe(false);
  });

  it("hides Device types because they merge into Devices", () => {
    const visibility = {
      permissions: [PERMISSIONS.gamingMasterRead],
      hasViewBranchGrant: true,
    };
    expect(shouldShowAdminNavHref(ADMIN_NAV_HREFS.devices, visibility)).toBe(true);
    expect(shouldShowAdminNavHref(ADMIN_NAV_HREFS.deviceTypes, visibility)).toBe(false);
  });

  it("shows Products only with pos catalog read", () => {
    expect(
      shouldShowAdminNavHref(ADMIN_NAV_HREFS.catalog, {
        permissions: [PERMISSIONS.gamingMasterRead],
        hasViewBranchGrant: true,
      }),
    ).toBe(false);
    expect(
      shouldShowAdminNavHref(ADMIN_NAV_HREFS.catalog, {
        permissions: [PERMISSIONS.posCatalogRead],
        hasViewBranchGrant: true,
      }),
    ).toBe(true);
  });

  it("treats only the sessions index as the retired list URL", () => {
    expect(isGamingSessionsListPath("/admin/gaming/sessions")).toBe(true);
    expect(isGamingSessionsListPath("/admin/gaming/sessions/")).toBe(true);
    expect(isGamingSessionsListPath("/admin/gaming/sessions/abc")).toBe(false);
    expect(isGamingSessionsListPath("/admin/reports")).toBe(false);
    expect(retiredSessionsListHref("?range=1h")).toBe("/admin/reports?range=1h");
    expect(retiredSessionsListHref("")).toBe("/admin/reports");
  });
});

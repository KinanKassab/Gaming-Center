import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveFloorBranchId, resolveReportBranchId, firstSearchParam, shouldShowBranchPicker, soleBranchId } from "@/modules/gaming/branch-selection";
import { t } from "@/i18n/t";

const WORKING = "11111111-1111-4111-8111-111111111111";
const EMPTY = "22222222-2222-4222-8222-222222222222";
const STALE = "33333333-3333-4333-8333-333333333333";
const INACCESSIBLE = "44444444-4444-4444-8444-444444444444";

describe("BUG-036 Floor branch default", () => {
  it("preserves a valid explicit branchId even when that branch is empty", () => {
    expect(
      resolveFloorBranchId({
        requestedBranchId: EMPTY,
        accessibleBranchIds: [EMPTY, WORKING],
        branchIdsWithDevices: [WORKING],
      }),
    ).toBe(EMPTY);
  });

  it("does not let a newer empty branch hide a working floor when no branch is requested", () => {
    expect(
      resolveFloorBranchId({
        requestedBranchId: undefined,
        accessibleBranchIds: [EMPTY, WORKING],
        branchIdsWithDevices: [WORKING],
      }),
    ).toBe(WORKING);
  });

  it("falls back to the first accessible branch when none have devices", () => {
    expect(
      resolveFloorBranchId({
        requestedBranchId: undefined,
        accessibleBranchIds: [EMPTY, WORKING],
        branchIdsWithDevices: [],
      }),
    ).toBe(EMPTY);
  });

  it("treats stale and inaccessible ids as missing rather than selecting them", () => {
    expect(
      resolveFloorBranchId({
        requestedBranchId: STALE,
        accessibleBranchIds: [EMPTY, WORKING],
        branchIdsWithDevices: [WORKING],
      }),
    ).toBe(WORKING);
    expect(
      resolveFloorBranchId({
        requestedBranchId: INACCESSIBLE,
        accessibleBranchIds: [WORKING],
        branchIdsWithDevices: [WORKING],
      }),
    ).toBe(WORKING);
  });
});

describe("BUG-036 Reports branch default", () => {
  it("defaults to all accessible branches when no valid branchId is present", () => {
    expect(resolveReportBranchId(undefined, [EMPTY, WORKING])).toBeUndefined();
    expect(resolveReportBranchId("", [WORKING])).toBeUndefined();
    expect(resolveReportBranchId(STALE, [WORKING])).toBeUndefined();
    expect(resolveReportBranchId(INACCESSIBLE, [WORKING])).toBeUndefined();
  });

  it("preserves an explicit accessible branch", () => {
    expect(resolveReportBranchId(EMPTY, [EMPTY, WORKING])).toBe(EMPTY);
    expect(resolveReportBranchId(WORKING, [EMPTY, WORKING])).toBe(WORKING);
  });

  it("treats an empty search param as omitted", () => {
    expect(firstSearchParam("")).toBeUndefined();
    expect(firstSearchParam("  ")).toBeUndefined();
    expect(firstSearchParam(WORKING)).toBe(WORKING);
    expect(firstSearchParam(["", WORKING])).toBeUndefined();
  });

  it("localizes All branches in Arabic and English", () => {
    expect(t("en", "reports.allBranches")).toBe("All branches");
    expect(t("ar", "reports.allBranches")).toBe("كل الفروع");
    expect(t("en", "reports.noSessionsInBranch", { branch: "QA Branch" })).toContain("QA Branch");
    expect(t("ar", "reports.noSessionsInBranch", { branch: "QA Branch" })).toContain("QA Branch");
  });
});

const root = resolve(__dirname, "../../src");

function source(relative: string): string {
  return readFileSync(resolve(root, relative), "utf8");
}

describe("single-branch picker", () => {
  it("hides the field when there is only one branch and shows it again for two", () => {
    expect(shouldShowBranchPicker(0)).toBe(false);
    expect(shouldShowBranchPicker(1)).toBe(false);
    expect(shouldShowBranchPicker(2)).toBe(true);
  });

  it("returns the only branch id for auto-submit", () => {
    expect(soleBranchId([])).toBeUndefined();
    expect(soleBranchId([{ id: WORKING }, { id: EMPTY }])).toBeUndefined();
    expect(soleBranchId([{ id: WORKING }])).toBe(WORKING);
  });
});

describe("BUG-036 Floor and Reports page wiring", () => {
  it("does not default Floor or Reports to branches[0]", () => {
    const floor = source("app/admin/gaming/floor/page.tsx");
    expect(floor).toContain("resolveFloorBranchId");
    expect(floor).toContain("listBranchIdsWithFloorDevices");
    expect(floor).not.toContain("branches[0]");

    const reports = source("app/admin/reports/page.tsx");
    expect(reports).toContain("resolveReportBranchId");
    expect(reports).toContain('t(locale, "reports.allBranches")');
    const branchField = reports.slice(
      reports.indexOf("<BranchSelectField"),
      reports.indexOf("/>", reports.indexOf("<BranchSelectField")) + 2,
    );
    expect(branchField).toContain("emptyOptionLabel");
    expect(branchField).not.toContain("required");
    expect(reports).not.toContain("branches[0]");
  });
});

describe("single-branch field wiring", () => {
  it("uses BranchSelectField or shouldShowBranchPicker on operational pages", () => {
    const field = source("app/_components/branch-select-field.tsx");
    expect(field).toContain("shouldShowBranchPicker");
    expect(field).toContain('includeWhenSingle === "omit"');
    expect(field).toContain('type="hidden"');

    const files = [
      "app/admin/onboarding/onboarding-wizard.tsx",
      "app/admin/gaming/_components/assignment-form.tsx",
      "app/admin/gaming/floor/page.tsx",
      "app/admin/gaming/devices/page.tsx",
      "app/admin/gaming/areas/page.tsx",
      "app/admin/reports/page.tsx",
      "app/admin/page.tsx",
      "app/admin/settings/page.tsx",
      "app/admin/_components/customer-create-form.tsx",
    ];
    for (const relative of files) {
      const text = source(relative);
      expect({
        relative,
        wired: text.includes("BranchSelectField") || text.includes("shouldShowBranchPicker"),
      }).toEqual({ relative, wired: true });
    }
  });

  it("omits filter branchId when a page has only one branch, and still submits create branchId", () => {
    expect(source("app/admin/gaming/floor/page.tsx")).toContain('includeWhenSingle="omit"');
    expect(source("app/admin/reports/page.tsx")).toContain('includeWhenSingle="omit"');
    expect(source("app/admin/gaming/devices/page.tsx")).toContain('includeWhenSingle="omit"');
    expect(source("app/admin/gaming/areas/page.tsx")).toContain('includeWhenSingle="omit"');
    expect(source("app/admin/gaming/areas/page.tsx")).toContain("soleBranchId");
    expect(source("app/admin/onboarding/onboarding-wizard.tsx")).toContain("BranchSelectField");
    expect(source("app/admin/onboarding/onboarding-wizard.tsx")).toContain('name="branchId"');
    expect(source("app/admin/_components/customer-create-form.tsx")).toContain("soleBranchId");
  });
});

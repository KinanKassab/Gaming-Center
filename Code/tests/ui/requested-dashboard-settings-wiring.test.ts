import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../src");

function source(relative: string): string {
  return readFileSync(resolve(root, relative), "utf8");
}

describe("requested dashboard, floor, and settings wiring", () => {
  it("merges availability and shows hall and sold-product totals", () => {
    const dashboard = source("app/admin/page.tsx");
    expect(dashboard).toContain("device-availability-values");
    expect(dashboard).toContain("getBranchDashboardTotals");
    expect(dashboard).toContain("dashboard.grossHallProfit");
    expect(dashboard).toContain("dashboard.productSalesProfit");
  });

  it("removes the timezone editor and uses the redesigned settings sections", () => {
    const settings = source("app/admin/settings/page.tsx");
    expect(settings).not.toContain('name: "timezone"');
    expect(settings).not.toContain("settings.timezoneHelp");
    expect(settings).toContain("settings-option-grid");
    expect(settings).toContain("settings-capability-grid");
  });

  it("gives the floor filter button the same responsive width contract as the fields", () => {
    const css = source("app/globals.css");
    expect(css).toMatch(
      /\.floor-hall-bar-filters > button\s*\{[^}]*flex:\s*1 1 10rem;[^}]*min-width:\s*9rem;[^}]*max-width:\s*16rem;/s,
    );
  });
});

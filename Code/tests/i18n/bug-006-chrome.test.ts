import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../src");

function source(relative: string): string {
  return readFileSync(resolve(root, relative), "utf8");
}

describe("BUG-006 confirmed admin modules use request locale", () => {
  it("does not hard-code the confirmed English page titles", () => {
    const files = [
      "app/admin/customers/page.tsx",
      "app/admin/reports/page.tsx",
      "app/admin/users/page.tsx",
      "app/admin/roles/page.tsx",
      "app/admin/audit/page.tsx",
      "app/admin/gaming/page.tsx",
      "app/admin/gaming/devices/page.tsx",
    ];
    for (const file of files) {
      const text = source(file);
      expect(text).toContain("getRequestLocale()");
      expect(text).toContain('t(locale,');
    }
    expect(source("app/admin/customers/page.tsx")).not.toContain('title="Customers"');
    expect(source("app/admin/reports/page.tsx")).not.toContain('title="Reports"');
    expect(source("app/admin/users/page.tsx")).not.toContain('title="Staff"');
    expect(source("app/admin/roles/page.tsx")).not.toContain('title="Roles"');
    expect(source("app/admin/audit/page.tsx")).not.toContain('title="Activity"');
    expect(source("app/admin/gaming/page.tsx")).not.toContain('title="Floor setup"');
    expect(source("app/admin/gaming/devices/page.tsx")).not.toContain(">Filter<");
    expect(source("app/admin/gaming/devices/page.tsx")).not.toContain("Add one device");
  });

  it("BUG-032 remaining master-data chrome uses request locale", () => {
    const files = [
      "app/admin/branches/page.tsx",
      "app/admin/gaming/areas/page.tsx",
      "app/admin/gaming/pricing/page.tsx",
      "app/admin/settings/page.tsx",
    ];
    for (const file of files) {
      const text = source(file);
      expect(text).toContain("getRequestLocale()");
      expect(text).toContain("t(locale,");
    }
    expect(source("app/admin/branches/page.tsx")).not.toContain("<th>Name</th>");
    expect(source("app/admin/branches/page.tsx")).not.toContain('submitLabel="Add branch"');
    expect(source("app/admin/gaming/areas/page.tsx")).not.toContain("<th>Name</th>");
    expect(source("app/admin/gaming/device-types/page.tsx")).toContain("HardRedirect");
    expect(source("app/admin/gaming/device-types/page.tsx")).not.toContain("<th>Category</th>");
    expect(source("app/admin/gaming/pricing/page.tsx")).not.toContain("<h2>Hourly price</h2>");
    expect(source("app/admin/gaming/pricing/page.tsx")).not.toContain("<h2>Where prices apply</h2>");
    expect(source("app/admin/settings/page.tsx")).not.toContain("<h2>Optional capabilities</h2>");
    expect(source("app/admin/settings/page.tsx")).not.toContain("Applies to");
    expect(source("app/admin/gaming/_components/assignment-form.tsx")).not.toContain("<summary>Advanced</summary>");
    expect(source("app/login/login-form.tsx")).toContain("displayLoginError");
    expect(source("app/admin/gaming/_components/elapsed-timer.tsx")).toContain("initialNowMs");
    expect(source("app/admin/gaming/_components/elapsed-timer.tsx")).not.toContain("useState(() => Date.now())");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = join(process.cwd(), "src");

function source(path: string): string {
  return readFileSync(join(sourceRoot, path), "utf8");
}

describe("first center setup placement", () => {
  it("keeps first-center creation in the setup section instead of the dashboard", () => {
    const dashboard = source("app/admin/page.tsx");
    const setup = source("app/admin/onboarding/page.tsx");

    expect(dashboard).not.toContain("<CreateOrganizationForm");
    expect(dashboard).toContain('href="/admin/onboarding"');
    expect(setup).toContain("<CreateOrganizationForm");
    expect(setup).toContain("listUserMemberships");
  });

  it("gives all desktop topbar preferences the same stable dimensions", () => {
    const css = source("app/globals.css");

    expect(css).toContain(".app-topbar-prefs-desktop > :is(.topbar-pref, .sign-out-control)");
    expect(css).toMatch(/\.app-topbar-prefs-desktop > :is\([^)]+\)\s*\{[^}]*inline-size:\s*7\.5rem/s);
    expect(css).toMatch(/\.app-topbar-prefs-desktop select,[\s\S]*block-size:\s*2\.35rem/s);
    expect(css).toMatch(/\.app-topbar-prefs-desktop select\s*\{[^}]*padding-block:\s*0/s);
  });
});

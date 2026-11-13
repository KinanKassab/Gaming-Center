import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SELECT_ACTION_VALUE_PLACEHOLDER,
  resolveSelectActionUrl,
} from "@/app/admin/_lib/select-action";

const APP_ROOT = path.resolve(process.cwd(), "src/app");
const FUNCTION_JSX_PROP = /\w+=\{\s*\([^)]*\)\s*=>/;
/** Render-prop children: `{({ defer }) => (` — not `.map((row) =>`. */
const FUNCTION_JSX_CHILDREN = />\s*\{\s*\(\s*\{/;
const USE_CLIENT = /^[ \t]*["']use client["'][ \t]*;?[ \t]*$/m;

function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walkSource(full));
    } else if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

describe("SelectAction RSC contract", () => {
  it("builds the PUT URL from a serializable template and selected id", () => {
    const membershipId = "11111111-1111-4111-8111-111111111111";
    const roleId = "22222222-2222-4222-8222-222222222222";
    const url = resolveSelectActionUrl(
      `/api/memberships/${membershipId}/roles/${SELECT_ACTION_VALUE_PLACEHOLDER}`,
      roleId,
    );
    expect(url).toBe(`/api/memberships/${membershipId}/roles/${roleId}`);

    const branchId = "33333333-3333-4333-8333-333333333333";
    expect(
      resolveSelectActionUrl(
        `/api/memberships/${membershipId}/branch-access/{value}`,
        branchId,
      ),
    ).toBe(`/api/memberships/${membershipId}/branch-access/${branchId}`);
  });

  it("rejects templates and values that would produce an unsafe URL", () => {
    expect(() => resolveSelectActionUrl("/api/memberships/x/roles/", "abc")).toThrow(/placeholder/);
    expect(() => resolveSelectActionUrl("/api/{value}/roles/{value}", "abc")).toThrow(/placeholder/);
    expect(() => resolveSelectActionUrl("/api/roles/{value}", "")).toThrow(/selected value/);
    expect(() => resolveSelectActionUrl("/api/roles/{value}", "a{value}b")).toThrow(/invalid/);
  });

  it("SelectAction only accepts serializable props", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/app/admin/_components/controls.tsx"), "utf8");
    const start = source.indexOf("export function SelectAction");
    expect(start).toBeGreaterThan(-1);
    const next = source.indexOf("export function", start + "export function".length);
    const block = source.slice(start, next === -1 ? undefined : next);
    expect(block).not.toMatch(/buildAction|buildBody/);
    expect(block).toMatch(/actionTemplate:\s*string/);
    expect(block).not.toMatch(/:\s*\([^)]*\)\s*=>/);
  });

  it("Server Components do not pass function props into Client Components", () => {
    const offenders: string[] = [];
    for (const file of walkSource(APP_ROOT)) {
      const source = readFileSync(file, "utf8");
      if (USE_CLIENT.test(source)) continue;
      if (FUNCTION_JSX_PROP.test(source) || FUNCTION_JSX_CHILDREN.test(source)) {
        offenders.push(path.relative(process.cwd(), file).replaceAll("\\", "/"));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("customer statement pages pass localized serializable kind labels", () => {
    const statement = readFileSync(
      path.resolve(process.cwd(), "src/app/_components/customer-statement.tsx"),
      "utf8",
    );
    const publicPage = readFileSync(
      path.resolve(process.cwd(), "src/app/customer/view/[token]/page.tsx"),
      "utf8",
    );
    const adminPage = readFileSync(
      path.resolve(process.cwd(), "src/app/admin/customers/[customerId]/page.tsx"),
      "utf8",
    );
    expect(statement).toMatch(/kindLabels:\s*Record</);
    expect(statement).not.toMatch(/kindLabel:\s*\(/);
    for (const page of [publicPage, adminPage]) {
      expect(page).toMatch(/kindLabels=\{\{/);
      expect(page).not.toMatch(/kindLabel=\{|const kindLabel\s*=/);
    }
  });

  it("Guided Setup does not take render-prop children across the RSC boundary", () => {
    const host = readFileSync(
      path.resolve(process.cwd(), "src/app/admin/_components/guided-setup-host.tsx"),
      "utf8",
    );
    const dashboard = readFileSync(path.resolve(process.cwd(), "src/app/admin/page.tsx"), "utf8");
    expect(host).toMatch(/["']use client["']/);
    expect(host).not.toMatch(/children\s*:\s*\(/);
    expect(host).toMatch(/OnboardingWizard/);
    expect(dashboard).not.toMatch(/["']use client["']/);
    expect(dashboard).not.toMatch(/from ["']@\/app\/admin\/onboarding\/onboarding-wizard["']/);
    expect(dashboard).not.toMatch(/<OnboardingWizard/);
    expect(dashboard).toMatch(/<GuidedSetupHost/);
    expect(dashboard).not.toMatch(FUNCTION_JSX_CHILDREN);
  });
});

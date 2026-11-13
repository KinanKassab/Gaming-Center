import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createOrganizationInputSchema,
  updateOrganizationInputSchema,
} from "@/modules/identity";
import { t } from "@/i18n/t";

const root = resolve(__dirname, "../../src");

function source(relative: string): string {
  return readFileSync(resolve(root, relative), "utf8");
}

describe("BUG-025 organization name required", () => {
  it("requires a non-empty organization name on create and rejects blank updates", () => {
    expect(() =>
      createOrganizationInputSchema.parse({
        name: "Dragon Gaming",
        defaultCurrency: "SYP",
        locale: "ar",
      }),
    ).not.toThrow();
    expect(() =>
      createOrganizationInputSchema.parse({
        defaultCurrency: "SYP",
        locale: "ar",
      }),
    ).toThrow();
    expect(() => updateOrganizationInputSchema.parse({ name: "" })).toThrow();
    expect(() => updateOrganizationInputSchema.parse({ name: "   " })).toThrow();
    expect(() => updateOrganizationInputSchema.parse({ name: "Dragon Gaming" })).not.toThrow();
  });

  it("does not mark Settings business-profile name as optional", () => {
    const settings = source("app/admin/settings/page.tsx");
    const nameStart = settings.indexOf('name: "name"');
    expect(nameStart).toBeGreaterThan(-1);
    const nameBlock = settings.slice(nameStart, settings.indexOf("]", nameStart));
    expect(nameBlock).toContain('label: t(locale, "settings.profileName")');
    expect(nameBlock).not.toContain("optional: true");
    expect(settings).not.toContain('name: "legalName"');
    expect(source("app/admin/page.tsx")).not.toContain("settings.businessProfile");
    expect(source("app/admin/page.tsx")).not.toContain('name: "legalName"');
  });

  it("presents Name without an optional marker in Arabic and English", () => {
    expect(t("en", "settings.profileName")).toBe("Name");
    expect(t("ar", "settings.profileName")).toBe("الاسم");
    expect(t("en", "settings.profileName").toLowerCase()).not.toContain("optional");
    expect(t("ar", "settings.profileName")).not.toContain("اختياري");
    expect(t("en", "common.optional")).toBe("optional");
    expect(t("ar", "common.optional")).toBe("اختياري");
  });
});

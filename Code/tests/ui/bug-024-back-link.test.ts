import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { t } from "@/i18n/t";
import { localeDir } from "@/i18n/locales";

const root = resolve(__dirname, "../../src");

function source(relative: string): string {
  return readFileSync(resolve(root, relative), "utf8");
}

const DETAIL_PAGES = [
  "app/admin/customers/[customerId]/page.tsx",
  "app/admin/gaming/devices/[deviceId]/page.tsx",
  "app/admin/gaming/areas/[areaId]/page.tsx",
  "app/admin/gaming/device-types/[deviceTypeId]/page.tsx",
  "app/admin/gaming/sessions/[sessionId]/page.tsx",
  "app/admin/gaming/sessions/[sessionId]/checkout/page.tsx",
] as const;

describe("BUG-024 logical back direction", () => {
  it("uses IconBack with RTL flip instead of a physical left arrow", () => {
    const icon = source("app/_components/icons.tsx");
    expect(icon).toContain("export function IconBack");
    expect(icon).toContain("icon-directional");
    expect(source("app/globals.css")).toContain('html[dir="rtl"] .icon-directional');
    expect(source("app/globals.css")).toContain("scaleX(-1)");
    expect(source("app/_components/page-ui.tsx")).toContain("export function BackLink");
    expect(source("app/_components/page-ui.tsx")).toContain("<IconBack />");
  });

  it("does not hardcode physical arrows on covered detail routes", () => {
    for (const relative of DETAIL_PAGES) {
      const text = source(relative);
      expect(text).not.toContain("←");
      expect(text).not.toContain("→");
      expect(text).toContain("<BackLink");
    }
  });

  it("keeps Arabic back as RTL and English as LTR", () => {
    expect(localeDir("ar")).toBe("rtl");
    expect(localeDir("en")).toBe("ltr");
    expect(t("ar", "customers.back")).toBe("الزبائن");
    expect(t("en", "customers.back")).toBe("Customers");
    expect(t("ar", "devices.back")).toBe("الأجهزة");
    expect(t("en", "devices.back")).toBe("Devices");
  });
});

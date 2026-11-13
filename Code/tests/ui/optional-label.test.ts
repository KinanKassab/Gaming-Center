import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { catalogLabelHasEmbeddedOptional, formFieldVisibleName } from "@/ui/optional-label";
import { t } from "@/i18n/t";

const root = resolve(__dirname, "../../src");

function source(relative: string): string {
  return readFileSync(resolve(root, relative), "utf8");
}

describe("BUG-034 optional field presentation", () => {
  it("shows the Arabic optional marker once", () => {
    expect(t("ar", "common.optional")).toBe("اختياري");
    expect(formFieldVisibleName(t("ar", "branches.address"), true, t("ar", "common.optional"))).toBe(
      "العنوان (اختياري)",
    );
    expect(formFieldVisibleName(t("ar", "branches.address"), true, t("ar", "common.optional"))).not.toMatch(
      /اختياري.*اختياري/,
    );
    expect(formFieldVisibleName(t("ar", "checkout.reference"), true, t("ar", "common.optional"))).toBe(
      "المرجع (اختياري)",
    );
  });

  it("shows the English optional marker once", () => {
    expect(t("en", "common.optional")).toBe("optional");
    expect(formFieldVisibleName(t("en", "branches.address"), true, t("en", "common.optional"))).toBe(
      "Address (optional)",
    );
    expect(formFieldVisibleName(t("en", "branches.address"), true, t("en", "common.optional"))).not.toMatch(
      /optional.*optional/i,
    );
    expect(formFieldVisibleName(t("en", "customers.phone"), true, t("en", "common.optional"))).toBe(
      "Phone (optional)",
    );
  });

  it("does not mark required labels optional", () => {
    expect(formFieldVisibleName(t("en", "branches.name"), false, t("en", "common.optional"))).toBe("Name");
    expect(formFieldVisibleName(t("ar", "checkout.amount"), false, t("ar", "common.optional"))).toBe("المبلغ");
    expect(formFieldVisibleName(t("en", "checkout.amount"), false, t("en", "common.optional"))).toBe("Amount");
    expect(catalogLabelHasEmbeddedOptional(t("en", "branches.name"))).toBe(false);
    expect(catalogLabelHasEmbeddedOptional(t("en", "checkout.amount"))).toBe(false);
  });

  it("does not embed optional in FormField labels (FormField owns the marker)", () => {
    const keys = [
      "branches.address",
      "branches.phone",
      "floor.customer",
      "checkout.reference",
      "pricing.minimumCharge",
      "devices.notes",
      "devices.prefix",
      "customers.phone",
      "customers.notes",
      "customers.createdAtBranch",
      "roles.descriptionOptional",
    ] as const;
    for (const key of keys) {
      expect(catalogLabelHasEmbeddedOptional(t("en", key))).toBe(false);
      expect(catalogLabelHasEmbeddedOptional(t("ar", key))).toBe(false);
    }
    const field = source("app/_components/form-field.tsx");
    expect(field).toContain('t("common.optional")');
    expect(field.match(/t\("common\.optional"\)/g)?.length).toBe(1);
    expect(source("app/admin/branches/page.tsx")).toContain("optional: true");
    expect(source("app/admin/branches/page.tsx")).toContain('t(locale, "branches.address")');
    expect(source("app/admin/gaming/_components/floor-device-actions.tsx")).toContain('label: t("floor.customer")');
    expect(source("app/admin/gaming/_components/floor-device-actions.tsx")).not.toContain('t("floor.customerOptional")');
    expect(source("app/admin/_components/customer-create-form.tsx")).toContain('label={t("customers.phone")}');
    expect(source("app/admin/_components/customer-create-form.tsx")).toContain("optional");
    expect(source("app/admin/_components/customer-create-form.tsx")).not.toContain("phoneOptional");
    expect(source("app/admin/page.tsx")).not.toContain("legalName");
    expect(source("app/admin/settings/page.tsx")).not.toContain("legalName");
  });

  it("does not duplicate the accessible name of representative optional fields", () => {
    expect(
      formFieldVisibleName("Address (optional)", true, "اختياري"),
    ).toBe("Address (optional) (اختياري)");
    expect(catalogLabelHasEmbeddedOptional("Address (optional)")).toBe(true);
    expect(catalogLabelHasEmbeddedOptional(t("en", "branches.address"))).toBe(false);
    const checkout = source("app/admin/gaming/_components/checkout-form.tsx");
    expect(checkout).not.toContain('label={t("checkout.reference")}');
    expect(source("app/admin/gaming/_components/checkout-sales-card.tsx")).not.toContain(
      'label={t("checkout.reference")}',
    );
    expect(checkout).not.toContain("aria-label");
    const settings = source("app/admin/settings/page.tsx");
    expect(settings).toContain('label: t(locale, "settings.profileName")');
    expect(settings).not.toContain("optional: true");
    expect(source("app/admin/page.tsx")).not.toContain("settings.businessProfile");
    expect(source("app/admin/page.tsx")).not.toContain("dashboard.legalName");
  });
});

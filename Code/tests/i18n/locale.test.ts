import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, localeDir } from "@/i18n/locales";
import {
  parseUiLocale,
  parseUiLocaleSource,
  resolveHtmlLocale,
  shouldReplaceInheritedLocale,
  uiLocaleCookieOptions,
} from "@/i18n/cookie";
import { flattenMessageKeys, t } from "@/i18n/t";
import { ar } from "@/i18n/messages/ar";
import { en } from "@/i18n/messages/en";
import { formatMinorAmountForDisplay } from "@/i18n/format";
import { minorToMajorString } from "@/core/money";
import { DEFAULT_BUSINESS_TIMEZONE, resolveBusinessTimezone } from "@/i18n/timezone";

describe("locale resolution", () => {
  it("defaults Arabic with RTL when no cookie is set", () => {
    expect(DEFAULT_LOCALE).toBe("ar");
    expect(resolveHtmlLocale(undefined)).toBe("ar");
    expect(localeDir("ar")).toBe("rtl");
    expect(localeDir("en")).toBe("ltr");
  });

  it("uses the presentation cookie when it is ar or en", () => {
    expect(parseUiLocale("ar")).toBe("ar");
    expect(parseUiLocale("en")).toBe("en");
    expect(parseUiLocale("fr")).toBeNull();
    expect(resolveHtmlLocale("en")).toBe("en");
    expect(resolveHtmlLocale("nope")).toBe("ar");
  });

  it("treats source=user as an explicit override that org switch must not replace", () => {
    expect(parseUiLocaleSource("user")).toBe("user");
    expect(shouldReplaceInheritedLocale("user")).toBe(false);
    expect(shouldReplaceInheritedLocale("org")).toBe(true);
    expect(shouldReplaceInheritedLocale(null)).toBe(true);
  });

  it("sets the presentation locale cookie as HttpOnly SameSite=Lax Path=/ and never uses it for authz", () => {
    const options = uiLocaleCookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });

  it("keeps Arabic and English catalogs on the same keys", () => {
    const englishKeys = flattenMessageKeys(en).sort();
    const arabicKeys = flattenMessageKeys(ar).sort();
    expect(arabicKeys).toEqual(englishKeys);
    expect(t("ar", "nav.dashboard")).not.toBe(t("en", "nav.dashboard"));
    expect(t("ar", "login.title")).toBe("تسجيل الدخول");
  });

  it("localizes BUG-006 admin chrome keys in both catalogs", () => {
    const keys = [
      "customers.title",
      "customers.description",
      "reports.title",
      "users.title",
      "roles.title",
      "audit.title",
      "hub.title",
      "devices.addOne",
      "common.filter",
      "access.customers",
      "access.reports",
      "access.staff",
    ] as const;
    for (const key of keys) {
      expect(t("ar", key)).not.toBe(key);
      expect(t("en", key)).not.toBe(key);
      expect(t("ar", key)).not.toBe(t("en", key));
    }
    expect(t("en", "customers.title")).toBe("Customers");
    expect(t("ar", "customers.title")).toBe("الزبائن");
    expect(t("en", "hub.title")).toBe("Floor setup");
    expect(t("ar", "hub.title")).toBe("إعداد الصالة");
  });

  it("localizes BUG-031 login and BUG-032 leftover chrome keys", () => {
    expect(t("ar", "login.invalidCredentials")).not.toBe(t("en", "login.invalidCredentials"));
    expect(t("en", "login.invalidCredentials")).toBe("Invalid email or password");
    expect(t("ar", "branches.addTitle")).not.toBe("Add a branch");
    expect(t("ar", "pricing.hourlyTitle")).not.toBe("Hourly price");
    expect(t("ar", "pricing.applyTitle")).not.toBe("Where prices apply");
    expect(t("ar", "settings.optionalCapabilities")).not.toBe("Optional capabilities");
    expect(t("ar", "apiError.branchNameInUse")).toBe("يوجد فرع بهذا الاسم في هذا النشاط");
    expect(t("en", "apiError.branchNameInUse")).toBe(
      "A branch with this name already exists in this organization",
    );
    expect(t("ar", "status.branch.ACTIVE")).toBe("مفتوح");
    expect(t("en", "status.branch.ACTIVE")).toBe("Open");
  });

  it("formats money for display without changing canonical minor units", () => {
    expect(minorToMajorString(10000n, 0)).toBe("10000");
    const arabic = formatMinorAmountForDisplay(10000n, "SYP", "ar");
    const english = formatMinorAmountForDisplay(10000n, "SYP", "en");
    expect(arabic.endsWith("SYP")).toBe(true);
    expect(english.endsWith("SYP")).toBe(true);
    expect(arabic).toMatch(/10/);
    expect(english).toMatch(/10,000 SYP|10.000 SYP/);
  });

  it("does not expose UTC as an operator-facing Reports label", () => {
    expect(t("en", "reports.from")).not.toMatch(/UTC/i);
    expect(t("en", "reports.to")).not.toMatch(/UTC/i);
    expect(t("en", "reports.day")).not.toMatch(/UTC/i);
    expect(t("en", "reports.fromUtc")).not.toMatch(/UTC/i);
    expect(t("en", "reports.dayUtc")).not.toMatch(/UTC/i);
    expect(t("en", "reports.description")).not.toMatch(/UTC/i);
    expect(t("ar", "reports.description")).not.toMatch(/UTC/i);
  });
});

describe("timezone detection", () => {
  it("falls back to Asia/Damascus when timezone is omitted", () => {
    expect(resolveBusinessTimezone(undefined)).toBe(DEFAULT_BUSINESS_TIMEZONE);
    expect(resolveBusinessTimezone("")).toBe("Asia/Damascus");
    expect(resolveBusinessTimezone("  ")).toBe("Asia/Damascus");
  });

  it("persists a provided IANA timezone", () => {
    expect(resolveBusinessTimezone("Europe/Berlin")).toBe("Europe/Berlin");
  });
});

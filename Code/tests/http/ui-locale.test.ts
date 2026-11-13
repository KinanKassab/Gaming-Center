import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { POST } from "@/app/api/ui/locale/route";
import { DEFAULT_LOCALE, localeDir } from "@/i18n/locales";
import { UI_LOCALE_COOKIE, UI_LOCALE_SOURCE_COOKIE, resolveHtmlLocale } from "@/i18n/cookie";
import { createTestEnvironment, invokeHttp, seedOwnerWithOrganization } from "../helpers/identity";

const root = resolve(__dirname, "../../src");

function source(relative: string): string {
  return readFileSync(resolve(root, relative), "utf8");
}

async function readJson(response: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
}

function cookiesOf(response: Response): string {
  const anyHeaders = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") {
    return anyHeaders.getSetCookie().join("; ");
  }
  return response.headers.get("set-cookie") ?? "";
}

function localeRequest(locale: "ar" | "en", source = "user") {
  return new Request("http://localhost:3000/api/ui/locale", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ locale, source }),
  });
}

describe("BUG-022 public locale switch", () => {
  it("sets gc_ui_locale without authentication", async () => {
    const env = await createTestEnvironment();
    const response = await invokeHttp(env, { headers: new Headers() }, () => POST(localeRequest("en")));
    const { status, body } = await readJson(response);
    expect(status).toBe(200);
    expect(body).toMatchObject({ data: { locale: "en", source: "user" } });
    const cookie = cookiesOf(response);
    expect(cookie).toMatch(new RegExp(`${UI_LOCALE_COOKIE}=en`));
    expect(cookie).toMatch(new RegExp(`${UI_LOCALE_SOURCE_COOKIE}=user`));
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toMatch(/samesite=lax/);
  });

  it("persists Arabic RTL independently of auth", async () => {
    const env = await createTestEnvironment();
    const response = await invokeHttp(env, { headers: new Headers() }, () => POST(localeRequest("ar")));
    expect((await readJson(response)).status).toBe(200);
    expect(resolveHtmlLocale("ar")).toBe("ar");
    expect(localeDir("ar")).toBe("rtl");
    expect(DEFAULT_LOCALE).toBe("ar");
    expect(resolveHtmlLocale(undefined)).toBe("ar");
  });

  it("maps English to LTR and keeps the Arabic-first default when no cookie exists", () => {
    expect(localeDir("en")).toBe("ltr");
    expect(resolveHtmlLocale("en")).toBe("en");
    expect(resolveHtmlLocale(undefined)).toBe(DEFAULT_LOCALE);
  });

  it("still accepts an authenticated locale POST", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "locale-owner@a.com",
      name: "Owner Locale",
      slug: "locale-pub",
    });
    const response = await invokeHttp(env, { headers: owner.headers, organizationId: owner.organizationId }, () =>
      POST(localeRequest("en")),
    );
    expect((await readJson(response)).status).toBe(200);
    expect(cookiesOf(response)).toMatch(/gc_ui_locale=en/);
  });

  it("rejects an invalid locale value", async () => {
    const env = await createTestEnvironment();
    const response = await invokeHttp(env, { headers: new Headers() }, () =>
      POST(
        new Request("http://localhost:3000/api/ui/locale", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:3000" },
          body: JSON.stringify({ locale: "fr" }),
        }),
      ),
    );
    expect((await readJson(response)).status).toBe(400);
  });

  it("does not require authentication in the locale route", () => {
    expect(source("app/api/ui/locale/route.ts")).not.toContain("requireAuthenticated");
    expect(source("app/api/ui/locale/route.ts")).toContain("Does not require a session");
  });

  it("exposes Arabic/English switching on public auth surfaces", () => {
    const login = source("app/login/login-form.tsx");
    expect(login).toContain("LanguageSwitcher");
    expect(login).not.toContain("requireAuthenticated");
    expect(source("app/page.tsx")).toContain("LanguageSwitcher");
    expect(source("app/setup/setup-form.tsx")).toContain("LanguageSwitcher");
    const switcher = source("app/admin/_components/language-switcher.tsx");
    expect(switcher).toContain('/api/ui/locale');
    expect(switcher).toContain('value="ar"');
    expect(switcher).toContain('value="en"');
  });
});

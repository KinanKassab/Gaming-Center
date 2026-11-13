import { describe, expect, it } from "vitest";
import { displayLoginError } from "@/i18n/login-error";
import { t } from "@/i18n/t";

describe("BUG-031 login error localization", () => {
  it("maps Better Auth credential codes to Arabic and English catalog copy", () => {
    const ar = displayLoginError(
      { status: 401, payload: { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" } },
      "ar",
    );
    const en = displayLoginError(
      { status: 401, payload: { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" } },
      "en",
    );
    expect(ar).toBe(t("ar", "login.invalidCredentials"));
    expect(en).toBe(t("en", "login.invalidCredentials"));
    expect(ar).not.toBe(en);
    expect(ar).not.toMatch(/Invalid email or password/i);
    expect(en).toBe("Invalid email or password");
  });

  it("maps nested error.code and HTTP 401 without a code to invalid credentials", () => {
    expect(
      displayLoginError({ status: 401, payload: { error: { code: "USER_NOT_FOUND", message: "User not found" } } }, "ar"),
    ).toBe(t("ar", "login.invalidCredentials"));
    expect(displayLoginError({ status: 401, payload: { message: "Invalid email or password" } }, "ar")).toBe(
      t("ar", "login.invalidCredentials"),
    );
    expect(displayLoginError({ status: 403, payload: null }, "en")).toBe(t("en", "login.invalidCredentials"));
  });

  it("re-maps the same stored failure when the presentation locale changes", () => {
    const failure = {
      status: 401,
      payload: { code: "INVALID_EMAIL_OR_PASSWORD" as const, message: "Invalid email or password" },
    };
    expect(displayLoginError(failure, "ar")).toBe(t("ar", "login.invalidCredentials"));
    expect(displayLoginError(failure, "en")).toBe(t("en", "login.invalidCredentials"));
  });

  it("uses a safe fallback for unknown failures instead of raw provider text", () => {
    const unknown = displayLoginError(
      { status: 500, payload: { message: "insert into user failed\n    at auth.ts:12" } },
      "ar",
    );
    expect(unknown).toBe(t("ar", "login.failed", { status: 500 }));
    expect(unknown).not.toMatch(/insert|stack|auth\.ts/i);
  });
});

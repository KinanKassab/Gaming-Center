import { describe, expect, it } from "vitest";
import { POST as postAuth } from "@/app/api/auth/[...all]/route";
import { BETTER_AUTH_EMAIL_SIGN_IN_PATH } from "@/auth/login-form-safety";
import { displayLoginError } from "@/i18n/login-error";
import { t } from "@/i18n/t";
import { createTestEnvironment, invokeHttp, signUp } from "../helpers/identity";

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });
}

describe("BUG-031 Better Auth sign-in failure mapping", () => {
  it("maps a real 401 payload to localized invalid-credentials copy", async () => {
    const env = await createTestEnvironment();
    await signUp(env.auth, {
      email: "owner@example.com",
      password: "password-123",
      name: "Owner",
    });
    const response = await invokeHttp(env, { headers: new Headers() }, () =>
      postAuth(
        jsonRequest(`http://localhost:3000${BETTER_AUTH_EMAIL_SIGN_IN_PATH}`, {
          email: "owner@example.com",
          password: "wrong-password-bug031",
        }),
      ),
    );
    expect(response.status).toBe(401);
    const payload = (await response.json().catch(() => null)) as {
      code?: string;
      message?: string;
      error?: { code?: string; message?: string };
    } | null;
    expect(displayLoginError({ status: response.status, payload }, "ar")).toBe(t("ar", "login.invalidCredentials"));
    expect(displayLoginError({ status: response.status, payload }, "en")).toBe(t("en", "login.invalidCredentials"));
    expect(t("ar", "login.invalidCredentials")).not.toBe("Invalid email or password");
  });
});

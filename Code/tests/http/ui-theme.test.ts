import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/ui/theme/route";
import { createTestEnvironment, invokeHttp } from "../helpers/identity";

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

describe("ui theme HTTP", () => {
  it("sets gc_ui_theme without authentication", async () => {
    const env = await createTestEnvironment();
    const response = await invokeHttp(env, { headers: new Headers() }, () =>
      POST(
        new Request("http://localhost:3000/api/ui/theme", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:3000" },
          body: JSON.stringify({ theme: "dark" }),
        }),
      ),
    );
    const { status, body } = await readJson(response);
    expect(status).toBe(200);
    expect(body).toMatchObject({ data: { theme: "dark" } });
    const cookie = cookiesOf(response);
    expect(cookie).toMatch(/gc_ui_theme=dark/);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toMatch(/samesite=lax/);
  });

  it("rejects an invalid theme value", async () => {
    const env = await createTestEnvironment();
    const response = await invokeHttp(env, { headers: new Headers() }, () =>
      POST(
        new Request("http://localhost:3000/api/ui/theme", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:3000" },
          body: JSON.stringify({ theme: "neon" }),
        }),
      ),
    );
    expect((await readJson(response)).status).toBe(400);
  });
});

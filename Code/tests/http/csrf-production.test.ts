import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSameOriginMutation } from "@/app/api/_lib/handler";
import { AuthorizationError } from "@/core/errors";

describe("production CSRF origin gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects missing Origin in production", () => {
    vi.stubEnv("APP_BASE_URL", "https://gc.example.com");
    const request = new Request("https://gc.example.com/api/organizations/current", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(() => assertSameOriginMutation(request, "production")).toThrow(AuthorizationError);
  });

  it("rejects a mismatched Origin in production", () => {
    vi.stubEnv("APP_BASE_URL", "https://gc.example.com");
    const request = new Request("https://gc.example.com/api/organizations/current", {
      method: "PATCH",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: "{}",
    });
    expect(() => assertSameOriginMutation(request, "production")).toThrow(AuthorizationError);
  });

  it("allows the configured same origin in production", () => {
    vi.stubEnv("APP_BASE_URL", "https://gc.example.com");
    const request = new Request("https://gc.example.com/api/organizations/current", {
      method: "PATCH",
      headers: { origin: "https://gc.example.com", "content-type": "application/json" },
      body: "{}",
    });
    expect(() => assertSameOriginMutation(request, "production")).not.toThrow();
  });

  it("does not treat localhost as the production origin when APP_BASE_URL is unset", () => {
    vi.stubEnv("APP_BASE_URL", "");
    const request = new Request("http://localhost:3000/api/organizations/current", {
      method: "PATCH",
      headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: "{}",
    });
    expect(() => assertSameOriginMutation(request, "production")).toThrow(AuthorizationError);
  });

  it("allows a Vercel Preview origin from VERCEL_URL and rejects others", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "gc-git-main-akodus.vercel.app");
    vi.stubEnv("APP_BASE_URL", "");
    const allowed = new Request("https://gc-git-main-akodus.vercel.app/api/organizations/current", {
      method: "PATCH",
      headers: { origin: "https://gc-git-main-akodus.vercel.app", "content-type": "application/json" },
      body: "{}",
    });
    expect(() => assertSameOriginMutation(allowed, "production")).not.toThrow();
    const blocked = new Request("https://gc-git-main-akodus.vercel.app/api/organizations/current", {
      method: "PATCH",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: "{}",
    });
    expect(() => assertSameOriginMutation(blocked, "production")).toThrow(AuthorizationError);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { securityHeadersRecord } from "@/core/http-security";
import { logError, redactFields, runWithRequestLog } from "@/core/log";
import { csvEscape, toCsv } from "@/modules/reports";

const PRODUCTION_CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
];

describe("security headers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets a baseline production header set without HSTS", () => {
    const headers = securityHeadersRecord("production");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(headers["Strict-Transport-Security"]).toBeUndefined();
    const csp = headers["Content-Security-Policy"] ?? "";
    for (const directive of PRODUCTION_CSP_DIRECTIVES) {
      expect(csp).toContain(directive);
    }
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/connect-src[^;]*(ws:|wss:)/);
  });

  it("allows unsafe-eval in development for Next.js React Refresh", () => {
    const csp = securityHeadersRecord("development")["Content-Security-Policy"] ?? "";
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(csp).toContain("connect-src 'self'");
  });

  it("does not put development script-eval or extra WebSocket origins on production", () => {
    const production = securityHeadersRecord("production")["Content-Security-Policy"] ?? "";
    const development = securityHeadersRecord("development")["Content-Security-Policy"] ?? "";
    expect(development).toContain("'unsafe-eval'");
    expect(production).not.toContain("'unsafe-eval'");
    expect(production).toContain("connect-src 'self'");
    expect(production).not.toMatch(/connect-src[^;]*(ws:|wss:|localhost|127\.0\.0\.1)/);
  });

  it("reads NODE_ENV from the process environment when omitted", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(securityHeadersRecord()["Content-Security-Policy"]).not.toContain("'unsafe-eval'");
    vi.stubEnv("NODE_ENV", "development");
    expect(securityHeadersRecord()["Content-Security-Policy"]).toContain("'unsafe-eval'");
  });
});

describe("log redaction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never keeps secrets or database URLs in structured fields", () => {
    const redacted = redactFields({
      password: "hunter2",
      BETTER_AUTH_SECRET: "abc",
      DATABASE_URL: "postgres://gaming_app:s3cret@127.0.0.1:5432/db",
      route: "/api/health/ready",
    });
    expect(redacted?.password).toBe("[redacted]");
    expect(redacted?.BETTER_AUTH_SECRET).toBe("[redacted]");
    expect(redacted?.DATABASE_URL).toBe("[redacted]");
    expect(JSON.stringify(redacted)).not.toContain("s3cret");
    expect(JSON.stringify(redacted)).not.toContain("hunter2");
    expect(redacted?.route).toBe("/api/health/ready");
  });

  it("redacts nested fields and exception causes while keeping safe error metadata", () => {
    const errorOutput = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = Object.assign(new Error("connect failed: postgres://app:db-secret@db.test/gc"), {
      code: "ECONNRESET",
      credentials: { cookie: "cookie-secret", headers: { authorization: "Bearer bearer-secret" } },
    });
    const error = Object.assign(new Error("Request failed with token=message-secret"), {
      cause,
      code: "EAPP",
      stack: "Error: password=stack-secret\n at handler",
    });

    runWithRequestLog({ requestId: "request-safe-123", route: "/api/test" }, () => {
      logError(
        "test.failed",
        error,
        {
          details: {
            password: "field-secret",
            nested: [{ refresh_token: "nested-secret" }],
            message: "authorization: Bearer string-secret",
          },
        },
      );
    });

    const line = String(errorOutput.mock.calls[0]?.[0]);
    for (const sentinel of [
      "db-secret",
      "cookie-secret",
      "bearer-secret",
      "message-secret",
      "stack-secret",
      "field-secret",
      "nested-secret",
      "string-secret",
    ]) {
      expect(line).not.toContain(sentinel);
    }
    const record = JSON.parse(line) as {
      requestId: string;
      error: { name: string; message: string; code: string; cause: { code: string; name: string } };
    };
    expect(record.requestId).toBe("request-safe-123");
    expect(record.error.name).toBe("Error");
    expect(record.error.message).toContain("Request failed");
    expect(record.error.code).toBe("EAPP");
    expect(record.error.cause.name).toBe("Error");
    expect(record.error.cause.code).toBe("ECONNRESET");
    errorOutput.mockRestore();
  });
});

describe("csv export", () => {
  it("escapes quotes and keeps integer money as digits", () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(toCsv(["amount"], [["1200"]])).toContain("1200");
    expect(toCsv(["amount"], [["1200"]])).not.toContain("1200.0");
  });
});

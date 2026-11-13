/**
 * Baseline HTTP security headers for the same-origin admin app.
 * HSTS is intentionally omitted: HTTPS termination is the reverse-proxy /
 * platform's job, and this header would break local `next start` over HTTP.
 *
 * script-src: production forbids 'unsafe-eval'. Next.js `next dev` React
 * Refresh / HMR evaluates strings, so non-production NODE_ENV adds
 * 'unsafe-eval' only. connect-src stays 'self' (same-origin HMR WebSocket).
 */

export type HeaderPair = { key: string; value: string };

function isProductionNodeEnv(nodeEnv: string | undefined): boolean {
  return nodeEnv === "production";
}

export function securityHeadersList(nodeEnv: string | undefined = process.env.NODE_ENV): HeaderPair[] {
  const scriptSrc = isProductionNodeEnv(nodeEnv)
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    {
      key: "Content-Security-Policy",
      value: [
        "default-src 'self'",
        scriptSrc,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join("; "),
    },
  ];
}

export function securityHeadersRecord(nodeEnv: string | undefined = process.env.NODE_ENV): Record<string, string> {
  return Object.fromEntries(securityHeadersList(nodeEnv).map((header) => [header.key, header.value]));
}

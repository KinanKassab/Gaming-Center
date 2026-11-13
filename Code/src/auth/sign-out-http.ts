/**
 * Canonical Better Auth 1.7 HTTP sign-out.
 *
 * `POST /api/auth/sign-out` is defined with an optional JSON body schema.
 * better-call therefore requires `Content-Type: application/json` (HTTP 415
 * without it) and does not delete the session. Do not POST an empty body
 * without that header.
 */
export const BETTER_AUTH_SIGN_OUT_PATH = "/api/auth/sign-out";

export function betterAuthSignOutInit(): RequestInit {
  return {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  };
}

export function isSuccessfulSignOutResponse(response: Response): boolean {
  return response.ok;
}

import { NextResponse } from "next/server";
import { getSafeAuth } from "@/auth/auth";
import { handleHttpEmailSignUp, isHttpEmailSignUpRequest } from "@/auth/http-signup-gate";
import {
  ORGANIZATION_COOKIE,
  handleMutation,
  organizationCookieOptions,
} from "@/app/api/_lib/handler";

export const runtime = "nodejs";

/**
 * Better Auth HTTP surface (sign-in, sign-out, session, gated sign-up).
 * Public POST /api/auth/sign-up/email requires the bootstrap token and an
 * unused platform slot. In-process auth.api.signUpEmail is not gated.
 * Lazy so that builds do not require DATABASE_URL.
 * Sign-out also clears the organization selector cookie (stale auth context).
 */
function isSignOutRequest(request: Request): boolean {
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  return path === "/api/auth/sign-out" || path.endsWith("/sign-out");
}

function withClearedOrganizationCookie(response: Response): Response {
  const next = new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  next.cookies.set(ORGANIZATION_COOKIE, "", { ...organizationCookieOptions(), maxAge: 0 });
  return next;
}

export async function GET(request: Request) {
  return (await getSafeAuth()).handler(request);
}

export async function POST(request: Request) {
  if (isHttpEmailSignUpRequest(request)) {
    return handleMutation(request, async () => {
      const response = await handleHttpEmailSignUp(request, async (next) =>
        (await getSafeAuth()).handler(next),
      );
      return new NextResponse(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    });
  }
  const response = await (await getSafeAuth()).handler(request);
  if (isSignOutRequest(request)) {
    if (!response.ok) return response;
    return withClearedOrganizationCookie(response);
  }
  return response;
}

import { NextResponse, type NextRequest } from "next/server";
import { securityHeadersRecord } from "@/core/http-security";
import {
  floorNativePostSeeOtherLocation,
  shouldSeeOtherNativeFloorPost,
} from "@/ui/floor-start-form-safety";

export const REQUEST_ID_HEADER = "x-request-id";

/** Edge-safe request id. Do not import `@/core/log` (Node crypto / async_hooks). */
function createEdgeRequestId(): string {
  return globalThis.crypto.randomUUID();
}

function withSecurityHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  for (const [key, value] of Object.entries(securityHeadersRecord())) {
    if (!response.headers.has(key)) {
      response.headers.set(key, value);
    }
  }
  return response;
}

export function middleware(request: NextRequest): NextResponse {
  const incoming = request.headers.get(REQUEST_ID_HEADER)?.trim();
  const requestId = incoming && incoming.length <= 128 ? incoming : createEdgeRequestId();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  const floorNativePost = shouldSeeOtherNativeFloorPost({
    method: request.method,
    pathname: request.nextUrl.pathname,
    contentType: request.headers.get("content-type"),
  });
  if (floorNativePost) {
    const location = floorNativePostSeeOtherLocation(request.nextUrl.href);
    return withSecurityHeaders(NextResponse.redirect(new URL(location, request.nextUrl.origin), 303), requestId);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  return withSecurityHeaders(response, requestId);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

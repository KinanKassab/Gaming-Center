import { timingSafeEqual } from "node:crypto";
import { AuthorizationError, ConflictError } from "@/core/errors";
import {
  configuredFirstAdminBootstrapToken,
  FIRST_ADMIN_BOOTSTRAP_TOKEN_HEADER,
} from "@/core/env";
import { getSafeRuntimeDb } from "@/db/client";
import {
  claimHttpSignupSlot,
  completeHttpSignupClaim,
  releaseHttpSignupClaim,
} from "@/modules/identity/platform-bootstrap";

export function isHttpEmailSignUpRequest(request: Request): boolean {
  if (request.method.toUpperCase() !== "POST") return false;
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  return path === "/api/auth/sign-up/email" || path.endsWith("/sign-up/email");
}

function secretsEqual(expected: string, provided: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(provided, "utf8");
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * Token check only. Does not claim the database slot. Never logs the token.
 */
export function assertHttpSignUpBootstrapToken(request: Request, env: NodeJS.ProcessEnv = process.env): void {
  const configured = configuredFirstAdminBootstrapToken(env);
  if (!configured) {
    throw new AuthorizationError("First-user bootstrap is disabled");
  }
  const provided = request.headers.get(FIRST_ADMIN_BOOTSTRAP_TOKEN_HEADER)?.trim() ?? "";
  if (!provided || !secretsEqual(configured, provided)) {
    throw new AuthorizationError("First-user bootstrap is denied");
  }
}

/**
 * Gate public HTTP sign-up. In-process `auth.api.signUpEmail` is not routed
 * through this function and remains available for admin provisioning.
 */
export async function handleHttpEmailSignUp(
  request: Request,
  forward: (request: Request) => Promise<Response>,
): Promise<Response> {
  assertHttpSignUpBootstrapToken(request);
  const db = await getSafeRuntimeDb();
  const claimed = await claimHttpSignupSlot(db);
  if (!claimed) {
    throw new ConflictError("First-user bootstrap is closed");
  }
  try {
    const response = await forward(request);
    if (!response.ok) {
      await releaseHttpSignupClaim(db);
      return response;
    }
    await completeHttpSignupClaim(db, response);
    return response;
  } catch (error) {
    await releaseHttpSignupClaim(db);
    throw error;
  }
}

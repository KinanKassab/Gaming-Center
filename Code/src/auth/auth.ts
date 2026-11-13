import { AsyncLocalStorage } from "node:async_hooks";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getRuntimeDb, getSafeRuntimeDb, type AppDatabase } from "@/db/client";
import { authAccounts, authSessions, authUsers, authVerifications } from "@/db/auth-schema";
import { ensureCoreUser, touchLastLogin } from "@/modules/identity/core-user";
import { publicAppOrigin, vercelPreviewTrustedOrigins } from "@/core/env";

/** Better Auth session lifetime. Unchanged: 7 days, sliding refresh after 1 day. */
export const BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
export const BETTER_AUTH_SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;

/**
 * Better Auth stays contained in src/auth: domain modules receive only the
 * stable subject id (core_users.auth_subject) and never import this file.
 *
 * Interim implementation defaults recorded in ADR 0007:
 * - email + password enabled (no email transport is decided — ADR 0003);
 * - no email verification, no MFA, no magic links yet (NEEDS DECISION);
 * - autoSignIn disabled so admin-provisioned accounts never mint sessions.
 * Public HTTP POST /api/auth/sign-up/email is gated in http-signup-gate.ts.
 * In-process auth.api.signUpEmail stays available for staff provisioning.
 *
 * Persistence: Better Auth stores the session in auth_sessions and sets its
 * HttpOnly SameSite=Lax cookie. A later request with that cookie is authenticated
 * without signing in again until expiresIn elapses (refreshed by updateAge).
 */
export function createAuth(db: AppDatabase, options?: { baseURL?: string; secret?: string }) {
  const baseURL = options?.baseURL ?? publicAppOrigin();
  const isProduction = process.env.NODE_ENV === "production";
  const trustedOrigins = [...new Set([new URL(baseURL).origin, ...vercelPreviewTrustedOrigins()])];
  return betterAuth({
    baseURL,
    secret: options?.secret ?? process.env.BETTER_AUTH_SECRET,
    trustedOrigins,
    telemetry: { enabled: false },
    session: {
      expiresIn: BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS,
      updateAge: BETTER_AUTH_SESSION_UPDATE_AGE_SECONDS,
    },
    advanced: {
      useSecureCookies: isProduction,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: isProduction,
      },
    },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      autoSignIn: false,
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            // Provision the Core User at sign-up. A Core User row alone grants
            // no organization access; authenticateRequest re-syncs as a safety net.
            await ensureCoreUser(db, {
              authSubject: user.id,
              email: user.email ?? null,
              displayName: user.name || user.email || "User",
            });
          },
        },
      },
      session: {
        create: {
          after: async (session) => {
            await touchLastLogin(db, session.userId);
          },
        },
      },
    },
  });
}

export type AppAuth = ReturnType<typeof createAuth>;

const runtimeAuth = new AsyncLocalStorage<AppAuth>();

/** Test/HTTP-harness override. Production request handling uses getAuth(). */
export function runWithRuntimeAuth<T>(auth: AppAuth, fn: () => T): T {
  return runtimeAuth.run(auth, fn);
}

declare global {
  // Cached across hot reloads in development.
  var __gamingCenterAuth: AppAuth | undefined;
}

/** Lazily created singleton for the running Next.js server. */
export function getAuth(): AppAuth {
  const scoped = runtimeAuth.getStore();
  if (scoped) return scoped;
  if (!globalThis.__gamingCenterAuth) {
    globalThis.__gamingCenterAuth = createAuth(getRuntimeDb());
  }
  return globalThis.__gamingCenterAuth;
}

/** Ensures the runtime DB role is safe before minting the process-wide auth singleton. */
export async function getSafeAuth(): Promise<AppAuth> {
  const scoped = runtimeAuth.getStore();
  if (scoped) return scoped;
  await getSafeRuntimeDb();
  return getAuth();
}

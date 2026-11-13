import { describe, expect, it } from "vitest";
import { AuthenticationError } from "@/core/errors";
import {
  BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS,
  BETTER_AUTH_SESSION_UPDATE_AGE_SECONDS,
} from "@/auth/auth";
import { authenticateRequest } from "@/auth/context";
import { publicEntryPath, tryAuthenticateRequest } from "@/auth/entry";
import { createTestEnvironment, signInHeaders, signUp } from "../helpers/identity";

describe("Better Auth session persistence", () => {
  it("keeps a 7-day HttpOnly session and does not auto-sign-in on sign-up", () => {
    expect(BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS).toBe(60 * 60 * 24 * 7);
    expect(BETTER_AUTH_SESSION_UPDATE_AGE_SECONDS).toBe(60 * 60 * 24);
  });

  it("does not mint a session from sign-up alone (autoSignIn stays false)", async () => {
    const env = await createTestEnvironment();
    await signUp(env.auth, {
      email: "owner@example.com",
      password: "password-123",
      name: "Owner",
    });
    await expect(authenticateRequest(env.db, env.auth, new Headers())).rejects.toThrow(AuthenticationError);
    expect(await tryAuthenticateRequest(env.db, env.auth, new Headers())).toBeNull();
  });

  it("reuses the Better Auth session cookie on a later request without signing in again", async () => {
    const env = await createTestEnvironment();
    await signUp(env.auth, {
      email: "owner@example.com",
      password: "password-123",
      name: "Owner",
    });
    const headers = await signInHeaders(env.auth, {
      email: "owner@example.com",
      password: "password-123",
    });
    const first = await authenticateRequest(env.db, env.auth, headers);
    const later = await tryAuthenticateRequest(env.db, env.auth, headers);
    expect(later?.user.id).toBe(first.user.id);
    expect(later?.user.email).toBe("owner@example.com");
  });
});

describe("authenticated public entry", () => {
  it("sends a usable session from / and /login to /admin", () => {
    expect(publicEntryPath(true)).toBe("/admin");
    expect(publicEntryPath(false)).toBeNull();
  });
});

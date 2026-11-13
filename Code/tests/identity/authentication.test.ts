import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { AuthenticationError, AuthorizationError } from "@/core/errors";
import { coreUsers } from "@/db/schema";
import { authenticateRequest } from "@/auth/context";
import { findCoreUserByAuthSubject } from "@/modules/identity";
import { createTestEnvironment, signInHeaders, signUp } from "../helpers/identity";

describe("authentication foundation", () => {
  it("rejects an unauthenticated request", async () => {
    const env = await createTestEnvironment();
    await expect(authenticateRequest(env.db, env.auth, new Headers())).rejects.toThrow(
      AuthenticationError,
    );
  });

  it("rejects garbage session cookies", async () => {
    const env = await createTestEnvironment();
    const headers = new Headers({ cookie: "better-auth.session_token=forged-token-value" });
    await expect(authenticateRequest(env.db, env.auth, headers)).rejects.toThrow(
      AuthenticationError,
    );
  });

  it("resolves a valid session to a provisioned Core User", async () => {
    const env = await createTestEnvironment();
    const { authSubject } = await signUp(env.auth, {
      email: "owner@example.com",
      password: "password-123",
      name: "Owner",
    });

    // Sign-up provisions the Core User mapping immediately (no org access yet).
    const provisioned = await findCoreUserByAuthSubject(env.db, authSubject);
    expect(provisioned?.authSubject).toBe(authSubject);
    expect(provisioned?.status).toBe("ACTIVE");

    const headers = await signInHeaders(env.auth, {
      email: "owner@example.com",
      password: "password-123",
    });
    const context = await authenticateRequest(env.db, env.auth, headers);

    expect(context.user.authSubject).toBe(authSubject);
    expect(context.user.email).toBe("owner@example.com");
    expect(context.user.displayName).toBe("Owner");
    expect(context.user.status).toBe("ACTIVE");

    // Mapping is stable: the same subject resolves to the same Core User.
    const second = await authenticateRequest(env.db, env.auth, headers);
    expect(second.user.id).toBe(context.user.id);
  });

  it("records last_login_at on sign-in for existing core users", async () => {
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
    const context = await authenticateRequest(env.db, env.auth, headers);

    const firstRows = await env.db
      .select({ lastLoginAt: coreUsers.lastLoginAt })
      .from(coreUsers)
      .where(eq(coreUsers.id, context.user.id));
    const firstLogin = firstRows[0]?.lastLoginAt;
    expect(firstLogin).toBeInstanceOf(Date);

    await new Promise((resolve) => setTimeout(resolve, 50));
    await signInHeaders(env.auth, { email: "owner@example.com", password: "password-123" });

    const secondRows = await env.db
      .select({ lastLoginAt: coreUsers.lastLoginAt })
      .from(coreUsers)
      .where(eq(coreUsers.id, context.user.id));
    const secondLogin = secondRows[0]?.lastLoginAt;
    expect(secondLogin).toBeInstanceOf(Date);
    expect(secondLogin!.getTime()).toBeGreaterThan(firstLogin!.getTime());
  });

  it("rejects a disabled Core User even with a valid provider session", async () => {
    const env = await createTestEnvironment();
    await signUp(env.auth, {
      email: "blocked@example.com",
      password: "password-123",
      name: "Blocked",
    });
    const headers = await signInHeaders(env.auth, {
      email: "blocked@example.com",
      password: "password-123",
    });
    const context = await authenticateRequest(env.db, env.auth, headers);

    await env.db
      .update(coreUsers)
      .set({ status: "DISABLED" })
      .where(eq(coreUsers.id, context.user.id));

    await expect(authenticateRequest(env.db, env.auth, headers)).rejects.toThrow(
      AuthorizationError,
    );
  });
});

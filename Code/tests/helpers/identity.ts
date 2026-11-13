import { createAuth, runWithRuntimeAuth, type AppAuth } from "@/auth/auth";
import { authenticateRequest, resolveOrganizationContext } from "@/auth/context";
import { createAuthAccountProvisioner } from "@/auth/provisioning";
import {
  assignRoleToMembership,
  createOrganization,
  createRole,
  createUserWithMembership,
  grantBranchAccess,
  listMemberships,
  revokeBranchAccess,
  setRolePermissions,
} from "@/modules/identity";
import type { BranchAccessMode } from "@/core/tenancy";
import { runWithRuntimeDb, type AppDatabase } from "@/db/client";
import {
  ORGANIZATION_COOKIE,
  runWithRequestScope,
  type CookieReader,
} from "@/app/api/_lib/handler";
import { createMigratedPglite } from "./pglite";

export type TestEnvironment = {
  client: Awaited<ReturnType<typeof createMigratedPglite>>["client"];
  db: AppDatabase;
  auth: AppAuth;
};

export async function requireGamingAppRole(
  client: TestEnvironment["client"],
): Promise<void> {
  const roles = await client.query<{ rolname: string }>(
    `SELECT rolname FROM pg_roles WHERE rolname = 'gaming_app'`,
  );
  if (roles.rows.length === 0) {
    throw new Error(
      "gaming_app role is required for tenant security tests (fail closed). Do not skip. If this engine cannot create the role, run `npm run test:postgres` against real PostgreSQL — see DEVELOPMENT_GUIDE.md.",
    );
  }
}

export async function createTestEnvironment(): Promise<TestEnvironment> {
  const { client, db } = await createMigratedPglite();
  await requireGamingAppRole(client);
  await client.exec(`SET ROLE gaming_app`);
  const auth = createAuth(db, {
    baseURL: "http://localhost:3000",
    secret: "vitest-only-secret-never-production",
  });
  return { client, db, auth };
}

export function organizationCookieReader(organizationId: string | null): CookieReader {
  return {
    get: (name) =>
      name === ORGANIZATION_COOKIE && organizationId ? { value: organizationId } : undefined,
  };
}

/** Run an HTTP route handler against the test database, session, and org cookie. */
export function invokeHttp<T>(
  env: TestEnvironment,
  options: { headers: Headers; organizationId?: string | null },
  fn: () => T,
): T {
  return runWithRuntimeDb(env.db, () =>
    runWithRuntimeAuth(env.auth, () =>
      runWithRequestScope(
        {
          headers: options.headers,
          cookies: organizationCookieReader(options.organizationId ?? null),
        },
        fn,
      ),
    ),
  );
}

export async function signUp(
  auth: AppAuth,
  input: { email: string; password: string; name: string },
): Promise<{ authSubject: string }> {
  const result = await auth.api.signUpEmail({ body: input });
  return { authSubject: result.user.id };
}

/** Signs in and returns request headers carrying the session cookie. */
export async function signInHeaders(
  auth: AppAuth,
  input: { email: string; password: string },
): Promise<Headers> {
  const { headers } = await auth.api.signInEmail({
    body: { email: input.email, password: input.password },
    returnHeaders: true,
  });
  const cookies = headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0]!)
    .join("; ");
  return new Headers({ cookie: cookies });
}

export type SeededOwner = {
  userId: string;
  organizationId: string;
  membershipId: string;
  ownerRoleId: string;
  headers: Headers;
};

/** Signs up a user, creates an organization they own, resolves the full context. */
export async function seedOwnerWithOrganization(
  env: TestEnvironment,
  options: { email: string; name: string; slug: string },
): Promise<SeededOwner> {
  await signUp(env.auth, { email: options.email, password: "password-123", name: options.name });
  const headers = await signInHeaders(env.auth, {
    email: options.email,
    password: "password-123",
  });
  const authContext = await authenticateRequest(env.db, env.auth, headers);
  const created = await createOrganization(env.db, { userId: authContext.user.id }, {
    slug: options.slug,
    name: `${options.name} Gaming`,
    defaultCurrency: "SYP",
    timezone: "Asia/Damascus",
    locale: "ar",
  });
  return {
    userId: authContext.user.id,
    organizationId: created.organizationId,
    membershipId: created.membershipId,
    ownerRoleId: created.ownerRoleId,
    headers,
  };
}

/** Full pipeline: authenticate + resolve organization context. */
export async function resolveActor(env: TestEnvironment, headers: Headers, organizationId: string) {
  const authContext = await authenticateRequest(env.db, env.auth, headers);
  return resolveOrganizationContext(env.db, authContext, organizationId);
}

/** Member with an explicit permission set (not OWNER). Password is password-123. */
export async function createStaffMember(
  env: TestEnvironment,
  owner: SeededOwner,
  options: {
    email: string;
    displayName: string;
    roleCode: string;
    permissions: string[];
    branches?: Array<{ branchId: string; accessMode: BranchAccessMode }>;
  },
): Promise<{ userId: string; membershipId: string; headers: Headers }> {
  const ownerContext = await resolveActor(env, owner.headers, owner.organizationId);
  const created = await createUserWithMembership(
    env.db,
    ownerContext.actor,
    { email: options.email, password: "password-123", displayName: options.displayName },
    createAuthAccountProvisioner(env.auth),
  );
  const role = await createRole(env.db, ownerContext.actor, {
    code: options.roleCode,
    name: options.roleCode,
  });
  await setRolePermissions(env.db, ownerContext.actor, role.id, {
    permissionCodes: options.permissions,
  });
  await assignRoleToMembership(env.db, ownerContext.actor, created.membershipId, role.id);
  if (options.branches !== undefined) {
    const memberships = await listMemberships(env.db, ownerContext.actor);
    const current =
      memberships.find((row) => row.membershipId === created.membershipId)?.branchAccess ?? [];
    for (const grant of current) {
      await revokeBranchAccess(env.db, ownerContext.actor, created.membershipId, grant.branchId);
    }
    for (const grant of options.branches) {
      await grantBranchAccess(env.db, ownerContext.actor, created.membershipId, grant.branchId, {
        accessMode: grant.accessMode,
      });
    }
  }
  const headers = await signInHeaders(env.auth, {
    email: options.email,
    password: "password-123",
  });
  return { userId: created.userId, membershipId: created.membershipId, headers };
}

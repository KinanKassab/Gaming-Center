/**
 * Restricted request-path role (`gaming_app`) provisioning.
 *
 * getSafeRuntimeDb() is defense in depth. Migrations/provisioning must pin
 * the role or fail closed — they must not assume ALTER ROLE succeeded.
 */

export const RUNTIME_DB_ROLE = "gaming_app";

export const PIN_RUNTIME_ROLE_SQL =
  "ALTER ROLE gaming_app WITH NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT LOGIN";

export type NamedRoleAttributes = {
  roleName: string;
  isSuperuser: boolean;
  hasBypassRls: boolean;
  canCreateDb: boolean;
  canCreateRole: boolean;
  inherits: boolean;
  canLogin: boolean;
};

export type RuntimeRoleAttributes = NamedRoleAttributes & {
  currentUser: string;
};

export function pgCatalogFlag(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1 || value === "1";
}

export function mapPgRoleRow(row: {
  rolname: string;
  rolsuper: unknown;
  rolbypassrls: unknown;
  rolcreatedb: unknown;
  rolcreaterole: unknown;
  rolinherit: unknown;
  rolcanlogin: unknown;
}): NamedRoleAttributes {
  return {
    roleName: String(row.rolname),
    isSuperuser: pgCatalogFlag(row.rolsuper),
    hasBypassRls: pgCatalogFlag(row.rolbypassrls),
    canCreateDb: pgCatalogFlag(row.rolcreatedb),
    canCreateRole: pgCatalogFlag(row.rolcreaterole),
    inherits: pgCatalogFlag(row.rolinherit),
    canLogin: pgCatalogFlag(row.rolcanlogin),
  };
}

export function unsafeRuntimeRoleReasons(attributes: NamedRoleAttributes): string[] {
  const reasons: string[] = [];
  if (attributes.isSuperuser) reasons.push("SUPERUSER");
  if (attributes.hasBypassRls) reasons.push("BYPASSRLS");
  if (attributes.canCreateDb) reasons.push("CREATEDB");
  if (attributes.canCreateRole) reasons.push("CREATEROLE");
  if (attributes.inherits) reasons.push("INHERIT");
  if (!attributes.canLogin) reasons.push("NOLOGIN");
  return reasons;
}

export function expectedRuntimeDbRole(): string {
  const configured = process.env.RUNTIME_DB_ROLE?.trim();
  return configured && configured.length > 0 ? configured : RUNTIME_DB_ROLE;
}

export function assertPinnedRuntimeRoleAttributes(
  attributes: NamedRoleAttributes,
  expectedRole = expectedRuntimeDbRole(),
): void {
  if (attributes.roleName !== expectedRole) {
    throw new Error(
      `Unsafe runtime database role: catalog role "${attributes.roleName}", expected "${expectedRole}".`,
    );
  }
  const reasons = unsafeRuntimeRoleReasons(attributes);
  if (reasons.length > 0) {
    throw new Error(
      `Unsafe runtime database role "${attributes.roleName}": ${reasons.join(", ")}. Required attributes: NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT LOGIN.`,
    );
  }
}

export const RUNTIME_ROLE_PROVISIONING_HINT =
  "The privileged migration/provisioning connection must be allowed to ALTER ROLE gaming_app, or gaming_app must already be NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT LOGIN. getSafeRuntimeDb() is defense in depth, not a substitute for provisioning.";

/**
 * Try to pin gaming_app, then verify catalog attributes.
 * A refused ALTER ROLE is not treated as success. If the role is already
 * safe, provisioning continues. If it remains unsafe, fail closed.
 */
export async function pinOrAssertRuntimeRole(exec: {
  tryAlter: () => Promise<void>;
  readNamedRole: () => Promise<NamedRoleAttributes | undefined>;
}): Promise<{ attributes: NamedRoleAttributes; alterSucceeded: boolean }> {
  let alterSucceeded = false;
  let alterError: unknown;
  try {
    await exec.tryAlter();
    alterSucceeded = true;
  } catch (error) {
    alterError = error;
  }

  const attributes = await exec.readNamedRole();
  if (!attributes) {
    throw new Error(
      `gaming_app role is missing after migrate. ${RUNTIME_ROLE_PROVISIONING_HINT}`,
    );
  }

  try {
    assertPinnedRuntimeRoleAttributes(attributes);
  } catch (error) {
    const alterDetail = alterSucceeded
      ? "ALTER ROLE reported success but pg_roles is still unsafe."
      : `ALTER ROLE did not succeed (${alterError instanceof Error ? alterError.message : String(alterError)}). Do not assume the role was pinned.`;
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} ${alterDetail} ${RUNTIME_ROLE_PROVISIONING_HINT}`,
    );
  }

  return { attributes, alterSucceeded };
}

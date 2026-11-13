import { describe, expect, it } from "vitest";
import {
  PIN_RUNTIME_ROLE_SQL,
  assertPinnedRuntimeRoleAttributes,
  mapPgRoleRow,
  pinOrAssertRuntimeRole,
  unsafeRuntimeRoleReasons,
  type NamedRoleAttributes,
} from "@/db/runtime-role";
import { createMigratedPglite } from "../helpers/pglite";

const SAFE: NamedRoleAttributes = {
  roleName: "gaming_app",
  isSuperuser: false,
  hasBypassRls: false,
  canCreateDb: false,
  canCreateRole: false,
  inherits: false,
  canLogin: true,
};

describe("runtime role provisioning", () => {
  it("requires the documented ALTER ROLE pin statement", () => {
    expect(PIN_RUNTIME_ROLE_SQL).toContain("NOSUPERUSER");
    expect(PIN_RUNTIME_ROLE_SQL).toContain("NOBYPASSRLS");
    expect(PIN_RUNTIME_ROLE_SQL).toContain("NOCREATEDB");
    expect(PIN_RUNTIME_ROLE_SQL).toContain("NOCREATEROLE");
    expect(PIN_RUNTIME_ROLE_SQL).toContain("NOINHERIT");
    expect(PIN_RUNTIME_ROLE_SQL).toContain("LOGIN");
  });

  it("accepts a fully restricted gaming_app", () => {
    expect(() => assertPinnedRuntimeRoleAttributes(SAFE)).not.toThrow();
    expect(unsafeRuntimeRoleReasons(SAFE)).toEqual([]);
  });

  it.each([
    [{ isSuperuser: true }, "SUPERUSER"],
    [{ hasBypassRls: true }, "BYPASSRLS"],
    [{ canCreateDb: true }, "CREATEDB"],
    [{ canCreateRole: true }, "CREATEROLE"],
    [{ inherits: true }, "INHERIT"],
    [{ canLogin: false }, "NOLOGIN"],
  ] satisfies Array<[Partial<NamedRoleAttributes>, string]>)(
    "rejects unsafe attribute %s",
    (mutation, reason) => {
      expect(() => assertPinnedRuntimeRoleAttributes({ ...SAFE, ...mutation })).toThrow(
        new RegExp(reason),
      );
    },
  );

  it("fails closed when ALTER ROLE is refused and gaming_app remains unsafe", async () => {
    await expect(
      pinOrAssertRuntimeRole({
        tryAlter: async () => {
          throw new Error("permission denied to alter role");
        },
        readNamedRole: async () => ({ ...SAFE, isSuperuser: true }),
      }),
    ).rejects.toThrow(/Do not assume the role was pinned|SUPERUSER|unsafe/i);
  });

  it("fails closed when ALTER ROLE is refused and gaming_app has BYPASSRLS", async () => {
    await expect(
      pinOrAssertRuntimeRole({
        tryAlter: async () => {
          throw new Error("insufficient_privilege");
        },
        readNamedRole: async () => ({ ...SAFE, hasBypassRls: true }),
      }),
    ).rejects.toThrow(/BYPASSRLS/);
  });

  it("does not treat a refused ALTER ROLE as success when the role is already safe", async () => {
    const result = await pinOrAssertRuntimeRole({
      tryAlter: async () => {
        throw new Error("Could not ALTER ROLE gaming_app (insufficient privilege on this connection)");
      },
      readNamedRole: async () => SAFE,
    });
    expect(result.alterSucceeded).toBe(false);
    expect(result.attributes).toEqual(SAFE);
  });

  it("fails closed when the role is missing after migrate", async () => {
    await expect(
      pinOrAssertRuntimeRole({
        tryAlter: async () => undefined,
        readNamedRole: async () => undefined,
      }),
    ).rejects.toThrow(/gaming_app role is missing/);
  });

  it("migration 0004 leaves PGlite gaming_app restricted", async () => {
    const { client } = await createMigratedPglite();
    const rows = await client.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolinherit: boolean;
      rolcanlogin: boolean;
    }>(
      `SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolcanlogin
       FROM pg_roles WHERE rolname = 'gaming_app'`,
    );
    expect(rows.rows).toHaveLength(1);
    assertPinnedRuntimeRoleAttributes(mapPgRoleRow(rows.rows[0]!));
  });
});

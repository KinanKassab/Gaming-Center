import postgres from "postgres";
import { parseDatabaseUrl } from "@/core/env";
import { migrationsDirectory } from "@/db/migrate";
import { requireMigrationDatabaseUrl } from "@/db/client";
import { migrationPostgresClientOptions } from "@/db/connection-mode";
import {
  PIN_RUNTIME_ROLE_SQL,
  mapPgRoleRow,
  pinOrAssertRuntimeRole,
} from "@/db/runtime-role";

async function main(): Promise<void> {
  const url = requireMigrationDatabaseUrl();
  const sql = postgres(url, migrationPostgresClientOptions(parseDatabaseUrl(url)));
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    const done = await sql<{ id: string }[]>`SELECT id FROM schema_migrations`;
    const applied = new Set(done.map((row) => row.id));
    const names = (await import("node:fs/promises")).readdir;
    const files = (await names(migrationsDirectory()))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const ran: string[] = [];
    for (const name of files) {
      if (applied.has(name)) {
        continue;
      }
      const { readFile } = await import("node:fs/promises");
      const path = await import("node:path");
      const text = await readFile(path.join(migrationsDirectory(), name), "utf8");
      await sql.unsafe(text);
      await sql`INSERT INTO schema_migrations (id) VALUES (${name})`;
      ran.push(name);
    }
    const pinned = await pinOrAssertRuntimeRole({
      tryAlter: async () => {
        await sql.unsafe(PIN_RUNTIME_ROLE_SQL);
      },
      readNamedRole: async () => {
        const rows = await sql<
          {
            rolname: string;
            rolsuper: boolean;
            rolbypassrls: boolean;
            rolcreatedb: boolean;
            rolcreaterole: boolean;
            rolinherit: boolean;
            rolcanlogin: boolean;
          }[]
        >`
          SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolcanlogin
          FROM pg_roles
          WHERE rolname = 'gaming_app'
        `;
        return rows[0] ? mapPgRoleRow(rows[0]) : undefined;
      },
    });
    console.log(ran.length === 0 ? "Migrations already applied." : `Applied: ${ran.join(", ")}`);
    console.log(
      pinned.alterSucceeded
        ? "gaming_app attributes pinned by this connection."
        : "gaming_app attributes already safe (ALTER ROLE not granted on this connection).",
    );
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

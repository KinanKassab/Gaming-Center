import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { appSchema } from "@/db/client";
import { applyAllSqlMigrations } from "@/db/migrate";

export async function createMigratedPglite() {
  const client = new PGlite();
  const dir = path.resolve(process.cwd(), "drizzle");
  await applyAllSqlMigrations((sql) => client.exec(sql), dir);
  const db = drizzle({ client, schema: appSchema });
  return { client, db };
}

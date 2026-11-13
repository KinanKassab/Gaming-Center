import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export function migrationsDirectory(): string {
  return path.resolve(process.cwd(), "drizzle");
}

export async function applyAllSqlMigrations(
  exec: (sql: string) => Promise<unknown>,
  migrationsDir = migrationsDirectory(),
): Promise<string[]> {
  const names = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const applied: string[] = [];
  for (const name of names) {
    const sql = await readFile(path.join(migrationsDir, name), "utf8");
    await exec(sql);
    applied.push(name);
  }
  return applied;
}

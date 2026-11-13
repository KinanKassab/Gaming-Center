import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseDatabaseUrl } from "@/core/env";
import { assertBackupConnectionAllowed } from "@/db/connection-mode";

const CANDIDATE_DUMPS = [
  process.env.PG_DUMP,
  "pg_dump",
  "C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe",
  "C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe",
  "C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe",
].filter((value): value is string => Boolean(value));

const CANDIDATE_RESTORES = [
  process.env.PG_RESTORE,
  "pg_restore",
  "C:\\Program Files\\PostgreSQL\\18\\bin\\pg_restore.exe",
  "C:\\Program Files\\PostgreSQL\\17\\bin\\pg_restore.exe",
  "C:\\Program Files\\PostgreSQL\\16\\bin\\pg_restore.exe",
].filter((value): value is string => Boolean(value));

function firstExisting(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (candidate === "pg_dump" || candidate === "pg_restore") {
      const probe = spawnSync(candidate, ["--version"], { encoding: "utf8", windowsHide: true });
      if (probe.status === 0) return candidate;
      continue;
    }
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function findPgDump(): string | null {
  return firstExisting(CANDIDATE_DUMPS);
}

export function findPgRestore(): string | null {
  const restore = firstExisting(CANDIDATE_RESTORES);
  if (restore) return restore;
  const dump = findPgDump();
  if (dump && dump.endsWith("pg_dump.exe")) {
    const sibling = path.join(path.dirname(dump), "pg_restore.exe");
    if (existsSync(sibling)) return sibling;
  }
  if (dump === "pg_dump") return "pg_restore";
  return null;
}

function runTool(command: string, args: string[]): void {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    const stderr = (result.stderr || result.stdout || "no output").slice(0, 500);
    throw new Error(`${path.basename(command)} failed: ${stderr.replace(/:[^:@/]+@/g, ":***@")}`);
  }
}

export function dumpDatabase(databaseUrl: string, filePath: string, extraArgs: string[] = []): void {
  assertBackupConnectionAllowed(parseDatabaseUrl(databaseUrl));
  const dump = findPgDump();
  if (!dump) {
    throw new Error(
      "BLOCKED BY ENVIRONMENT: pg_dump was not found. Install PostgreSQL client tools or set PG_DUMP. Restore drill cannot run.",
    );
  }
  runTool(dump, ["--format=custom", "--no-owner", ...extraArgs, "--file", filePath, databaseUrl]);
}

export function restoreDatabase(databaseUrl: string, filePath: string, extraArgs: string[] = []): void {
  assertBackupConnectionAllowed(parseDatabaseUrl(databaseUrl));
  const restore = findPgRestore();
  if (!restore) {
    throw new Error(
      "BLOCKED BY ENVIRONMENT: pg_restore was not found. Install PostgreSQL client tools or set PG_RESTORE.",
    );
  }
  runTool(restore, ["--no-owner", "--exit-on-error", ...extraArgs, "--dbname", databaseUrl, filePath]);
}

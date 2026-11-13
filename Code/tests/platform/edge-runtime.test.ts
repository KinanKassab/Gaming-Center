import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

describe("Node vs Edge runtime", () => {
  it("does not export Edge runtime from DB-touching app routes (middleware is Edge-safe and has no PostgreSQL)", () => {
    const appDir = path.resolve(process.cwd(), "src/app");
    const middleware = path.resolve(process.cwd(), "src/middleware.ts");
    const files = [...walk(appDir), middleware];
    const edgeFiles: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (/export\s+const\s+runtime\s*=\s*["']edge["']/.test(source)) {
        const rel = path.relative(process.cwd(), file).replaceAll("\\", "/");
        if (rel === "src/middleware.ts") continue;
        edgeFiles.push(rel);
      }
    }
    expect(edgeFiles).toEqual([]);

    const middlewareSource = readFileSync(middleware, "utf8");
    expect(middlewareSource).not.toMatch(/postgres|drizzle|getSafeRuntimeDb|DATABASE_URL/);
  });
});

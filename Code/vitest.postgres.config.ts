import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Real PostgreSQL security suite only. Used by `npm run test:postgres`.
 * `npm test` keeps using vitest.config.ts, which excludes this file.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/security/postgres-live.test.ts"],
    // Do not inherit vitest.config.ts exclude. Missing file must fail, not pass.
    passWithNoTests: false,
    fileParallelism: false,
    testTimeout: 180000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Hosted Supabase compatibility suite only. Used by `npm run test:supabase`.
 * Independent of `npm run test:postgres` (local disposable DB).
 * `npm test` excludes this file.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/security/supabase-hosted.test.ts"],
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

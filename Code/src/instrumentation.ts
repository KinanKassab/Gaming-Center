/**
 * Next.js server bootstrap. Production environment checks run here so a
 * misconfigured process fails before serving traffic.
 *
 * `next build` sets NODE_ENV=production but NEXT_PHASE=phase-production-build;
 * env assertion is skipped for that phase so compile stays credential-free.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertRuntimeEnvironment } = await import("@/core/env");
  assertRuntimeEnvironment();
}

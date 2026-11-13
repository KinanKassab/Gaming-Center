import {
  APPROVED_DISPOSABLE_TEST_DATABASE,
  assertDisposableTestResetAllowed,
} from "./disposable-test-db";

/** Browser fixture resets are restricted to the named database on loopback. */
export function assertLocalBrowserFixtureTarget(databaseUrl: string | undefined, allowReset: string | undefined) {
  assertDisposableTestResetAllowed({ databaseUrl, allowReset });
  let url: URL;
  try {
    url = new URL(databaseUrl ?? "");
  } catch {
    throw new Error("REFUSED BROWSER FIXTURE RESET: invalid PostgreSQL URL");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "::1", "localhost"].includes(url.hostname.toLowerCase())) {
    throw new Error("REFUSED BROWSER FIXTURE RESET: PostgreSQL host must be loopback");
  }
  return APPROVED_DISPOSABLE_TEST_DATABASE;
}

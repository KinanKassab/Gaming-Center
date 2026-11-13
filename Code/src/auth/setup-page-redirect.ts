/**
 * Closed/unavailable /setup must leave with a body-discarding HTTP redirect.
 *
 * `redirect()` from `next/navigation` always throws TemporaryRedirect (307) in
 * Server Components. 307/308 replay POST + body (BUG-029). Next.js only emits
 * 303 automatically for Server Actions. Closed bootstrap never renders
 * SetupForm, so there is no Server Action on that path.
 *
 * `getRedirectError(..., RedirectStatusCode.SeeOther)` is the same helper
 * `redirect()` uses, with the See Other status Next.js already defines.
 */
import { RedirectType } from "next/navigation";
import { getRedirectError } from "next/dist/client/components/redirect";
import { RedirectStatusCode } from "next/dist/client/components/redirect-status-code";

export function redirectDiscardingRequestBody(url: string): never {
  throw getRedirectError(url, RedirectType.replace, RedirectStatusCode.SeeOther);
}

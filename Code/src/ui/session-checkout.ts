/**
 * Floor End → checkout navigation. Presentation only.
 * Uses the session id returned by End. Does not create payments or re-query.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sessionCheckoutPath(sessionId: string): string {
  return `/admin/gaming/sessions/${sessionId}/checkout`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Reads `data.id` from the End JSON body `{ data: session }`. */
export function sessionIdFromEndResponse(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const data = body.data;
  if (!isRecord(data)) return null;
  const id = data.id;
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) return null;
  return id;
}

/**
 * Checkout href after a successful End. `expectedSessionId` is the session the
 * operator posted to; a mismatched returned id is refused rather than guessed.
 */
export function endedSessionCheckoutHref(body: unknown, expectedSessionId?: string): string | null {
  const id = sessionIdFromEndResponse(body);
  if (!id) return null;
  if (expectedSessionId && id !== expectedSessionId) return null;
  return sessionCheckoutPath(id);
}

/** Failure never navigates. Success navigates only when the ended session id is present. */
export function endSessionSuccessHref(input: {
  ok: boolean;
  body: unknown;
  expectedSessionId?: string;
}): string | null {
  if (!input.ok) return null;
  return endedSessionCheckoutHref(input.body, input.expectedSessionId);
}

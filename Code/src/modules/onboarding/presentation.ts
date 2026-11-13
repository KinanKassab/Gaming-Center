import type { NextResponse } from "next/server";

/**
 * Presentation-only Guided Setup completion. Independent of operational
 * readiness. Never used for authentication or authorization. No progress table.
 */
export const GUIDED_SETUP_DONE_COOKIE = "gc_guided_setup_done";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DONE_ORGS = 32;

export function guidedSetupCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 400,
  };
}

export function parseGuidedSetupDoneOrgIds(value: string | null | undefined): string[] {
  if (!value) return [];
  const ids: string[] = [];
  for (const part of value.split(",")) {
    const id = part.trim().toLowerCase();
    if (!UUID_PATTERN.test(id)) continue;
    if (ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= MAX_DONE_ORGS) break;
  }
  return ids;
}

export function isGuidedSetupCompleteForOrg(
  cookieValue: string | null | undefined,
  organizationId: string,
): boolean {
  if (!UUID_PATTERN.test(organizationId)) return false;
  return parseGuidedSetupDoneOrgIds(cookieValue).includes(organizationId.toLowerCase());
}

export function appendGuidedSetupDoneOrg(
  cookieValue: string | null | undefined,
  organizationId: string,
): string {
  const id = organizationId.trim().toLowerCase();
  if (!UUID_PATTERN.test(id)) return parseGuidedSetupDoneOrgIds(cookieValue).join(",");
  const ids = parseGuidedSetupDoneOrgIds(cookieValue);
  if (ids.includes(id)) return ids.join(",");
  return [...ids, id].slice(0, MAX_DONE_ORGS).join(",");
}

/**
 * Overlay / Continue Setup stay on the dashboard only while required setup is
 * still incomplete. Operationally ready (or Finish recorded) hides the prompt.
 */
export function shouldPresentGuidedSetup(input: {
  completed: boolean;
  operationallyReady?: boolean;
}): boolean {
  if (input.completed) return false;
  if (input.operationallyReady) return false;
  return true;
}

/**
 * Auto-open only while required setup is still incomplete.
 * Operationally ready but unfinished: Continue Setup, no auto-popup.
 */
export function shouldAutoOpenGuidedSetup(input: {
  completed: boolean;
  operationallyReady: boolean;
}): boolean {
  if (input.completed) return false;
  return !input.operationallyReady;
}

export function applyGuidedSetupDoneCookie(response: NextResponse, value: string): void {
  response.cookies.set(GUIDED_SETUP_DONE_COOKIE, value, guidedSetupCookieOptions());
}

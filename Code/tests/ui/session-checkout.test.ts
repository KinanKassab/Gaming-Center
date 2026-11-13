import { describe, expect, it } from "vitest";
import {
  endSessionSuccessHref,
  endedSessionCheckoutHref,
  sessionCheckoutPath,
  sessionIdFromEndResponse,
} from "@/ui/session-checkout";

const SESSION_ID = "01a04e0b-08db-7c90-0744-1f4648cecd94";

describe("end session checkout navigation (BUG-007)", () => {
  it("reads the ended session id from the End API body and builds checkout", () => {
    const body = { data: { id: SESSION_ID, status: "COMPLETED" } };
    expect(sessionIdFromEndResponse(body)).toBe(SESSION_ID);
    expect(endedSessionCheckoutHref(body)).toBe(`/admin/gaming/sessions/${SESSION_ID}/checkout`);
    expect(sessionCheckoutPath(SESSION_ID)).toBe(`/admin/gaming/sessions/${SESSION_ID}/checkout`);
  });

  it("refuses to navigate when End fails", () => {
    expect(
      endSessionSuccessHref({
        ok: false,
        body: { data: { id: SESSION_ID } },
        expectedSessionId: SESSION_ID,
      }),
    ).toBeNull();
  });

  it("navigates on success only when the returned id matches the ended session", () => {
    const body = { data: { id: SESSION_ID } };
    expect(endSessionSuccessHref({ ok: true, body, expectedSessionId: SESSION_ID })).toBe(
      `/admin/gaming/sessions/${SESSION_ID}/checkout`,
    );
    expect(
      endSessionSuccessHref({
        ok: true,
        body,
        expectedSessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      }),
    ).toBeNull();
  });

  it("does not guess an id from a malformed End body", () => {
    expect(sessionIdFromEndResponse(null)).toBeNull();
    expect(sessionIdFromEndResponse({})).toBeNull();
    expect(sessionIdFromEndResponse({ data: { id: "not-a-uuid" } })).toBeNull();
    expect(endedSessionCheckoutHref({ data: {} }, SESSION_ID)).toBeNull();
  });
});

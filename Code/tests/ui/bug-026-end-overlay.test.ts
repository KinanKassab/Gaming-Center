import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { endedSessionCheckoutHref } from "@/ui/session-checkout";

const root = resolve(__dirname, "../../src");

function source(relative: string): string {
  return readFileSync(resolve(root, relative), "utf8");
}

function endControlSource(): string {
  const text = source("app/admin/gaming/_components/floor-device-actions.tsx");
  const start = text.indexOf("function EndSessionControl");
  const cancel = text.indexOf("function CancelSessionControl");
  expect(start).toBeGreaterThan(-1);
  expect(cancel).toBeGreaterThan(start);
  return text.slice(start, cancel);
}

describe("BUG-026 Floor End uses shared Overlay", () => {
  it("opens End confirmation through ConfirmDialog Overlay, not an inline tile prompt", () => {
    const end = endControlSource();
    expect(end).toContain("<ConfirmDialog");
    expect(end).toContain('t("floor.endConfirm")');
    expect(end).toContain('t("floor.confirmEnd")');
    expect(end).toContain('t("floor.keepSession")');
    expect(end).not.toContain("window.confirm");
    expect(end).not.toContain("role=\"alertdialog\"");
    const overlay = source("app/_components/overlay.tsx");
    expect(overlay).toContain("createPortal");
    expect(overlay).toContain("document.body");
    expect(overlay).toContain('event.key === "Escape"');
    expect(overlay).toContain("previousFocus.current?.focus()");
    expect(overlay).toContain("lockScroll");
    expect(overlay).toContain('role={role}');
    expect(overlay).toContain('aria-modal="true"');
    expect(source("app/_components/confirm-dialog.tsx")).toContain('role="alertdialog"');
    expect(source("app/_components/confirm-dialog.tsx")).toContain("labelledBy={titleId}");
    expect(source("app/_components/confirm-dialog.tsx")).toContain("describedBy={bodyId}");
  });

  it("confirms End and does not call Cancel Session", () => {
    const end = endControlSource();
    expect(end).toContain(`/api/gaming/sessions/\${props.sessionId}/end`);
    expect(end).not.toContain("/cancel");
    expect(end).not.toContain("reason");
    expect(end).toContain("endedSessionCheckoutHref(result.body, props.sessionId)");
    expect(end).toContain("router.push(href)");
    expect(end).toContain("onCancel={close}");
    const cancel = source("app/admin/gaming/_components/floor-device-actions.tsx");
    expect(cancel).toContain("function CancelSessionControl");
    expect(cancel).toContain(`/api/gaming/sessions/\${props.sessionId}/cancel`);
  });

  it("keeps BUG-007 checkout navigation for a successful End body", () => {
    const sessionId = "01a04e0b-08db-7c90-0744-1f4648cecd94";
    expect(endedSessionCheckoutHref({ data: { id: sessionId } }, sessionId)).toBe(
      `/admin/gaming/sessions/${sessionId}/checkout`,
    );
  });
});

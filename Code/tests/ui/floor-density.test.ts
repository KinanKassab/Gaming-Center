import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../src");

function source(relative: string): string {
  return readFileSync(resolve(root, relative), "utf8");
}

describe("Gaming Floor density and Cancel (BUG-015)", () => {
  it("keeps Pause, Resume, End, and Move as primary occupied-tile actions", () => {
    const text = source("app/admin/gaming/_components/floor-device-actions.tsx");
    expect(text).toContain("floor-tile-primary");
    expect(text).toContain('t("floor.pause")');
    expect(text).toContain('t("floor.resume")');
    expect(text).toContain('t("floor.end")');
    expect(text).toContain('t("floor.move")');
    expect(text).toContain("EndSessionControl");
    expect(text).toContain("endedSessionCheckoutHref");
  });

  it("does not keep the cancellation reason textarea on the Floor tile", () => {
    const text = source("app/admin/gaming/_components/floor-device-actions.tsx");
    expect(text).not.toMatch(/fields=\{\[\{ name: "reason"/);
    expect(text).not.toContain('type: "textarea"');
    expect(text).toContain("floor-cancel-trigger");
    expect(text).toContain("CancelSessionControl");
  });

  it("opens Cancel in a destructive overlay with the reason field inside", () => {
    const text = source("app/admin/gaming/_components/floor-device-actions.tsx");
    expect(text).toContain("<Overlay");
    expect(text).toContain('role="alertdialog"');
    expect(text).toContain('t("sessions.reason")');
    expect(text).toContain('t("floor.keepSession")');
    expect(text).toContain('t("sessions.cancelSubmit")');
    expect(text).toContain('name="reason"');
    expect(text).toContain(`/api/gaming/sessions/\${props.sessionId}/cancel`);
    expect(text).toContain("body: { reason: trimmed }");
  });

  it("lets available cards size to their own content instead of stretching with occupied cards", () => {
    const css = readFileSync(resolve(root, "app/globals.css"), "utf8");
    expect(css).toMatch(/\.floor-grid\s*\{[^}]*align-items:\s*start/s);
    expect(css).toMatch(/\.floor-tile\s*\{[^}]*align-self:\s*start/s);
    expect(css).toMatch(/\.floor-tile\s*\{[^}]*height:\s*auto/s);
  });
});

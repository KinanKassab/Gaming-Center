import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { placeFieldHelpPanel, readDocumentDir } from "@/ui/field-help-placement";

const root = resolve(__dirname, "../../src");

function source(relative: string): string {
  return readFileSync(resolve(root, relative), "utf8");
}

const trigger = (left: number, width = 44, top = 80): Parameters<typeof placeFieldHelpPanel>[0]["trigger"] => ({
  top,
  left,
  width,
  height: 44,
  right: left + width,
  bottom: top + 44,
});

describe("FieldHelp placement (BUG-014)", () => {
  it("flips RTL help near the physical left edge so the panel stays in view", () => {
    const placed = placeFieldHelpPanel({
      trigger: trigger(8),
      panelSize: { width: 288, height: 200 },
      viewport: { width: 800, height: 600 },
      dir: "rtl",
    });
    expect(placed.left).toBeGreaterThanOrEqual(8);
    expect(placed.left + placed.width).toBeLessThanOrEqual(792);
    expect(placed.inlineAlign).toBe("end");
    expect(placed.blockAlign).toBe("below");
  });

  it("flips LTR help near the physical right edge so the panel stays in view", () => {
    const placed = placeFieldHelpPanel({
      trigger: trigger(748),
      panelSize: { width: 288, height: 200 },
      viewport: { width: 800, height: 600 },
      dir: "ltr",
    });
    expect(placed.left).toBeGreaterThanOrEqual(8);
    expect(placed.left + placed.width).toBeLessThanOrEqual(792);
    expect(placed.inlineAlign).toBe("end");
  });

  it("keeps preferred inline-start placement when there is room", () => {
    const ltr = placeFieldHelpPanel({
      trigger: trigger(40),
      panelSize: { width: 288, height: 180 },
      viewport: { width: 1280, height: 800 },
      dir: "ltr",
    });
    expect(ltr.inlineAlign).toBe("start");
    expect(ltr.left).toBe(40);

    const rtl = placeFieldHelpPanel({
      trigger: trigger(900),
      panelSize: { width: 288, height: 180 },
      viewport: { width: 1280, height: 800 },
      dir: "rtl",
    });
    expect(rtl.inlineAlign).toBe("start");
    expect(rtl.left).toBe(900 + 44 - 288);
  });

  it("opens above the trigger when there is no room below, including above a bottom nav inset", () => {
    const placed = placeFieldHelpPanel({
      trigger: trigger(40, 44, 520),
      panelSize: { width: 288, height: 220 },
      viewport: { width: 390, height: 844 },
      dir: "ltr",
      bottomInset: 80,
    });
    expect(placed.blockAlign).toBe("above");
    expect(placed.top).toBeGreaterThanOrEqual(8);
    expect(placed.top + Math.min(220, placed.maxHeight)).toBeLessThanOrEqual(844 - 8 - 80);
  });

  it("clamps into a tiny viewport instead of overflowing", () => {
    const placed = placeFieldHelpPanel({
      trigger: trigger(10, 40, 10),
      panelSize: { width: 320, height: 400 },
      viewport: { width: 360, height: 500 },
      dir: "rtl",
    });
    expect(placed.left).toBeGreaterThanOrEqual(8);
    expect(placed.left + placed.width).toBeLessThanOrEqual(352);
    expect(placed.top).toBeGreaterThanOrEqual(8);
  });

  it("reads html dir without inventing a third direction", () => {
    expect(readDocumentDir("rtl")).toBe("rtl");
    expect(readDocumentDir("ltr")).toBe("ltr");
    expect(readDocumentDir("")).toBe("ltr");
  });
});

describe("FieldHelp trigger behavior is preserved (BUG-014)", () => {
  it("keeps the i button as the only interactive trigger", () => {
    const text = source("app/_components/field-help.tsx");
    expect(text).toContain('className="icon-btn field-help-trigger"');
    expect(text).toContain("<span className=\"field-help\"");
    expect(text).toContain("canHoverFine()");
    expect(text).toContain('event.key === "Escape"');
    expect(text).toContain("skipFocusOpen");
    expect(text).toContain("setPinned(true)");
    expect(text).toContain("setOpen(true)");
    expect(text).toContain("aria-expanded={open}");
    expect(text).toContain("aria-controls={panelId}");
    expect(text).toContain('role="note"');
    expect(text).not.toMatch(/<button[^>]*className="field-help"/);
  });

  it("positions with collision-aware fixed coordinates instead of a global overflow visible rule", () => {
    const help = source("app/_components/field-help.tsx");
    const css = readFileSync(resolve(root, "app/globals.css"), "utf8");
    expect(help).toContain("placeFieldHelpPanel(");
    expect(help).toContain("data-inline-align");
    expect(css).toMatch(/\.field-help-panel\s*\{[^}]*position:\s*fixed/s);
    expect(css).not.toMatch(/\.app-workspace\s*\{[^}]*overflow:\s*visible/s);
  });
});

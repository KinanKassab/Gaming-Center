import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const app = resolve(__dirname, "../../src/app");

describe("BUG-021 favicon", () => {
  it("ships app/favicon.ico so browsers do not 404 the default icon request", () => {
    const ico = resolve(app, "favicon.ico");
    expect(existsSync(ico)).toBe(true);
    expect(statSync(ico).size).toBeGreaterThan(32);
    const bytes = readFileSync(ico);
    expect(bytes[2]).toBe(1);
    expect(bytes[4]).toBe(1);
  });

  it("also ships a brand-neutral SVG icon without manufacturer marks", () => {
    const svgPath = resolve(app, "icon.svg");
    expect(existsSync(svgPath)).toBe(true);
    const svg = readFileSync(svgPath, "utf8");
    expect(svg).toContain("<svg");
    expect(svg.toLowerCase()).not.toContain("playstation");
    expect(svg.toLowerCase()).not.toContain("xbox");
    expect(svg.toLowerCase()).not.toContain("nintendo");
  });
});

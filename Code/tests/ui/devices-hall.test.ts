import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../src");

function source(relative: string): string {
  return readFileSync(resolve(root, relative), "utf8");
}

describe("devices hall merge", () => {
  it("merges types into devices like the wizard and does not render a separate add card", () => {
    const page = source("app/admin/gaming/devices/page.tsx");
    expect(page).toContain("HallDevicesHost");
    expect(page).not.toContain("DeviceAddCard");
    expect(page).not.toContain("devices.addSeveral");
    expect(source("app/admin/gaming/_components/hall-devices-host.tsx")).toContain(
      "onSaveChanges={saveChanges}",
    );
    expect(source("app/admin/gaming/_components/gaming-nav.tsx")).not.toContain("/admin/gaming/device-types");
    expect(source("app/admin/gaming/device-types/page.tsx")).toContain("HardRedirect");
  });

  it("lightens the drawer backdrop hover instead of using the primary button hover", () => {
    const css = source("app/globals.css");
    expect(css).toContain("--drawer-scrim");
    expect(css).toContain(".drawer-backdrop:hover:not(:disabled)");
    expect(css).toContain("var(--drawer-scrim-hover)");
  });
});

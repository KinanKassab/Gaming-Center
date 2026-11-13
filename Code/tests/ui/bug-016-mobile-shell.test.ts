import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkoutHistoryLayout } from "@/ui/shell-layout";

const root = resolve(__dirname, "../../src");

function source(relative: string): string {
  return readFileSync(resolve(root, relative), "utf8");
}

describe("mobile checkout and topbar wiring (BUG-016)", () => {
  it("renders compact icon language, theme, and sign-out in the compact topbar", () => {
    const shell = source("app/admin/_components/admin-shell.tsx");
    expect(shell).toContain('variant="icon"');
    expect(shell).toContain("<SignOutButton variant=\"icon\" />");
    expect(shell).toContain("app-topbar-prefs-compact");
    expect(shell).toContain("app-topbar-prefs-desktop");
    expect(source("app/admin/_components/language-switcher.tsx")).toContain('variant === "icon"');
    expect(source("app/_components/theme-switcher.tsx")).toContain('variant === "icon"');
    expect(source("app/admin/_components/controls.tsx")).toContain('props.variant === "icon"');
  });

  it("uses DataTable mobile record cards for checkout payment history", () => {
    const page = source("app/admin/gaming/sessions/[sessionId]/checkout/page.tsx");
    expect(page).toContain("<CheckoutPaymentHistory");
    expect(page).not.toContain("<DataTable");
    expect(source("app/admin/gaming/_components/checkout-history.tsx")).toContain("<DataTable");
    expect(source("app/admin/gaming/_components/checkout-history.tsx")).toContain('key: "received"');
    expect(source("app/admin/gaming/_components/checkout-history.tsx")).toContain('key: "status"');
    expect(source("app/_components/data-table.tsx")).toContain("desktop-table");
    expect(source("app/_components/data-table.tsx")).toContain("record-cards");
    expect(checkoutHistoryLayout(390)).toBe("cards");
  });
});

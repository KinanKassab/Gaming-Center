import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hasDuplicateAccessibleName, joinDescribedBy, shouldOmitAriaLabelWhenVisibleLabelExists } from "@/ui/accessible-name";

const root = resolve(__dirname, "../../src");

function source(relative: string): string {
  return readFileSync(resolve(root, relative), "utf8");
}

describe("accessible names (BUG-020)", () => {
  it("treats a visible money label plus amount-in-currency aria-label as a duplicate name", () => {
    expect(
      hasDuplicateAccessibleName({
        visibleLabel: "المبلغ",
        ariaLabel: "المبلغ بعملة SYP",
      }),
    ).toBe(true);
    expect(
      hasDuplicateAccessibleName({
        visibleLabel: "Amount",
        ariaLabel: "Amount in SYP",
      }),
    ).toBe(true);
    expect(hasDuplicateAccessibleName({ visibleLabel: "Amount", ariaLabel: null })).toBe(false);
    expect(shouldOmitAriaLabelWhenVisibleLabelExists(true, "Amount in SYP")).toBe(true);
  });

  it("joins helper and error ids without duplicating tokens", () => {
    expect(joinDescribedBy("hint", "error")).toBe("hint error");
    expect(joinDescribedBy("hint error", "error", false, undefined)).toBe("hint error");
    expect(joinDescribedBy(null, false, "")).toBeUndefined();
  });

  it("names checkout amount from a visible FormField label, not a duplicate aria-label", () => {
    const form = source("app/admin/gaming/_components/checkout-form.tsx");
    const money = source("app/_components/money-input.tsx");
    expect(form).toContain('htmlFor={amountId}');
    expect(form).toContain('label={t("checkout.amount")}');
    expect(form).not.toContain("<label>");
    expect(money).not.toContain("aria-label");
    expect(money).toContain("aria-describedby");
    expect(money).toContain('aria-hidden="true"');
  });

  it("names the Floor customer selector once, with optional announced inside the label", () => {
    const floor = source("app/admin/gaming/_components/floor-device-actions.tsx");
    const field = source("app/_components/form-field.tsx");
    expect(floor).toContain('label: t("floor.customer")');
    expect(floor).toContain("optional: true");
    expect(floor).not.toContain('t("floor.customerOptional")');
    expect(field).toContain("form-field-optional");
    expect(field).toContain("<label htmlFor={controlId}");
  });

  it("gives Staff Email unique control ids so two Email labels cannot concatenate", () => {
    const controls = source("app/admin/_components/controls.tsx");
    expect(controls).toContain("const formId = useId()");
    expect(controls).toContain("`${formId}-${field.name}`");
    expect(controls).not.toContain("`api-field-${field.name}`");
    expect(source("app/admin/users/page.tsx")).toContain('label: t(locale, "users.email")');
  });

  it("connects FormField helper and error text through aria-describedby", () => {
    const field = source("app/_components/form-field.tsx");
    expect(field).toContain("joinDescribedBy");
    expect(field).toContain("helperId");
    expect(field).toContain("errorId");
    expect(field).toContain('role="alert"');
    expect(field).toContain("enhanceControl");
  });

  it("lets Combobox inherit a visible label via id instead of repeating aria-label", () => {
    const combo = source("app/_components/combobox.tsx");
    expect(combo).toContain("labelledBy");
    expect(combo).toContain("const inputId = props.id ?? listId");
    expect(combo).toMatch(/role="combobox"\r?\n\s*aria-expanded=\{open\}/);
    expect(combo).not.toMatch(/role="combobox"[\s\S]{0,120}aria-label=/);
  });

  it("announces login errors without moving focus or clearing entered credentials", () => {
    const login = source("app/login/login-form.tsx");
    expect(login).toContain('<p className="error" role="alert">{error}</p>');
    expect(login).toContain("onSubmit={onSubmit}");
    expect(login).toContain('name="email" type="email"');
    expect(login).toContain('name="password"');
    expect(login).toContain("disabled={busy}");
    expect(login).not.toMatch(/\.focus\(\)/);
    expect(login).not.toMatch(/form\.reset\(\)/);
    expect(login).not.toMatch(/autoFocus/i);
  });
});

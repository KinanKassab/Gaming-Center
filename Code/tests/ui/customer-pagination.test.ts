import { describe, expect, it } from "vitest";
import { customerPageHref } from "@/ui/customer-pagination";

describe("customer pagination URLs", () => {
  it("keeps search and status filters while changing pages", () => {
    const href = customerPageHref(3, "  Ahmad Ali  ", "BLOCKED");
    const parsed = new URL(href, "http://localhost");
    expect(parsed.pathname).toBe("/admin/customers");
    expect(parsed.searchParams.get("q")).toBe("Ahmad Ali");
    expect(parsed.searchParams.get("status")).toBe("BLOCKED");
    expect(parsed.searchParams.get("page")).toBe("3");
  });

  it("uses the canonical first page URL and omits empty filters", () => {
    expect(customerPageHref(1, "  ", undefined)).toBe("/admin/customers");
    expect(customerPageHref(1, "Ahmad", "ACTIVE")).toBe("/admin/customers?q=Ahmad&status=ACTIVE");
  });
});

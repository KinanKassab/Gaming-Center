import { describe, expect, it } from "vitest";
import { humanAuditAction } from "@/app/_lib/display";

const CURRENT_ACTIONS = [
  "core.organization.created",
  "core.customer.created",
  "core.branch_access.granted",
  "gaming.device.updated",
  "gaming.session.ended",
  "gaming.session.started",
  "finance.payment.completed",
  "finance.expense.posted",
] as const;

describe("BUG-012 audit action display mapping", () => {
  it("maps current and historical session-end keys to the same human labels", () => {
    expect(humanAuditAction("gaming.session.ended", "en")).toBe("Session ended");
    expect(humanAuditAction("gaming.session.completed", "en")).toBe("Session ended");
    expect(humanAuditAction("gaming.session.ended", "ar")).toBe("انتهت جلسة");
    expect(humanAuditAction("gaming.session.completed", "ar")).toBe("انتهت جلسة");
  });

  it("localizes currently emitted action values in Arabic and English", () => {
    for (const action of CURRENT_ACTIONS) {
      const arabic = humanAuditAction(action, "ar");
      const english = humanAuditAction(action, "en");
      expect(arabic).not.toBe(action);
      expect(english).not.toBe(action);
      expect(arabic).not.toMatch(/\./);
      expect(english).not.toMatch(/\./);
      expect(arabic).not.toBe(english);
    }
    expect(humanAuditAction("core.customer.created", "en")).toBe("Customer added");
    expect(humanAuditAction("core.branch_access.granted", "en")).toBe("Branch access granted");
    expect(humanAuditAction("gaming.device.updated", "en")).toBe("Device updated");
  });

  it("uses a readable fallback for unknown future actions", () => {
    expect(humanAuditAction("future.module.did_a_thing", "en")).toBe("Activity recorded");
    expect(humanAuditAction("future.module.did_a_thing", "ar")).toBe("تم تسجيل نشاط");
    expect(humanAuditAction("future.module.did_a_thing", "en")).not.toBe("future module did a thing");
  });
});

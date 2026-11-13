import { describe, expect, it } from "vitest";
import { formatAuditDetail, formatAuditLine, permissionLabel, systemRoleLabel } from "@/app/_lib/display";
import { tGroup } from "@/i18n/t";
import { PERMISSIONS } from "@/modules/identity/types";

describe("audit detail lines", () => {
  it("includes names from after_data without exposing secrets", () => {
    expect(
      formatAuditDetail({
        action: "core.membership.created",
        afterData: { userId: "u1", displayName: "Ahmed Mohamed", email: "a@example.com", password: "secret" },
      }),
    ).toBe("Ahmed Mohamed");
    expect(
      formatAuditDetail({
        action: "gaming.device_type.created",
        afterData: { name: "PlayStation 5" },
      }),
    ).toBe("PlayStation 5");
    expect(
      formatAuditDetail({
        action: "gaming.device.created",
        metadata: { name: "PS5 #03" },
      }),
    ).toBe("PS5 #03");
    expect(
      formatAuditDetail({
        action: "core.membership.created",
        afterData: { userId: "u-only" },
      }),
    ).toBeNull();
    const priced = formatAuditDetail(
      {
        action: "gaming.pricing_plan.created",
        afterData: {
          name: "PlayStation 5",
          currency: "USD",
          rateMinor: "350",
          pricingModel: "TIME_BASED",
        },
      },
      "en",
    );
    expect(priced).toContain("PlayStation 5");
    expect(priced).toContain("per hour");
  });

  it("renders a complete line and omits empty historical detail", () => {
    const when = new Date("2026-09-18T02:00:00.000Z");
    expect(
      formatAuditLine(
        {
          action: "core.membership.created",
          afterData: { displayName: "Ahmed Mohamed" },
          occurredAt: when,
        },
        "en",
        "UTC",
      ),
    ).toContain("Ahmed Mohamed");
    expect(
      formatAuditLine(
        {
          action: "core.membership.created",
          afterData: { userId: "legacy" },
          occurredAt: when,
        },
        "en",
        "UTC",
      ),
    ).not.toContain("legacy");
    const serialized = JSON.stringify({
      afterData: { displayName: "Ahmed", password: "nope", token: "abc" },
    });
    expect(formatAuditDetail({ action: "core.membership.created", afterData: { password: "nope" } })).toBeNull();
    expect(serialized).toContain("password");
  });
});

describe("permission and owner labels", () => {
  it("translates permission codes by dictionary and falls back to the stored name", () => {
    expect(permissionLabel(PERMISSIONS.auditRead, "en")).toBe("Read activity");
    expect(permissionLabel(PERMISSIONS.auditRead, "ar")).toBe("قراءة النشاط التشغيلي");
    expect(permissionLabel(PERMISSIONS.branchesManage, "ar")).toBe("إدارة الفروع");
    expect(permissionLabel("custom.unknown", "ar", "Stored name")).toBe("Stored name");
    expect(tGroup("ar", "permission", PERMISSIONS.customersRead)).toBe("قراءة الزبائن");
  });

  it("translates the system Owner role without changing the code", () => {
    expect(systemRoleLabel("OWNER", "Owner", "ar")).toBe("المالك");
    expect(systemRoleLabel("OWNER", "Owner", "en")).toBe("Owner");
    expect(systemRoleLabel("CASHIER", "Cashier", "ar")).toBe("Cashier");
  });
});

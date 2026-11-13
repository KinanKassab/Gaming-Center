import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { GET as getReports } from "@/app/api/reports/route";
import { GET as getSessions } from "@/app/api/gaming/sessions/route";
import { middleware } from "@/middleware";
import { PERMISSIONS } from "@/modules/identity";
import { createStaffMember, createTestEnvironment, invokeHttp, seedOwnerWithOrganization } from "../helpers/identity";
import { seedPlayableDevice } from "../helpers/gaming";

const root = resolve(__dirname, "../../src");

function source(relative: string): string {
  return readFileSync(resolve(root, relative), "utf8");
}

describe("sessions merged into reports", () => {
  it("redirects the sessions list, keeps detail/checkout, and lists sessions on reports", () => {
    expect(source("app/admin/gaming/sessions/page.tsx")).toContain("HardRedirect");
    expect(source("app/admin/gaming/sessions/page.tsx")).toContain("retiredSessionsListHref");
    expect(source("app/admin/gaming/sessions/page.tsx")).not.toContain("next/navigation");
    expect(source("app/_components/hard-redirect.tsx")).toContain("window.location.replace");
    expect(source("app/admin/reports/page.tsx")).toContain("SessionRecords");
    expect(source("app/admin/reports/page.tsx")).toContain("REPORT_RANGE_IDS");
    expect(source("app/admin/reports/page.tsx")).toContain("CUSTOM_REPORT_RANGE");
    expect(source("app/admin/reports/page.tsx")).toContain("datetime-local");
    expect(source("app/admin/reports/page.tsx")).not.toContain("reports.timezoneHint");
    expect(source("app/admin/reports/page.tsx")).not.toMatch(/UTC/i);
    expect(source("app/admin/_lib/context.ts")).not.toContain('from "next/navigation"');
    expect(source("app/admin/_lib/context.ts")).not.toContain('redirect("/login")');
    expect(source("app/admin/layout.tsx")).toContain("HardRedirect");
    expect(source("app/admin/layout.tsx")).not.toContain("/admin/gaming/sessions");
    expect(source("app/admin/_components/admin-shell.tsx")).not.toContain("/admin/gaming/sessions");
    expect(source("app/admin/gaming/sessions/[sessionId]/page.tsx")).toContain('href="/admin/reports"');
    expect(source("app/admin/gaming/sessions/[sessionId]/checkout/page.tsx")).toContain('href="/admin/reports"');
    expect(source("app/admin/users/page.tsx")).toContain("grantCount");
  });

  it("does not HTTP-redirect the retired sessions list (App Router client nav)", () => {
    const listed = middleware(new NextRequest("http://localhost:3000/admin/gaming/sessions?range=1h"));
    expect(listed.status).toBe(200);
    expect(listed.headers.get("location")).toBeNull();
    const trailing = middleware(new NextRequest("http://localhost:3000/admin/gaming/sessions/"));
    expect(trailing.status).toBe(200);
    expect(trailing.headers.get("location")).toBeNull();
    const detail = middleware(
      new NextRequest("http://localhost:3000/admin/gaming/sessions/01a0b16e-83b5-7fb7-4154-92e914e20890"),
    );
    expect(detail.status).toBe(200);
  });

  it("keeps session list and reports APIs unauthorized without the required permissions", async () => {
    const env = await createTestEnvironment();
    const owner = await seedOwnerWithOrganization(env, {
      email: "owner@nav.com",
      name: "Owner Nav",
      slug: "nav-sec",
    });
    const seeded = await seedPlayableDevice(env, owner);
    const staff = await createStaffMember(env, owner, {
      email: "limited@nav.com",
      displayName: "Limited",
      roleCode: "LIMITED",
      permissions: [PERMISSIONS.customersRead],
      branches: [{ branchId: seeded.branch.id, accessMode: "VIEW" }],
    });
    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date().toISOString();
    const reports = await invokeHttp(
      env,
      { headers: staff.headers, organizationId: owner.organizationId },
      () => getReports(new Request(`http://localhost:3000/api/reports?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)),
    );
    expect(reports.status).toBe(403);
    const sessions = await invokeHttp(
      env,
      { headers: staff.headers, organizationId: owner.organizationId },
      () => getSessions(new Request("http://localhost:3000/api/gaming/sessions")),
    );
    expect(sessions.status).toBe(403);
  });
});

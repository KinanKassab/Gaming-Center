import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FLOOR_START_API_METHOD,
  FLOOR_START_API_PATH,
  FLOOR_START_FIELD_NAMES,
  FLOOR_START_NATIVE_ACTION,
  FLOOR_START_NATIVE_METHOD,
  floorNativePostSeeOtherLocation,
  floorStartGetLeakLocation,
  floorStartQueryRedirect,
  htmlFormMethodIsGet,
  nativeFormNavigationUrl,
  shouldSeeOtherNativeFloorPost,
  urlContainsFloorStartFields,
} from "@/ui/floor-start-form-safety";

const root = resolve(__dirname, "../../src");

function source(relative: string): string {
  return readFileSync(resolve(root, relative), "utf8");
}

const FLOOR_DOCUMENT = "http://localhost:3000/admin/gaming/floor";
const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const FIELDS = { customerId: CUSTOMER_ID };

describe("BUG-033 Floor Start native form safety", () => {
  it("does not treat Start as a GET form", () => {
    expect(htmlFormMethodIsGet(undefined)).toBe(true);
    expect(htmlFormMethodIsGet("")).toBe(true);
    expect(htmlFormMethodIsGet("GET")).toBe(true);
    expect(htmlFormMethodIsGet(FLOOR_START_NATIVE_METHOD)).toBe(false);
    expect(FLOOR_START_NATIVE_METHOD.toLowerCase()).toBe("post");
    expect(FLOOR_START_NATIVE_ACTION).toBe("/admin/gaming/floor");
    expect(FLOOR_START_NATIVE_ACTION).not.toMatch(/[?#]/);
    expect(FLOOR_START_FIELD_NAMES).toEqual(["customerId"]);
    expect(FLOOR_START_API_PATH).toBe("/api/gaming/sessions");
    expect(FLOOR_START_API_METHOD).toBe("POST");
  });

  it("reproduces the unsafe HTML default: missing method GET-encodes customerId", () => {
    const leaked = nativeFormNavigationUrl({
      documentUrl: FLOOR_DOCUMENT,
      action: "",
      method: undefined,
      fields: FIELDS,
    });
    expect(urlContainsFloorStartFields(leaked, FIELDS)).toBe(true);
    expect(leaked).toContain("customerId=");
    expect(leaked).toContain("/admin/gaming/floor?customerId=");
  });

  it("keeps customerId out of the Floor URL on native POST", () => {
    const url = nativeFormNavigationUrl({
      documentUrl: FLOOR_DOCUMENT,
      action: FLOOR_START_NATIVE_ACTION,
      method: FLOOR_START_NATIVE_METHOD,
      fields: FIELDS,
    });
    expect(url).toBe(FLOOR_DOCUMENT);
    expect(urlContainsFloorStartFields(url, FIELDS)).toBe(false);
    expect(url).not.toContain("customerId=");
  });

  it("strips leaked Start query keys and never copies their values", () => {
    expect(floorStartQueryRedirect({ branchId: "x" })).toBeNull();
    expect(floorStartQueryRedirect({ customerId: "" })).toBe(FLOOR_START_NATIVE_ACTION);
    expect(
      floorStartQueryRedirect({
        customerId: CUSTOMER_ID,
        branchId: "22222222-2222-4222-8222-222222222222",
      }),
    ).toBe("/admin/gaming/floor?branchId=22222222-2222-4222-8222-222222222222");
    const redirected = floorStartQueryRedirect({ customerId: CUSTOMER_ID, areaId: "a" });
    expect(redirected).not.toContain(CUSTOMER_ID);
    expect(redirected).not.toContain("customerId=");
    expect(
      floorStartGetLeakLocation(
        "/admin/gaming/floor",
        new URLSearchParams({ customerId: CUSTOMER_ID, branchId: "b" }),
      ),
    ).toBe("/admin/gaming/floor?branchId=b");
    expect(floorStartGetLeakLocation("/admin/gaming/floor", new URLSearchParams({ branchId: "b" }))).toBeNull();
    expect(floorStartGetLeakLocation("/admin/reports", new URLSearchParams({ customerId: CUSTOMER_ID }))).toBeNull();
  });

  it("303s native Floor POST back to GET Floor without Start fields", () => {
    expect(
      shouldSeeOtherNativeFloorPost({
        method: "POST",
        pathname: "/admin/gaming/floor",
        contentType: "application/x-www-form-urlencoded",
      }),
    ).toBe(true);
    expect(
      shouldSeeOtherNativeFloorPost({
        method: "POST",
        pathname: "/api/gaming/sessions",
        contentType: "application/json",
      }),
    ).toBe(false);
    expect(
      shouldSeeOtherNativeFloorPost({
        method: "POST",
        pathname: "/admin/gaming/floor",
        contentType: "application/json",
      }),
    ).toBe(false);
    expect(
      floorNativePostSeeOtherLocation("http://localhost:3000/admin/gaming/floor?branchId=b&customerId="),
    ).toBe("/admin/gaming/floor?branchId=b");
  });
});

describe("BUG-033 Floor Start wiring", () => {
  it("declares POST native Start and JSON Start API, never GET", () => {
    const actions = source("app/admin/gaming/_components/floor-device-actions.tsx");
    expect(actions).toContain("FLOOR_START_NATIVE_METHOD");
    expect(actions).toContain("FLOOR_START_NATIVE_ACTION");
    expect(actions).toContain("FLOOR_START_API_PATH");
    expect(actions).toContain("FLOOR_START_API_METHOD");
    expect(actions).toContain('extraBody={{ deviceId: tile.deviceId }}');
    expect(actions).toContain('name: "customerId"');
    expect(actions).not.toMatch(/method=["']get["']/i);
    expect(actions).not.toContain("router.push(`/admin/gaming/floor?");

    const form = source("app/admin/_components/controls.tsx");
    expect(form).toContain("method={nativeMethod}");
    expect(form).toContain("action={nativeAction}");
    expect(form).toContain("formMethod={nativeMethod}");
    expect(form).toContain("formAction={nativeAction}");
    expect(form).toContain("inFlight.current");
    expect(form).toContain("event.preventDefault()");

    const page = source("app/admin/gaming/floor/page.tsx");
    expect(page).toContain("floorStartQueryRedirect");
    expect(page).toContain("HardRedirect");
    expect(page).not.toContain("next/navigation");
    expect(source("middleware.ts")).not.toContain("floorStartGetLeakLocation");
  });
});

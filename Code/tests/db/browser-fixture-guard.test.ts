import { describe, expect, it } from "vitest";
import { assertLocalBrowserFixtureTarget } from "@/db/browser-fixture-guard";

describe("browser fixture reset guard", () => {
  const local = "postgres://fixture:synthetic@127.0.0.1:5432/gaming_center_security_test";

  it("allows only explicit reset of the named local database", () => {
    expect(assertLocalBrowserFixtureTarget(local, "true")).toBe("gaming_center_security_test");
    expect(() => assertLocalBrowserFixtureTarget(local, undefined)).toThrow("REFUSED");
    expect(() => assertLocalBrowserFixtureTarget(local.replace("security_test", "dev"), "true")).toThrow("REFUSED");
    expect(() => assertLocalBrowserFixtureTarget(local.replace("127.0.0.1", "db.example.test"), "true")).toThrow("loopback");
    expect(() => assertLocalBrowserFixtureTarget(local.replace("gaming_center_security_test", "postgres"), "true")).toThrow("REFUSED");
  });
});

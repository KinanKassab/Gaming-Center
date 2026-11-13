import { describe, expect, it } from "vitest";
import { ValidationError } from "@/core/errors";
import {
  resolveSetting,
  resolveSettingWithSource,
  validateSettingValue,
  assertSeededSettingConstraints,
} from "@/core/config";

describe("setting resolution", () => {
  it("uses entity, then branch, then organization, then default", () => {
    const definition = { key: "gaming.billing_unit_seconds", defaultValue: 60 };
    const rows = [
      {
        settingKey: definition.key,
        scope: "ORGANIZATION" as const,
        scopeId: "org-a",
        value: 300,
      },
      {
        settingKey: definition.key,
        scope: "BRANCH" as const,
        scopeId: "branch-1",
        value: 60,
      },
    ];
    expect(
      resolveSetting(definition, rows, { organizationId: "org-a", branchId: "branch-1" }),
    ).toBe(60);
    expect(resolveSetting(definition, rows, { organizationId: "org-a" })).toBe(300);
    expect(resolveSetting(definition, [], { organizationId: "org-a" })).toBe(60);
    expect(resolveSettingWithSource(definition, rows, { organizationId: "org-a" }).source).toBe(
      "ORGANIZATION",
    );
    expect(resolveSettingWithSource(definition, [], { organizationId: "org-a" }).source).toBe(
      "DEFAULT",
    );
  });

  it("rejects invalid types and free-form JSON", () => {
    expect(() => validateSettingValue("BOOLEAN", "true")).toThrow(ValidationError);
    expect(() => validateSettingValue("NUMBER", "60")).toThrow(ValidationError);
    expect(() => validateSettingValue("JSON", { any: true })).toThrow(ValidationError);
    expect(validateSettingValue("BOOLEAN", true)).toBe(true);
    expect(validateSettingValue("NUMBER", 60)).toBe(60);
    expect(() => assertSeededSettingConstraints("gaming.billing_unit_seconds", 0)).toThrow(
      ValidationError,
    );
    expect(() => assertSeededSettingConstraints("gaming.billing_unit_seconds", 60.5)).toThrow(
      ValidationError,
    );
  });
});

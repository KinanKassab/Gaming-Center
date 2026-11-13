import { ValidationError } from "@/core/errors";

export type SettingScope = "ORGANIZATION" | "BRANCH" | "ENTITY";

export type SettingValueType = "STRING" | "NUMBER" | "BOOLEAN" | "JSON" | "ENUM";

export type SettingResolutionSource = "ENTITY" | "BRANCH" | "ORGANIZATION" | "DEFAULT";

export type SettingValueRow = {
  settingKey: string;
  scope: SettingScope;
  scopeId: string;
  value: unknown;
};

export type SettingDefinition = {
  key: string;
  defaultValue: unknown;
};

/**
 * Resolve Entity → Branch → Organization → definition default.
 * Caller supplies the already-loaded rows for one organization.
 */
export function resolveSetting(
  definition: SettingDefinition,
  rows: ReadonlyArray<SettingValueRow>,
  context: { organizationId: string; branchId?: string; entityId?: string },
): unknown {
  return resolveSettingWithSource(definition, rows, context).value;
}

export function resolveSettingWithSource(
  definition: SettingDefinition,
  rows: ReadonlyArray<SettingValueRow>,
  context: { organizationId: string; branchId?: string; entityId?: string },
): { value: unknown; source: SettingResolutionSource } {
  const byScope = (scope: SettingScope, scopeId: string | undefined) => {
    if (!scopeId) {
      return undefined;
    }
    return rows.find((row) => row.settingKey === definition.key && row.scope === scope && row.scopeId === scopeId);
  };

  const entity = byScope("ENTITY", context.entityId);
  if (entity) return { value: entity.value, source: "ENTITY" };
  const branch = byScope("BRANCH", context.branchId);
  if (branch) return { value: branch.value, source: "BRANCH" };
  const organization = byScope("ORGANIZATION", context.organizationId);
  if (organization) return { value: organization.value, source: "ORGANIZATION" };
  return { value: definition.defaultValue, source: "DEFAULT" };
}

export function assertScopeAllowed(allowedScopes: ReadonlyArray<string>, scope: SettingScope): void {
  if (!allowedScopes.includes(scope)) {
    throw new ValidationError(`Setting does not allow ${scope} scope`);
  }
}

/**
 * Type-check a setting value. JSON and ENUM are rejected until a validator
 * exists for that key — no free-form JSON configuration blobs.
 */
export function validateSettingValue(valueType: string, value: unknown): unknown {
  switch (valueType) {
    case "BOOLEAN":
      if (typeof value !== "boolean") {
        throw new ValidationError("Value must be a boolean");
      }
      return value;
    case "NUMBER":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ValidationError("Value must be a finite number");
      }
      return value;
    case "STRING":
      if (typeof value !== "string") {
        throw new ValidationError("Value must be a string");
      }
      if (value.length > 2000) {
        throw new ValidationError("Value is too long");
      }
      return value;
    case "ENUM":
      throw new ValidationError("ENUM settings cannot be set until allowed values are defined");
    case "JSON":
      throw new ValidationError("JSON settings cannot be set as free-form values");
    default:
      throw new ValidationError("Unknown setting type");
  }
}

/** Extra constraints for seeded keys. Unknown keys keep type checks only. */
export function assertSeededSettingConstraints(key: string, value: unknown): void {
  if (key === "gaming.billing_unit_seconds") {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 86400) {
      throw new ValidationError("Billing unit must be an integer from 1 to 86400 seconds");
    }
  }
}

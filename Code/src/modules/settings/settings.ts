import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { NotFoundError, ValidationError } from "@/core/errors";
import { createId } from "@/core/ids";
import {
  assertScopeAllowed,
  assertSeededSettingConstraints,
  resolveSetting,
  resolveSettingWithSource,
  validateSettingValue,
  type SettingResolutionSource,
  type SettingScope,
} from "@/core/config";
import { assertBranchAccess, assertPermission } from "@/core/tenancy";
import { coreBranches, coreSettingsDefinitions, coreSettingValues } from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { recordAudit } from "@/modules/identity/audit";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";

export const settingKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-z][a-z0-9_.]*$/, "Invalid setting key");

export function requireSettingKey(value: string): string {
  const parsed = settingKeySchema.safeParse(decodeURIComponent(value));
  if (!parsed.success) {
    throw new ValidationError("Invalid setting key");
  }
  return parsed.data;
}

export const setSettingValueInputSchema = z.object({
  value: z.unknown(),
});

export type SetSettingValueInput = z.infer<typeof setSettingValueInputSchema>;

export type SettingPresentation = {
  key: string;
  module: string;
  valueType: string;
  description: string | null;
  isSensitive: boolean;
  allowedScopes: string[];
  defaultValue: unknown;
  organizationValue: unknown | null;
  branchValue: unknown | null;
  effectiveValue: unknown;
  source: SettingResolutionSource;
  redacted: boolean;
};

function presentValue(
  isSensitive: boolean,
  value: unknown,
  canSeeSensitive: boolean,
): { value: unknown; redacted: boolean } {
  if (isSensitive && !canSeeSensitive) {
    return { value: null, redacted: true };
  }
  return { value, redacted: false };
}

async function loadDefinition(tx: AppDatabase, key: string) {
  const rows = await tx
    .select()
    .from(coreSettingsDefinitions)
    .where(eq(coreSettingsDefinitions.key, key))
    .limit(1);
  const definition = rows[0];
  if (!definition) throw new NotFoundError("Setting not found");
  return definition;
}

async function requireBranchInOrganization(
  tx: AppDatabase,
  organizationId: string,
  branchId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: coreBranches.id })
    .from(coreBranches)
    .where(and(eq(coreBranches.id, branchId), eq(coreBranches.organizationId, organizationId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError("Branch not found in this organization");
}

function validatedValue(definition: { key: string; valueType: string }, raw: unknown): unknown {
  const value = validateSettingValue(definition.valueType, raw);
  assertSeededSettingConstraints(definition.key, value);
  return value;
}

export async function listSettings(
  db: AppDatabase,
  actor: OrganizationActor,
  input?: { branchId?: string },
): Promise<SettingPresentation[]> {
  assertPermission(actor, PERMISSIONS.settingsRead);
  if (input?.branchId) {
    assertBranchAccess(actor, input.branchId, "VIEW");
  }
  const canSeeSensitive = actor.permissions.includes(PERMISSIONS.settingsManage);

  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    if (input?.branchId) {
      await requireBranchInOrganization(tx, actor.organizationId, input.branchId);
    }

    const definitions = await tx
      .select()
      .from(coreSettingsDefinitions)
      .orderBy(coreSettingsDefinitions.module, coreSettingsDefinitions.key);
    const values = await tx
      .select()
      .from(coreSettingValues)
      .where(eq(coreSettingValues.organizationId, actor.organizationId));

    const rows = values.map((row) => ({
      settingKey: row.settingKey,
      scope: row.scope as SettingScope,
      scopeId: row.scopeId,
      value: row.value,
    }));

    return definitions.map((definition) => {
      const organizationRow = values.find(
        (row) => row.settingKey === definition.key && row.scope === "ORGANIZATION",
      );
      const branchRow = input?.branchId
        ? values.find(
            (row) =>
              row.settingKey === definition.key &&
              row.scope === "BRANCH" &&
              row.scopeId === input.branchId,
          )
        : undefined;
      const resolved = resolveSettingWithSource(
        { key: definition.key, defaultValue: definition.defaultValue },
        rows,
        input?.branchId
          ? { organizationId: actor.organizationId, branchId: input.branchId }
          : { organizationId: actor.organizationId },
      );
      const effective = presentValue(definition.isSensitive, resolved.value, canSeeSensitive);
      const organizationPresented = presentValue(
        definition.isSensitive,
        organizationRow?.value ?? null,
        canSeeSensitive,
      );
      const branchPresented = presentValue(
        definition.isSensitive,
        branchRow ? branchRow.value : null,
        canSeeSensitive,
      );
      return {
        key: definition.key,
        module: definition.module,
        valueType: definition.valueType,
        description: definition.description,
        isSensitive: definition.isSensitive,
        allowedScopes: definition.allowedScopes,
        defaultValue: definition.isSensitive && !canSeeSensitive ? null : definition.defaultValue,
        organizationValue: organizationPresented.value,
        branchValue: input?.branchId ? branchPresented.value : null,
        effectiveValue: effective.value,
        source: resolved.source,
        redacted: effective.redacted,
      };
    });
  });
}

async function upsertScopedValue(
  db: AppDatabase,
  actor: OrganizationActor,
  key: string,
  raw: unknown,
  scope: Extract<SettingScope, "ORGANIZATION" | "BRANCH">,
  branchId: string | null,
): Promise<{ key: string; scope: string; value: unknown }> {
  assertPermission(actor, PERMISSIONS.settingsManage);
  if (scope === "BRANCH") {
    if (!branchId) throw new ValidationError("Branch id is required");
    assertBranchAccess(actor, branchId, "MANAGE");
  }

  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const definition = await loadDefinition(tx, key);
    assertScopeAllowed(definition.allowedScopes, scope);
    const value = validatedValue(definition, raw);
    if (scope === "BRANCH" && branchId) {
      await requireBranchInOrganization(tx, actor.organizationId, branchId);
    }

    const scopeId = scope === "ORGANIZATION" ? actor.organizationId : branchId!;
    const existing = await tx
      .select()
      .from(coreSettingValues)
      .where(
        and(
          eq(coreSettingValues.organizationId, actor.organizationId),
          eq(coreSettingValues.settingKey, key),
          eq(coreSettingValues.scope, scope),
          eq(coreSettingValues.scopeId, scopeId),
        ),
      )
      .limit(1);

    const auditValue = definition.isSensitive ? "[redacted]" : value;
    const beforeValue = existing[0]
      ? definition.isSensitive
        ? "[redacted]"
        : existing[0].value
      : null;

    if (existing[0]) {
      await tx
        .update(coreSettingValues)
        .set({ value })
        .where(
          and(
            eq(coreSettingValues.id, existing[0].id),
            eq(coreSettingValues.organizationId, actor.organizationId),
          ),
        );
    } else {
      await tx.insert(coreSettingValues).values({
        id: createId(),
        organizationId: actor.organizationId,
        settingKey: key,
        scope,
        scopeId,
        branchId: scope === "BRANCH" ? branchId : null,
        value,
      });
    }

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      branchId: scope === "BRANCH" ? branchId : null,
      actorUserId: actor.userId,
      action: "core.setting.updated",
      entityType: "setting_value",
      entityId: existing[0]?.id ?? null,
      before: { key, scope, value: beforeValue },
      after: { key, scope, value: auditValue },
    });

    return { key, scope, value: definition.isSensitive ? null : value };
  });
}

export async function setOrganizationSetting(
  db: AppDatabase,
  actor: OrganizationActor,
  key: string,
  input: SetSettingValueInput,
) {
  return upsertScopedValue(db, actor, key, input.value, "ORGANIZATION", null);
}

export async function setBranchSetting(
  db: AppDatabase,
  actor: OrganizationActor,
  key: string,
  branchId: string,
  input: SetSettingValueInput,
) {
  return upsertScopedValue(db, actor, key, input.value, "BRANCH", branchId);
}

async function clearScopedValue(
  db: AppDatabase,
  actor: OrganizationActor,
  key: string,
  scope: Extract<SettingScope, "ORGANIZATION" | "BRANCH">,
  branchId: string | null,
): Promise<{ key: string; scope: string; cleared: true }> {
  assertPermission(actor, PERMISSIONS.settingsManage);
  if (scope === "BRANCH") {
    if (!branchId) throw new ValidationError("Branch id is required");
    assertBranchAccess(actor, branchId, "MANAGE");
  }

  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    await loadDefinition(tx, key);
    if (scope === "BRANCH" && branchId) {
      await requireBranchInOrganization(tx, actor.organizationId, branchId);
    }
    const scopeId = scope === "ORGANIZATION" ? actor.organizationId : branchId!;
    const existing = await tx
      .select()
      .from(coreSettingValues)
      .where(
        and(
          eq(coreSettingValues.organizationId, actor.organizationId),
          eq(coreSettingValues.settingKey, key),
          eq(coreSettingValues.scope, scope),
          eq(coreSettingValues.scopeId, scopeId),
        ),
      )
      .limit(1);
    if (!existing[0]) throw new NotFoundError("Setting value not found");

    await tx
      .delete(coreSettingValues)
      .where(
        and(
          eq(coreSettingValues.id, existing[0].id),
          eq(coreSettingValues.organizationId, actor.organizationId),
        ),
      );

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      branchId: scope === "BRANCH" ? branchId : null,
      actorUserId: actor.userId,
      action: "core.setting.cleared",
      entityType: "setting_value",
      entityId: existing[0].id,
      before: { key, scope, value: existing[0].value },
    });

    return { key, scope, cleared: true as const };
  });
}

/**
 * Domain helper: resolve a seeded setting inside an existing tenant transaction.
 * Callers must already be authorized for their own operation; this does not
 * require `core.settings.read`.
 */
export async function readEffectiveSettingValue(
  tx: AppDatabase,
  organizationId: string,
  key: string,
  branchId?: string,
): Promise<unknown> {
  const definition = await loadDefinition(tx, key);
  const values = await tx
    .select()
    .from(coreSettingValues)
    .where(
      and(eq(coreSettingValues.organizationId, organizationId), eq(coreSettingValues.settingKey, key)),
    );
  return resolveSetting(
    { key: definition.key, defaultValue: definition.defaultValue },
    values.map((row) => ({
      settingKey: row.settingKey,
      scope: row.scope as SettingScope,
      scopeId: row.scopeId,
      value: row.value,
    })),
    branchId ? { organizationId, branchId } : { organizationId },
  );
}

export async function clearOrganizationSetting(db: AppDatabase, actor: OrganizationActor, key: string) {
  return clearScopedValue(db, actor, key, "ORGANIZATION", null);
}

export async function clearBranchSetting(
  db: AppDatabase,
  actor: OrganizationActor,
  key: string,
  branchId: string,
) {
  return clearScopedValue(db, actor, key, "BRANCH", branchId);
}

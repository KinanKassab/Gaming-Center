import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { NotFoundError, ValidationError } from "@/core/errors";
import { assertPermission } from "@/core/tenancy";
import { coreFeatures, coreOrganizationFeatures } from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { recordAudit } from "@/modules/identity/audit";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";

export const featureCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-z][a-z0-9_.]*$/, "Invalid feature code");

export function requireFeatureCode(value: string): string {
  const parsed = featureCodeSchema.safeParse(decodeURIComponent(value));
  if (!parsed.success) {
    throw new ValidationError("Invalid feature code");
  }
  return parsed.data;
}

export const setFeatureInputSchema = z.object({
  enabled: z.boolean(),
});

export type SetFeatureInput = z.infer<typeof setFeatureInputSchema>;

export type FeaturePresentation = {
  code: string;
  module: string;
  description: string | null;
  defaultEnabled: boolean;
  enabled: boolean;
  source: "DEFAULT" | "ORGANIZATION";
};

export async function listFeatures(
  db: AppDatabase,
  actor: OrganizationActor,
): Promise<FeaturePresentation[]> {
  assertPermission(actor, PERMISSIONS.settingsRead);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const catalog = await tx.select().from(coreFeatures).orderBy(coreFeatures.module, coreFeatures.code);
    const overrides = await tx
      .select()
      .from(coreOrganizationFeatures)
      .where(eq(coreOrganizationFeatures.organizationId, actor.organizationId));
    const byCode = new Map(overrides.map((row) => [row.featureCode, row]));

    return catalog.map((feature) => {
      const override = byCode.get(feature.code);
      return {
        code: feature.code,
        module: feature.module,
        description: feature.description,
        defaultEnabled: feature.defaultEnabled,
        enabled: override ? override.enabled : feature.defaultEnabled,
        source: override ? ("ORGANIZATION" as const) : ("DEFAULT" as const),
      };
    });
  });
}

export async function setOrganizationFeature(
  db: AppDatabase,
  actor: OrganizationActor,
  code: string,
  input: SetFeatureInput,
): Promise<FeaturePresentation> {
  assertPermission(actor, PERMISSIONS.settingsManage);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const catalog = await tx.select().from(coreFeatures).where(eq(coreFeatures.code, code)).limit(1);
    const feature = catalog[0];
    if (!feature) throw new NotFoundError("Feature not found");

    const existing = await tx
      .select()
      .from(coreOrganizationFeatures)
      .where(
        and(
          eq(coreOrganizationFeatures.organizationId, actor.organizationId),
          eq(coreOrganizationFeatures.featureCode, code),
        ),
      )
      .limit(1);

    const beforeEnabled = existing[0]?.enabled ?? null;

    if (existing[0]) {
      await tx
        .update(coreOrganizationFeatures)
        .set({ enabled: input.enabled, config: null })
        .where(
          and(
            eq(coreOrganizationFeatures.organizationId, actor.organizationId),
            eq(coreOrganizationFeatures.featureCode, code),
          ),
        );
    } else {
      await tx.insert(coreOrganizationFeatures).values({
        organizationId: actor.organizationId,
        featureCode: code,
        enabled: input.enabled,
        config: null,
      });
    }

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "core.feature.updated",
      entityType: "organization_feature",
      before: { code, enabled: beforeEnabled },
      after: { code, enabled: input.enabled },
    });

    return {
      code: feature.code,
      module: feature.module,
      description: feature.description,
      defaultEnabled: feature.defaultEnabled,
      enabled: input.enabled,
      source: "ORGANIZATION",
    };
  });
}

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { AuthorizationError, ConflictError, NotFoundError, isUniqueViolation } from "@/core/errors";
import { createId } from "@/core/ids";
import { assertPermission } from "@/core/tenancy";
import {
  coreMembershipRoles,
  coreOrganizationMemberships,
  coreOrganizations,
  corePermissions,
  coreRolePermissions,
  coreRoles,
} from "@/db/schema";
import { recordInitialOrganizationId } from "@/modules/identity/platform-bootstrap";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { recordAudit } from "@/modules/identity/audit";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";
import { ensureDefaultPaymentMethods } from "@/modules/finance/methods";
import { ensureDefaultExpenseCategory } from "@/modules/finance/expenses";
import { resolveBusinessTimezone } from "@/i18n/timezone";

export const appLocaleSchema = z.enum(["ar", "en"]);

export const createOrganizationInputSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, "Slug must be lowercase letters, digits, and dashes")
    .optional(),
  name: z.string().trim().min(1).max(200),
  legalName: z.string().trim().min(1).max(200).optional(),
  defaultCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code"),
  timezone: z.string().trim().min(1).max(64).optional(),
  locale: appLocaleSchema,
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationInputSchema>;

export const updateOrganizationInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    legalName: z.string().trim().min(1).max(200).nullable().optional(),
    defaultCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    locale: appLocaleSchema.optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "Nothing to update",
  });

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationInputSchema>;

/**
 * Creates an organization; the creator becomes its first administrator via the
 * seeded is_system OWNER role (every permission currently in the registry).
 *
 * HTTP POST /api/organizations additionally claims the platform singleton so
 * only the initial organization can be created that way (pilot hardening).
 * Direct domain calls remain available for tests and future platform-admin
 * (NEEDS DECISION, ADR 0004 / 0007).
 */
export async function createOrganization(
  db: AppDatabase,
  actor: { userId: string },
  input: CreateOrganizationInput,
): Promise<{ organizationId: string; membershipId: string; ownerRoleId: string }> {
  const organizationId = createId();
  const membershipId = createId();
  const ownerRoleId = createId();
  const slug =
    input.slug ??
    `${(input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "center")}-${createId().replace(/-/g, "").slice(0, 6).toLowerCase()}`;

  try {
    await withTenant(db, { organizationId, userId: actor.userId }, async (tx) => {
      await tx.insert(coreOrganizations).values({
        id: organizationId,
        slug,
        name: input.name,
        legalName: input.legalName ?? null,
        status: "ACTIVE",
        defaultCurrency: input.defaultCurrency,
        timezone: resolveBusinessTimezone(input.timezone),
        locale: input.locale,
      });

      await recordInitialOrganizationId(tx, organizationId);

      await tx.insert(coreOrganizationMemberships).values({
        id: membershipId,
        organizationId,
        userId: actor.userId,
        status: "ACTIVE",
        joinedAt: new Date(),
      });

      await tx.insert(coreRoles).values({
        id: ownerRoleId,
        organizationId,
        code: "OWNER",
        name: "Owner",
        description: "Seeded owner role with full permissions",
        isSystem: true,
        status: "ACTIVE",
      });

      const catalog = await tx.select({ code: corePermissions.code }).from(corePermissions);
      if (catalog.length > 0) {
        await tx.insert(coreRolePermissions).values(
          catalog.map((row) => ({
            organizationId,
            roleId: ownerRoleId,
            permissionCode: row.code,
          })),
        );
      }

      await tx.insert(coreMembershipRoles).values({
        organizationId,
        membershipId,
        roleId: ownerRoleId,
      });

      await ensureDefaultPaymentMethods(tx, organizationId);
      await ensureDefaultExpenseCategory(tx, organizationId);

      await recordAudit(tx, {
        organizationId,
        actorUserId: actor.userId,
        action: "core.organization.created",
        entityType: "organization",
        entityId: organizationId,
        after: { slug, name: input.name },
        metadata: { ownerMembershipId: membershipId, ownerRoleId },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("Organization slug is already in use");
    }
    throw error;
  }

  return { organizationId, membershipId, ownerRoleId };
}

export async function getOrganizationProfile(db: AppDatabase, actor: OrganizationActor) {
  assertPermission(actor, PERMISSIONS.organizationsRead);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const rows = await tx
      .select()
      .from(coreOrganizations)
      .where(eq(coreOrganizations.id, actor.organizationId))
      .limit(1);
    if (!rows[0]) throw new NotFoundError("Organization not found");
    return rows[0];
  });
}

export async function updateOrganizationProfile(
  db: AppDatabase,
  actor: OrganizationActor,
  input: UpdateOrganizationInput,
) {
  assertPermission(actor, PERMISSIONS.organizationsManage);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const rows = await tx
      .select()
      .from(coreOrganizations)
      .where(eq(coreOrganizations.id, actor.organizationId))
      .limit(1);
    const before = rows[0];
    if (!before) throw new NotFoundError("Organization not found");

    const patch = {
      name: input.name ?? before.name,
      legalName: input.legalName === undefined ? before.legalName : input.legalName,
      defaultCurrency: input.defaultCurrency ?? before.defaultCurrency,
      timezone: input.timezone ?? before.timezone,
      locale: input.locale ?? before.locale,
    };

    const updated = await tx
      .update(coreOrganizations)
      .set(patch)
      .where(eq(coreOrganizations.id, actor.organizationId))
      .returning();

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "core.organization.updated",
      entityType: "organization",
      entityId: actor.organizationId,
      before: {
        name: before.name,
        legalName: before.legalName,
        defaultCurrency: before.defaultCurrency,
        timezone: before.timezone,
        locale: before.locale,
      },
      after: patch,
    });

    return updated[0]!;
  });
}

export type UserMembershipSummary = {
  membershipId: string;
  status: string;
  joinedAt: Date | null;
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  organizationStatus: string;
};

/**
 * Pre-selection view: the authenticated user's own memberships across
 * organizations. RLS exposes exactly these rows via app.user_id.
 */
export async function listUserMemberships(
  db: AppDatabase,
  userId: string,
): Promise<UserMembershipSummary[]> {
  return withTenant(db, { userId }, (tx) =>
    tx
      .select({
        membershipId: coreOrganizationMemberships.id,
        status: coreOrganizationMemberships.status,
        joinedAt: coreOrganizationMemberships.joinedAt,
        organizationId: coreOrganizations.id,
        organizationSlug: coreOrganizations.slug,
        organizationName: coreOrganizations.name,
        organizationStatus: coreOrganizations.status,
      })
      .from(coreOrganizationMemberships)
      .innerJoin(
        coreOrganizations,
        eq(coreOrganizations.id, coreOrganizationMemberships.organizationId),
      )
      .where(eq(coreOrganizationMemberships.userId, userId)),
  );
}

/**
 * Self-consent activation of an INVITED membership: the invited user accepts
 * by entering the organization. Admin-side reactivation of SUSPENDED
 * memberships lives in memberships.ts and is a separate concern.
 */
export async function activateInvitedMembership(
  db: AppDatabase,
  userId: string,
  organizationId: string,
): Promise<{ membershipId: string }> {
  return withTenant(db, { organizationId, userId }, async (tx) => {
    const updated = await tx
      .update(coreOrganizationMemberships)
      .set({ status: "ACTIVE", joinedAt: new Date() })
      .where(
        and(
          eq(coreOrganizationMemberships.organizationId, organizationId),
          eq(coreOrganizationMemberships.userId, userId),
          eq(coreOrganizationMemberships.status, "INVITED"),
        ),
      )
      .returning();

    const membership = updated[0];
    if (!membership) {
      throw new AuthorizationError("No pending invitation for this organization");
    }

    await recordAudit(tx, {
      organizationId,
      actorUserId: userId,
      action: "core.membership.activated",
      entityType: "membership",
      entityId: membership.id,
      before: { status: "INVITED" },
      after: { status: "ACTIVE" },
      metadata: { activatedBy: "self" },
    });

    return { membershipId: membership.id };
  });
}

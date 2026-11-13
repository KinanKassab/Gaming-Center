import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
  isUniqueViolation,
} from "@/core/errors";
import { createId } from "@/core/ids";
import { assertPermission } from "@/core/tenancy";
import { corePermissions, coreRolePermissions, coreRoles } from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { recordAudit } from "@/modules/identity/audit";
import { assertOrganizationRetainsAdmin } from "@/modules/identity/admin-guard";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";

export const createRoleInputSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,63}$/, "Role code must be uppercase letters, digits, underscores"),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(500).optional(),
});

export type CreateRoleInput = z.infer<typeof createRoleInputSchema>;

export const updateRoleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "Nothing to update",
  });

export type UpdateRoleInput = z.infer<typeof updateRoleInputSchema>;

export const setRolePermissionsInputSchema = z.object({
  permissionCodes: z.array(z.string().trim().min(1).max(200)).max(500),
});

export type SetRolePermissionsInput = z.infer<typeof setRolePermissionsInputSchema>;

export type RoleSummary = {
  roleId: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  status: string;
  permissionCodes: string[];
};

export async function listRoles(db: AppDatabase, actor: OrganizationActor): Promise<RoleSummary[]> {
  assertPermission(actor, PERMISSIONS.rolesRead);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const roles = await tx
      .select()
      .from(coreRoles)
      .where(eq(coreRoles.organizationId, actor.organizationId))
      .orderBy(coreRoles.code);

    const permissionRows = await tx
      .select({
        roleId: coreRolePermissions.roleId,
        code: coreRolePermissions.permissionCode,
      })
      .from(coreRolePermissions)
      .where(eq(coreRolePermissions.organizationId, actor.organizationId));

    return roles.map((role) => ({
      roleId: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      status: role.status,
      permissionCodes: permissionRows
        .filter((row) => row.roleId === role.id)
        .map((row) => row.code)
        .sort(),
    }));
  });
}

/** System permission registry (seeded by migrations, not tenant data). */
export async function listPermissionCatalog(db: AppDatabase, actor: OrganizationActor) {
  assertPermission(actor, PERMISSIONS.rolesRead);
  return db.select().from(corePermissions).orderBy(corePermissions.module, corePermissions.code);
}

export async function createRole(db: AppDatabase, actor: OrganizationActor, input: CreateRoleInput) {
  assertPermission(actor, PERMISSIONS.rolesManage);
  const roleId = createId();
  try {
    return await withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
      const inserted = await tx
        .insert(coreRoles)
        .values({
          id: roleId,
          organizationId: actor.organizationId,
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          isSystem: false,
          status: "ACTIVE",
        })
        .returning();

      await recordAudit(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action: "core.role.created",
        entityType: "role",
        entityId: roleId,
        after: { code: input.code, name: input.name },
      });

      return inserted[0]!;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("Role code is already in use in this organization");
    }
    throw error;
  }
}

async function loadOwnRole(tx: AppDatabase, organizationId: string, roleId: string) {
  const rows = await tx
    .select()
    .from(coreRoles)
    .where(and(eq(coreRoles.id, roleId), eq(coreRoles.organizationId, organizationId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError("Role not found in this organization");
  return rows[0];
}

export async function updateRole(
  db: AppDatabase,
  actor: OrganizationActor,
  roleId: string,
  input: UpdateRoleInput,
) {
  assertPermission(actor, PERMISSIONS.rolesManage);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const before = await loadOwnRole(tx, actor.organizationId, roleId);
    if (before.isSystem) throw new ConflictError("System roles cannot be modified");
    if (before.status !== "ACTIVE") throw new ConflictError("Archived roles cannot be modified");

    const patch = {
      name: input.name ?? before.name,
      description: input.description === undefined ? before.description : input.description,
    };

    const updated = await tx
      .update(coreRoles)
      .set(patch)
      .where(and(eq(coreRoles.id, roleId), eq(coreRoles.organizationId, actor.organizationId)))
      .returning();

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "core.role.updated",
      entityType: "role",
      entityId: roleId,
      before: { name: before.name, description: before.description },
      after: patch,
    });

    return updated[0]!;
  });
}

export async function archiveRole(db: AppDatabase, actor: OrganizationActor, roleId: string) {
  assertPermission(actor, PERMISSIONS.rolesManage);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const before = await loadOwnRole(tx, actor.organizationId, roleId);
    if (before.isSystem) throw new ConflictError("System roles cannot be archived");
    if (before.status === "ARCHIVED") throw new ConflictError("Role is already archived");

    const updated = await tx
      .update(coreRoles)
      .set({ status: "ARCHIVED" })
      .where(and(eq(coreRoles.id, roleId), eq(coreRoles.organizationId, actor.organizationId)))
      .returning();

    await assertOrganizationRetainsAdmin(tx, actor.organizationId);

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "core.role.archived",
      entityType: "role",
      entityId: roleId,
      before: { status: before.status },
      after: { status: "ARCHIVED" },
    });

    return updated[0]!;
  });
}

/** Replaces the role's permission set (grant + revoke in one atomic operation). */
export async function setRolePermissions(
  db: AppDatabase,
  actor: OrganizationActor,
  roleId: string,
  input: SetRolePermissionsInput,
) {
  assertPermission(actor, PERMISSIONS.rolesManage);
  const requestedCodes = [...new Set(input.permissionCodes)].sort();

  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const role = await loadOwnRole(tx, actor.organizationId, roleId);
    if (role.isSystem) throw new ConflictError("System role permissions cannot be modified");
    if (role.status !== "ACTIVE") throw new ConflictError("Archived roles cannot be modified");

    if (requestedCodes.length > 0) {
      const known = await tx
        .select({ code: corePermissions.code })
        .from(corePermissions)
        .where(inArray(corePermissions.code, requestedCodes));
      const knownSet = new Set(known.map((row) => row.code));
      const unknown = requestedCodes.filter((code) => !knownSet.has(code));
      if (unknown.length > 0) {
        throw new ValidationError(`Unknown permission codes: ${unknown.join(", ")}`);
      }
    }

    const currentRows = await tx
      .select({ code: coreRolePermissions.permissionCode })
      .from(coreRolePermissions)
      .where(
        and(
          eq(coreRolePermissions.roleId, roleId),
          eq(coreRolePermissions.organizationId, actor.organizationId),
        ),
      );
    const currentCodes = currentRows.map((row) => row.code).sort();

    // Anti-escalation: adding a permission you do not hold is forbidden.
    const added = requestedCodes.filter((code) => !currentCodes.includes(code));
    const escalating = added.filter((code) => !actor.permissions.includes(code));
    if (escalating.length > 0) {
      throw new AuthorizationError(
        `Cannot grant permissions you do not hold: ${escalating.join(", ")}`,
      );
    }

    await tx
      .delete(coreRolePermissions)
      .where(
        and(
          eq(coreRolePermissions.roleId, roleId),
          eq(coreRolePermissions.organizationId, actor.organizationId),
        ),
      );
    if (requestedCodes.length > 0) {
      await tx.insert(coreRolePermissions).values(
        requestedCodes.map((code) => ({
          organizationId: actor.organizationId,
          roleId,
          permissionCode: code,
        })),
      );
    }

    await assertOrganizationRetainsAdmin(tx, actor.organizationId);

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "core.role.permissions_set",
      entityType: "role",
      entityId: roleId,
      before: { permissionCodes: currentCodes },
      after: { permissionCodes: requestedCodes },
    });

    return { roleId, permissionCodes: requestedCodes };
  });
}

import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { assertPermission } from "@/core/tenancy";
import {
  coreBranches,
  coreOrganizationMemberships,
  financePaymentMethods,
  gamingAreas,
  gamingDeviceTypes,
  gamingDevices,
  gamingPricingAssignments,
  gamingPricingPlans,
} from "@/db/schema";
import { withTenant, type AppDatabase } from "@/db/tenant";
import { PERMISSIONS, type OrganizationActor } from "@/modules/identity/types";
import type { SetupStepStatus } from "./setup-types";

export type { SetupStepId, SetupStepStatus } from "./setup-types";

export type GamingCenterSetupStatus = {
  operationallyReady: boolean;
  steps: SetupStepStatus[];
};

/**
 * Derives first-time business setup from actual tenant rows.
 * Does not invent a wizard-progress table. /setup (identity bootstrap) is separate.
 */
export async function getGamingCenterSetupStatus(
  db: AppDatabase,
  actor: OrganizationActor,
): Promise<GamingCenterSetupStatus> {
  assertPermission(actor, PERMISSIONS.organizationsRead);

  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const org = actor.organizationId;
    const [branchCount] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(coreBranches)
      .where(and(eq(coreBranches.organizationId, org), ne(coreBranches.status, "ARCHIVED")));
    const [areaCount] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(gamingAreas)
      .where(and(eq(gamingAreas.organizationId, org), eq(gamingAreas.status, "ACTIVE")));
    const [typeCount] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(gamingDeviceTypes)
      .where(and(eq(gamingDeviceTypes.organizationId, org), eq(gamingDeviceTypes.status, "ACTIVE")));
    const [deviceCount] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(gamingDevices)
      .where(and(eq(gamingDevices.organizationId, org), isNull(gamingDevices.archivedAt)));
    const [planCount] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(gamingPricingPlans)
      .where(and(eq(gamingPricingPlans.organizationId, org), eq(gamingPricingPlans.status, "ACTIVE")));
    const [assignmentCount] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(gamingPricingAssignments)
      .where(
        and(
          eq(gamingPricingAssignments.organizationId, org),
          eq(gamingPricingAssignments.status, "ACTIVE"),
        ),
      );
    const [paymentCount] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(financePaymentMethods)
      .where(and(eq(financePaymentMethods.organizationId, org), eq(financePaymentMethods.status, "ACTIVE")));
    const [memberCount] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(coreOrganizationMemberships)
      .where(eq(coreOrganizationMemberships.organizationId, org));

    const steps: SetupStepStatus[] = [
      {
        id: "branch",
        label: "Branch ready",
        done: (branchCount?.n ?? 0) > 0,
        optional: false,
        href: "/admin/branches",
      },
      {
        id: "area",
        label: "Areas ready",
        done: (areaCount?.n ?? 0) > 0,
        optional: false,
        href: "/admin/gaming/areas",
      },
      {
        id: "deviceType",
        label: "Device types ready",
        done: (typeCount?.n ?? 0) > 0,
        optional: false,
        href: "/admin/gaming/device-types",
      },
      {
        id: "device",
        label: "Devices ready",
        done: (deviceCount?.n ?? 0) > 0,
        optional: false,
        href: "/admin/gaming/devices",
      },
      {
        id: "pricing",
        label: "Pricing ready",
        done: (planCount?.n ?? 0) > 0,
        optional: false,
        href: "/admin/gaming/pricing",
      },
      {
        id: "assignment",
        label: "Prices assigned to the floor",
        done: (assignmentCount?.n ?? 0) > 0,
        optional: false,
        href: "/admin/gaming/pricing",
      },
      {
        id: "payments",
        label: "Payment methods ready",
        done: (paymentCount?.n ?? 0) > 0,
        optional: false,
        href: "/admin/onboarding",
      },
      {
        id: "staff",
        label: "Staff invited",
        done: (memberCount?.n ?? 0) > 1,
        optional: true,
        href: "/admin/users",
      },
    ];

    const required = steps.filter((step) => !step.optional);
    return {
      operationallyReady: required.every((step) => step.done),
      steps,
    };
  });
}

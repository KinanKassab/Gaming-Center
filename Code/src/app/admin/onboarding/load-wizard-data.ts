import { PERMISSIONS, listBranches, listMemberships, listRoles } from "@/modules/identity";
import { listCustomers } from "@/modules/customers";
import { listProducts } from "@/modules/catalog";
import {
  listAccessibleBranches,
  listAreas,
  listDeviceTypes,
  listDevices,
  listPricingAssignments,
  listPricingPlans,
  serializePricingPlan,
} from "@/modules/gaming";
import type { OrganizationContext } from "@/auth/context";
import type { AppDatabase } from "@/db/client";
import type { WizardStaffMember } from "@/app/admin/onboarding/wizard-staff";

export type WizardPricingPlan = {
  id: string;
  name: string;
  status: string;
  pricingModel: string;
  currency: string;
  rateMinor: string | null;
  billingUnitSeconds: number | null;
  roundingMode: string;
  timeBillingMode: string;
  packagePriceMinor: string | null;
  packageDurationSeconds: number | null;
};

export type WizardPricingAssignment = {
  id: string;
  pricingPlanId: string;
  scopeType: string;
  scopeId: string;
  status: string;
};

export async function loadOnboardingWizardLists(db: AppDatabase, organization: OrganizationContext) {
  const branches = organization.actor.permissions.includes(PERMISSIONS.branchesRead)
    ? await listBranches(db, organization.actor)
    : [];
  const manageBranches = organization.actor.permissions.includes(PERMISSIONS.gamingMasterRead)
    ? (await listAccessibleBranches(db, organization.actor, "MANAGE")).filter((branch) => branch.status !== "ARCHIVED")
    : [];
  const areas = organization.actor.permissions.includes(PERMISSIONS.gamingMasterRead)
    ? await listAreas(db, organization.actor)
    : [];
  const deviceTypes = organization.actor.permissions.includes(PERMISSIONS.gamingMasterRead)
    ? await listDeviceTypes(db, organization.actor)
    : [];
  const devices = organization.actor.permissions.includes(PERMISSIONS.gamingMasterRead)
    ? await listDevices(db, organization.actor)
    : [];
  const planRows = organization.actor.permissions.includes(PERMISSIONS.gamingMasterRead)
    ? await listPricingPlans(db, organization.actor)
    : [];
  const plans: WizardPricingPlan[] = planRows.map((plan) => {
    const json = serializePricingPlan(plan);
    return {
      id: plan.id,
      name: plan.name,
      status: plan.status,
      pricingModel: plan.pricingModel,
      currency: plan.currency,
      rateMinor: json.rateMinor,
      billingUnitSeconds: plan.billingUnitSeconds,
      roundingMode: plan.roundingMode,
      timeBillingMode: plan.timeBillingMode,
      packagePriceMinor: json.packagePriceMinor,
      packageDurationSeconds: plan.packageDurationSeconds,
    };
  });
  const assignmentRows = organization.actor.permissions.includes(PERMISSIONS.gamingMasterRead)
    ? await listPricingAssignments(db, organization.actor)
    : [];
  const assignments: WizardPricingAssignment[] = assignmentRows.map((row) => ({
    id: row.id,
    pricingPlanId: row.pricingPlanId,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    status: row.status,
  }));
  const memberships = organization.actor.permissions.includes(PERMISSIONS.membershipsRead)
    ? await listMemberships(db, organization.actor)
    : [];
  const staff: WizardStaffMember[] = memberships.map((membership) => ({
    membershipId: membership.membershipId,
    userId: membership.user.id,
    displayName: membership.user.displayName,
    email: membership.user.email,
    status: membership.status,
    joinedAt: membership.joinedAt ? membership.joinedAt.toISOString() : null,
    roles: membership.roles,
  }));
  const canReadCustomers = organization.actor.permissions.includes(PERMISSIONS.customersRead);
  const canManageCustomers = organization.actor.permissions.includes(PERMISSIONS.customersManage);
  const customers = canReadCustomers
    ? (await listCustomers(db, organization.actor, { limit: 100 })).map((customer) => ({
        id: customer.id,
        displayName: customer.displayName,
        phone: customer.phoneNormalized,
      }))
    : [];
  const canReadCatalog = organization.actor.permissions.includes(PERMISSIONS.posCatalogRead);
  const canManageCatalog = organization.actor.permissions.includes(PERMISSIONS.posCatalogManage);
  const products = canReadCatalog
    ? (await listProducts(db, organization.actor)).map((product) => ({
        id: product.id,
        name: product.name,
        status: product.status,
      }))
    : [];
  const canReadRoles = organization.actor.permissions.includes(PERMISSIONS.rolesRead);
  const canManageRoles =
    canReadRoles && organization.actor.permissions.includes(PERMISSIONS.membershipsManage);
  const roles = canReadRoles
    ? (await listRoles(db, organization.actor)).map((role) => ({
        roleId: role.roleId,
        code: role.code,
        name: role.name,
        status: role.status,
      }))
    : [];
  return {
    branches,
    manageBranches,
    areas,
    deviceTypes,
    devices,
    plans,
    assignments,
    staff,
    customers,
    products,
    roles,
    canManageCustomers,
    canManageCatalog,
    canManageRoles,
  };
}

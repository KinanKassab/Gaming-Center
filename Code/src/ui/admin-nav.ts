import { PERMISSIONS } from "@/modules/identity/types";

export const ADMIN_NAV_HREFS = {
  dashboard: "/admin",
  floor: "/admin/gaming/floor",
  reports: "/admin/reports",
  customers: "/admin/customers",
  onboarding: "/admin/onboarding",
  branches: "/admin/branches",
  areas: "/admin/gaming/areas",
  deviceTypes: "/admin/gaming/device-types",
  devices: "/admin/gaming/devices",
  pricing: "/admin/gaming/pricing",
  catalog: "/admin/catalog",
  staff: "/admin/users",
  roles: "/admin/roles",
  settings: "/admin/settings",
  audit: "/admin/audit",
} as const;

export type AdminNavHref = (typeof ADMIN_NAV_HREFS)[keyof typeof ADMIN_NAV_HREFS];

/** Retired list URL. Detail/checkout stay under this prefix. */
export const GAMING_SESSIONS_LIST_PATH = "/admin/gaming/sessions";

export function isGamingSessionsListPath(pathname: string): boolean {
  return pathname === GAMING_SESSIONS_LIST_PATH || pathname === `${GAMING_SESSIONS_LIST_PATH}/`;
}

/** Retired list → reports. `search` is `URL.search` (`""` or `?…`). */
export function retiredSessionsListHref(search: string): string {
  return `${ADMIN_NAV_HREFS.reports}${search}`;
}

export function hasViewBranchGrant(
  branchAccess: ReadonlyArray<{ accessMode: string }>,
): boolean {
  return branchAccess.some(
    (row) => row.accessMode === "VIEW" || row.accessMode === "OPERATE" || row.accessMode === "MANAGE",
  );
}

export function shouldShowAdminNavHref(
  href: string,
  input: {
    permissions: ReadonlyArray<string>;
    hasViewBranchGrant: boolean;
    /** The signed-in user has no center yet and may create the first one. */
    canCreateFirstOrganization?: boolean;
    /** Non-archived branches. Hide the Branches item when there is exactly one. */
    visibleBranchCount?: number;
  },
): boolean {
  const permissions = input.permissions;
  switch (href) {
    case ADMIN_NAV_HREFS.dashboard:
      return true;
    case ADMIN_NAV_HREFS.floor:
    case ADMIN_NAV_HREFS.reports:
      return permissions.includes(PERMISSIONS.gamingSessionsRead) && input.hasViewBranchGrant;
    case ADMIN_NAV_HREFS.customers:
      return permissions.includes(PERMISSIONS.customersRead);
    case ADMIN_NAV_HREFS.onboarding:
      return (
        input.canCreateFirstOrganization === true ||
        permissions.includes(PERMISSIONS.branchesManage) ||
        permissions.includes(PERMISSIONS.gamingMasterManage)
      );
    case ADMIN_NAV_HREFS.branches:
      return permissions.includes(PERMISSIONS.branchesRead) && (input.visibleBranchCount ?? 0) !== 1;
    case ADMIN_NAV_HREFS.areas:
    case ADMIN_NAV_HREFS.devices:
    case ADMIN_NAV_HREFS.pricing:
      return permissions.includes(PERMISSIONS.gamingMasterRead);
    case ADMIN_NAV_HREFS.catalog:
      return permissions.includes(PERMISSIONS.posCatalogRead);
    case ADMIN_NAV_HREFS.deviceTypes:
      return false;
    case ADMIN_NAV_HREFS.staff:
      return permissions.includes(PERMISSIONS.membershipsRead);
    case ADMIN_NAV_HREFS.roles:
      return permissions.includes(PERMISSIONS.rolesRead);
    case ADMIN_NAV_HREFS.settings:
      return permissions.includes(PERMISSIONS.settingsRead);
    case ADMIN_NAV_HREFS.audit:
      return permissions.includes(PERMISSIONS.auditRead);
    default:
      return false;
  }
}

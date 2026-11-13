import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
};

export const coreOrganizations = pgTable("core_organizations", {
  id: uuid("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  status: text("status").notNull(),
  defaultCurrency: char("default_currency", { length: 3 }).notNull(),
  timezone: text("timezone").notNull(),
  locale: text("locale").notNull(),
  createdAt: timestamps.createdAt,
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const coreBranches = pgTable(
  "core_branches",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull(),
    timezone: text("timezone"),
    addressText: text("address_text"),
    phone: text("phone"),
    createdAt: timestamps.createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("core_branches_org_code_key").on(table.organizationId, table.code),
    uniqueIndex("core_branches_id_org_key").on(table.id, table.organizationId),
    uniqueIndex("core_branches_org_name_normalized_key").on(
      table.organizationId,
      sql`lower(btrim(${table.name}))`,
    ),
    index("core_branches_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const coreUsers = pgTable(
  "core_users",
  {
    id: uuid("id").primaryKey(),
    authSubject: text("auth_subject").notNull(),
    email: text("email"),
    displayName: text("display_name").notNull(),
    status: text("status").notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    accessRevokedAt: timestamp("access_revoked_at", { withTimezone: true }),
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("core_users_auth_subject_key").on(table.authSubject),
    uniqueIndex("core_users_email_lower_key")
      .on(sql`lower(${table.email})`)
      .where(sql`email IS NOT NULL`),
  ],
);

/**
 * Platform singleton (no RLS). Serializes first HTTP sign-up and records the
 * initial organization so public onboarding can fail closed. Not tenant data.
 */
export const corePlatformBootstrap = pgTable("core_platform_bootstrap", {
  singleton: boolean("singleton").primaryKey().default(true),
  signupClaimedAt: timestamp("signup_claimed_at", { withTimezone: true }),
  firstCoreUserId: uuid("first_core_user_id").references(() => coreUsers.id),
  firstOrganizationId: uuid("first_organization_id").references(() => coreOrganizations.id),
  createdAt: timestamps.createdAt,
});

export const coreOrganizationMemberships = pgTable(
  "core_organization_memberships",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => coreUsers.id),
    status: text("status").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("core_organization_memberships_org_user_key").on(table.organizationId, table.userId),
    uniqueIndex("core_organization_memberships_id_org_key").on(table.id, table.organizationId),
    index("core_organization_memberships_user_status_idx").on(table.userId, table.status),
  ],
);

export const coreRoles = pgTable(
  "core_roles",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    status: text("status").notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("core_roles_org_code_key").on(table.organizationId, table.code),
    uniqueIndex("core_roles_id_org_key").on(table.id, table.organizationId),
  ],
);

export const corePermissions = pgTable("core_permissions", {
  code: text("code").primaryKey(),
  module: text("module").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  riskLevel: text("risk_level").notNull(),
});

export const coreRolePermissions = pgTable(
  "core_role_permissions",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    roleId: uuid("role_id").notNull(),
    permissionCode: text("permission_code")
      .notNull()
      .references(() => corePermissions.code),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionCode] }),
    foreignKey({
      columns: [table.roleId, table.organizationId],
      foreignColumns: [coreRoles.id, coreRoles.organizationId],
    }),
    index("core_role_permissions_org_role_idx").on(table.organizationId, table.roleId),
  ],
);

export const coreMembershipRoles = pgTable(
  "core_membership_roles",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    membershipId: uuid("membership_id").notNull(),
    roleId: uuid("role_id").notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("core_membership_roles_mem_role_key").on(table.membershipId, table.roleId),
    foreignKey({
      columns: [table.membershipId, table.organizationId],
      foreignColumns: [coreOrganizationMemberships.id, coreOrganizationMemberships.organizationId],
    }),
    foreignKey({
      columns: [table.roleId, table.organizationId],
      foreignColumns: [coreRoles.id, coreRoles.organizationId],
    }),
  ],
);

export const coreBranchAccess = pgTable(
  "core_branch_access",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    membershipId: uuid("membership_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    accessMode: text("access_mode").notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("core_branch_access_mem_branch_key").on(table.membershipId, table.branchId),
    foreignKey({
      columns: [table.membershipId, table.organizationId],
      foreignColumns: [coreOrganizationMemberships.id, coreOrganizationMemberships.organizationId],
    }),
    foreignKey({
      columns: [table.branchId, table.organizationId],
      foreignColumns: [coreBranches.id, coreBranches.organizationId],
    }),
    index("core_branch_access_org_branch_idx").on(table.organizationId, table.branchId),
  ],
);

export const coreSettingsDefinitions = pgTable("core_settings_definitions", {
  key: text("key").primaryKey(),
  module: text("module").notNull(),
  valueType: text("value_type").notNull(),
  defaultValue: jsonb("default_value"),
  allowedScopes: text("allowed_scopes").array().notNull(),
  description: text("description"),
  isSensitive: boolean("is_sensitive").notNull().default(false),
});

export const coreSettingValues = pgTable(
  "core_setting_values",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    settingKey: text("setting_key")
      .notNull()
      .references(() => coreSettingsDefinitions.key),
    scope: text("scope").notNull(),
    scopeId: uuid("scope_id").notNull(),
    branchId: uuid("branch_id"),
    value: jsonb("value").notNull(),
    createdAt: timestamps.createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("core_setting_values_scope_key").on(
      table.organizationId,
      table.settingKey,
      table.scope,
      table.scopeId,
    ),
    foreignKey({
      columns: [table.branchId, table.organizationId],
      foreignColumns: [coreBranches.id, coreBranches.organizationId],
    }),
    check("core_setting_values_scope_chk", sql`scope IN ('ORGANIZATION', 'BRANCH', 'ENTITY')`),
    check(
      "core_setting_values_scope_shape_chk",
      sql`(
        (scope = 'ORGANIZATION' AND branch_id IS NULL AND scope_id = organization_id)
        OR (scope = 'BRANCH' AND branch_id IS NOT NULL AND scope_id = branch_id)
        OR (scope = 'ENTITY')
      )`,
    ),
  ],
);

export const coreFeatures = pgTable("core_features", {
  code: text("code").primaryKey(),
  module: text("module").notNull(),
  description: text("description"),
  defaultEnabled: boolean("default_enabled").notNull().default(false),
});

export const coreOrganizationFeatures = pgTable(
  "core_organization_features",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    featureCode: text("feature_code")
      .notNull()
      .references(() => coreFeatures.code),
    enabled: boolean("enabled").notNull(),
    config: jsonb("config"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.featureCode] })],
);

export const coreCustomers = pgTable(
  "core_customers",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    customerCode: text("customer_code"),
    displayName: text("display_name").notNull(),
    phoneNormalized: text("phone_normalized"),
    emailNormalized: text("email_normalized"),
    status: text("status").notNull(),
    notes: text("notes"),
    portalToken: uuid("portal_token").notNull(),
    createdBranchId: uuid("created_branch_id"),
    createdBy: uuid("created_by").references(() => coreUsers.id),
    createdAt: timestamps.createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("core_customers_id_org_key").on(table.id, table.organizationId),
    foreignKey({
      columns: [table.createdBranchId, table.organizationId],
      foreignColumns: [coreBranches.id, coreBranches.organizationId],
    }),
    uniqueIndex("core_customers_portal_token_key").on(table.portalToken),
    index("core_customers_org_phone_idx").on(table.organizationId, table.phoneNormalized),
    index("core_customers_org_name_idx").on(table.organizationId, table.displayName),
    index("core_customers_org_email_idx").on(table.organizationId, table.emailNormalized),
    check("core_customers_status_chk", sql`status IN ('ACTIVE', 'BLOCKED', 'ARCHIVED')`),
    check("core_customers_display_name_chk", sql`char_length(btrim(display_name)) > 0`),
  ],
);

export const coreAuditLogs = pgTable(
  "core_audit_logs",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    branchId: uuid("branch_id"),
    actorUserId: uuid("actor_user_id").references(() => coreUsers.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    beforeData: jsonb("before_data"),
    afterData: jsonb("after_data"),
    metadata: jsonb("metadata"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.branchId, table.organizationId],
      foreignColumns: [coreBranches.id, coreBranches.organizationId],
    }),
    index("core_audit_logs_org_time_idx").on(table.organizationId, table.occurredAt),
  ],
);

export const coreOutboxEvents = pgTable("core_outbox_events", {
  id: uuid("id").primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => coreOrganizations.id),
  branchId: uuid("branch_id"),
  eventType: text("event_type").notNull(),
  aggregateType: text("aggregate_type").notNull(),
  aggregateId: uuid("aggregate_id").notNull(),
  payload: jsonb("payload").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
});

export const coreIdempotencyKeys = pgTable(
  "core_idempotency_keys",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    scope: text("scope").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash"),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    createdAt: timestamps.createdAt,
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("core_idempotency_keys_org_scope_key").on(
      table.organizationId,
      table.scope,
      table.idempotencyKey,
    ),
  ],
);

export const gamingAreas = pgTable(
  "gaming_areas",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    branchId: uuid("branch_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    status: text("status").notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("gaming_areas_org_branch_code_key").on(table.organizationId, table.branchId, table.code),
    uniqueIndex("gaming_areas_id_org_key").on(table.id, table.organizationId),
    uniqueIndex("gaming_areas_id_org_branch_key").on(table.id, table.organizationId, table.branchId),
    foreignKey({
      columns: [table.branchId, table.organizationId],
      foreignColumns: [coreBranches.id, coreBranches.organizationId],
    }),
    index("gaming_areas_org_branch_status_idx").on(table.organizationId, table.branchId, table.status),
    check("gaming_areas_status_chk", sql`status IN ('ACTIVE', 'ARCHIVED')`),
    check("gaming_areas_code_chk", sql`char_length(btrim(code)) > 0`),
    check("gaming_areas_name_chk", sql`char_length(btrim(name)) > 0`),
  ],
);

export const gamingDeviceTypes = pgTable(
  "gaming_device_types",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    category: text("category"),
    status: text("status").notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("gaming_device_types_org_code_key").on(table.organizationId, table.code),
    uniqueIndex("gaming_device_types_id_org_key").on(table.id, table.organizationId),
    index("gaming_device_types_org_status_idx").on(table.organizationId, table.status),
    check("gaming_device_types_status_chk", sql`status IN ('ACTIVE', 'ARCHIVED')`),
    check("gaming_device_types_code_chk", sql`char_length(btrim(code)) > 0`),
    check("gaming_device_types_name_chk", sql`char_length(btrim(name)) > 0`),
  ],
);

export const gamingDevices = pgTable(
  "gaming_devices",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    branchId: uuid("branch_id").notNull(),
    areaId: uuid("area_id").notNull(),
    deviceTypeId: uuid("device_type_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    operationalStatus: text("operational_status").notNull(),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamps.createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("gaming_devices_org_branch_code_key").on(table.organizationId, table.branchId, table.code),
    uniqueIndex("gaming_devices_id_org_key").on(table.id, table.organizationId),
    uniqueIndex("gaming_devices_id_org_branch_key").on(table.id, table.organizationId, table.branchId),
    foreignKey({
      columns: [table.branchId, table.organizationId],
      foreignColumns: [coreBranches.id, coreBranches.organizationId],
    }),
    foreignKey({
      columns: [table.areaId, table.organizationId, table.branchId],
      foreignColumns: [gamingAreas.id, gamingAreas.organizationId, gamingAreas.branchId],
    }),
    foreignKey({
      columns: [table.deviceTypeId, table.organizationId],
      foreignColumns: [gamingDeviceTypes.id, gamingDeviceTypes.organizationId],
    }),
    index("gaming_devices_org_branch_area_status_idx").on(
      table.organizationId,
      table.branchId,
      table.areaId,
      table.operationalStatus,
    ),
    check(
      "gaming_devices_operational_status_chk",
      sql`operational_status IN ('ENABLED', 'MAINTENANCE', 'DISABLED')`,
    ),
    check("gaming_devices_code_chk", sql`char_length(btrim(code)) > 0`),
    check("gaming_devices_name_chk", sql`char_length(btrim(name)) > 0`),
  ],
);

export const gamingPricingPlans = pgTable(
  "gaming_pricing_plans",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    pricingModel: text("pricing_model").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    rateMinor: bigint("rate_minor", { mode: "bigint" }),
    billingUnitSeconds: integer("billing_unit_seconds"),
    roundingMode: text("rounding_mode").notNull(),
    minimumBillableSeconds: integer("minimum_billable_seconds").notNull().default(0),
    minimumChargeMinor: bigint("minimum_charge_minor", { mode: "bigint" }).notNull().default(0n),
    timeBillingMode: text("time_billing_mode").notNull().default("UNIT"),
    packageDurationSeconds: integer("package_duration_seconds"),
    packagePriceMinor: bigint("package_price_minor", { mode: "bigint" }),
    status: text("status").notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("gaming_pricing_plans_org_code_key").on(table.organizationId, table.code),
    uniqueIndex("gaming_pricing_plans_id_org_key").on(table.id, table.organizationId),
    index("gaming_pricing_plans_org_status_idx").on(table.organizationId, table.status),
    check("gaming_pricing_plans_status_chk", sql`status IN ('ACTIVE', 'ARCHIVED')`),
    check("gaming_pricing_plans_model_chk", sql`pricing_model IN ('TIME_BASED', 'PACKAGE')`),
    check("gaming_pricing_plans_rounding_chk", sql`rounding_mode IN ('CEIL', 'NEAREST', 'FLOOR')`),
    check("gaming_pricing_plans_time_billing_mode_chk", sql`time_billing_mode IN ('UNIT', 'PRORATED_HOUR')`),
    check(
      "gaming_pricing_plans_time_billing_model_chk",
      sql`pricing_model <> 'PACKAGE' OR time_billing_mode = 'UNIT'`,
    ),
    check("gaming_pricing_plans_currency_chk", sql`currency ~ '^[A-Z]{3}$'`),
    check("gaming_pricing_plans_code_chk", sql`char_length(btrim(code)) > 0`),
    check("gaming_pricing_plans_name_chk", sql`char_length(btrim(name)) > 0`),
    check(
      "gaming_pricing_plans_minimums_chk",
      sql`minimum_billable_seconds >= 0 AND minimum_charge_minor >= 0`,
    ),
  ],
);

export const gamingPricingAssignments = pgTable(
  "gaming_pricing_assignments",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    branchId: uuid("branch_id"),
    pricingPlanId: uuid("pricing_plan_id").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeId: uuid("scope_id").notNull(),
    priority: integer("priority").notNull().default(0),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    status: text("status").notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("gaming_pricing_assignments_id_org_key").on(table.id, table.organizationId),
    foreignKey({
      columns: [table.pricingPlanId, table.organizationId],
      foreignColumns: [gamingPricingPlans.id, gamingPricingPlans.organizationId],
    }),
    foreignKey({
      columns: [table.branchId, table.organizationId],
      foreignColumns: [coreBranches.id, coreBranches.organizationId],
    }),
    index("gaming_pricing_assignments_scope_idx").on(
      table.organizationId,
      table.branchId,
      table.scopeType,
      table.scopeId,
      table.validFrom,
    ),
    check(
      "gaming_pricing_assignments_scope_type_chk",
      sql`scope_type IN ('ORGANIZATION', 'BRANCH', 'AREA', 'DEVICE_TYPE', 'DEVICE')`,
    ),
    check("gaming_pricing_assignments_status_chk", sql`status IN ('ACTIVE', 'INACTIVE')`),
    check(
      "gaming_pricing_assignments_validity_chk",
      sql`valid_to IS NULL OR valid_to > valid_from`,
    ),
  ],
);

export const gamingSessions = pgTable(
  "gaming_sessions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    branchId: uuid("branch_id").notNull(),
    sessionNumber: text("session_number").notNull(),
    customerId: uuid("customer_id"),
    sessionType: text("session_type").notNull(),
    status: text("status").notNull(),
    currentDeviceId: uuid("current_device_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    requestedEndAt: timestamp("requested_end_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    gamingTotalMinor: bigint("gaming_total_minor", { mode: "bigint" }),
    chargeId: uuid("charge_id"),
    billingFinalizedAt: timestamp("billing_finalized_at", { withTimezone: true }),
    billingRuleVersion: text("billing_rule_version"),
    billingCurrency: char("billing_currency", { length: 3 }),
    billingBreakdown: jsonb("billing_breakdown"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => coreUsers.id),
    closedBy: uuid("closed_by").references(() => coreUsers.id),
    cancelReason: text("cancel_reason"),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("gaming_sessions_org_branch_number_key").on(
      table.organizationId,
      table.branchId,
      table.sessionNumber,
    ),
    uniqueIndex("gaming_sessions_id_org_key").on(table.id, table.organizationId),
    uniqueIndex("gaming_sessions_id_org_branch_key").on(
      table.id,
      table.organizationId,
      table.branchId,
    ),
    uniqueIndex("uq_gaming_sessions_one_active_per_device")
      .on(table.currentDeviceId)
      .where(sql`current_device_id IS NOT NULL AND status IN ('ACTIVE', 'PAUSED')`),
    foreignKey({
      columns: [table.branchId, table.organizationId],
      foreignColumns: [coreBranches.id, coreBranches.organizationId],
    }),
    foreignKey({
      columns: [table.currentDeviceId, table.organizationId, table.branchId],
      foreignColumns: [gamingDevices.id, gamingDevices.organizationId, gamingDevices.branchId],
    }),
    foreignKey({
      columns: [table.customerId, table.organizationId],
      foreignColumns: [coreCustomers.id, coreCustomers.organizationId],
    }),
    index("idx_gaming_sessions_org_branch_started").on(
      table.organizationId,
      table.branchId,
      table.startedAt,
    ),
    index("idx_gaming_sessions_org_branch_status_started").on(
      table.organizationId,
      table.branchId,
      table.status,
      table.startedAt,
    ),
    check("gaming_sessions_type_chk", sql`session_type IN ('OPEN', 'FIXED')`),
    check(
      "gaming_sessions_status_chk",
      sql`status IN ('ACTIVE', 'PAUSED', 'ENDING', 'COMPLETED', 'CANCELLED')`,
    ),
  ],
);

export const gamingSessionSegments = pgTable(
  "gaming_session_segments",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    branchId: uuid("branch_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    pricingPlanId: uuid("pricing_plan_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    pricingSnapshot: jsonb("pricing_snapshot").notNull(),
    computedAmountMinor: bigint("computed_amount_minor", { mode: "bigint" }),
    endReason: text("end_reason"),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("gaming_session_segments_id_org_key").on(table.id, table.organizationId),
    uniqueIndex("uq_gaming_session_segments_one_open")
      .on(table.sessionId)
      .where(sql`ended_at IS NULL`),
    foreignKey({
      columns: [table.branchId, table.organizationId],
      foreignColumns: [coreBranches.id, coreBranches.organizationId],
    }),
    foreignKey({
      columns: [table.sessionId, table.organizationId, table.branchId],
      foreignColumns: [gamingSessions.id, gamingSessions.organizationId, gamingSessions.branchId],
    }),
    foreignKey({
      columns: [table.deviceId, table.organizationId, table.branchId],
      foreignColumns: [gamingDevices.id, gamingDevices.organizationId, gamingDevices.branchId],
    }),
    foreignKey({
      columns: [table.pricingPlanId, table.organizationId],
      foreignColumns: [gamingPricingPlans.id, gamingPricingPlans.organizationId],
    }),
    index("idx_gaming_session_segments_session_started").on(table.sessionId, table.startedAt),
  ],
);

export const gamingSessionPauses = pgTable(
  "gaming_session_pauses",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    branchId: uuid("branch_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    isBillable: boolean("is_billable").notNull().default(false),
    reason: text("reason"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => coreUsers.id),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("gaming_session_pauses_id_org_key").on(table.id, table.organizationId),
    uniqueIndex("uq_gaming_session_pauses_one_open")
      .on(table.sessionId)
      .where(sql`ended_at IS NULL`),
    foreignKey({
      columns: [table.branchId, table.organizationId],
      foreignColumns: [coreBranches.id, coreBranches.organizationId],
    }),
    foreignKey({
      columns: [table.sessionId, table.organizationId, table.branchId],
      foreignColumns: [gamingSessions.id, gamingSessions.organizationId, gamingSessions.branchId],
    }),
    index("idx_gaming_session_pauses_session_started").on(table.sessionId, table.startedAt),
  ],
);

export const financePaymentMethods = pgTable(
  "finance_payment_methods",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    methodType: text("method_type").notNull(),
    requiresReference: boolean("requires_reference").notNull().default(false),
    status: text("status").notNull(),
    config: jsonb("config"),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("finance_payment_methods_id_org_key").on(table.id, table.organizationId),
    uniqueIndex("finance_payment_methods_org_code_key").on(table.organizationId, table.code),
    index("finance_payment_methods_org_status_idx").on(table.organizationId, table.status),
    check("finance_payment_methods_type_chk", sql`method_type IN ('CASH', 'MANUAL', 'INTEGRATED', 'WALLET')`),
    check("finance_payment_methods_status_chk", sql`status IN ('ACTIVE', 'INACTIVE')`),
  ],
);

export const financeCharges = pgTable(
  "finance_charges",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    branchId: uuid("branch_id").notNull(),
    customerId: uuid("customer_id"),
    sourceModule: text("source_module").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    status: text("status").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    subtotalMinor: bigint("subtotal_minor", { mode: "bigint" }).notNull(),
    discountMinor: bigint("discount_minor", { mode: "bigint" }).notNull(),
    taxMinor: bigint("tax_minor", { mode: "bigint" }).notNull(),
    totalMinor: bigint("total_minor", { mode: "bigint" }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => coreUsers.id),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("finance_charges_id_org_key").on(table.id, table.organizationId),
    uniqueIndex("finance_charges_id_org_branch_key").on(table.id, table.organizationId, table.branchId),
    uniqueIndex("finance_charges_source_key").on(
      table.organizationId,
      table.sourceModule,
      table.sourceType,
      table.sourceId,
    ),
    foreignKey({
      columns: [table.branchId, table.organizationId],
      foreignColumns: [coreBranches.id, coreBranches.organizationId],
    }),
    foreignKey({
      columns: [table.customerId, table.organizationId],
      foreignColumns: [coreCustomers.id, coreCustomers.organizationId],
    }),
    index("finance_charges_org_branch_issued_idx").on(
      table.organizationId,
      table.branchId,
      table.issuedAt,
    ),
    check("finance_charges_status_chk", sql`status IN ('OPEN', 'PARTIALLY_PAID', 'PAID')`),
    check("finance_charges_currency_chk", sql`currency ~ '^[A-Z]{3}$'`),
  ],
);

export const financeChargeItems = pgTable(
  "finance_charge_items",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    chargeId: uuid("charge_id").notNull(),
    itemType: text("item_type").notNull(),
    descriptionSnapshot: text("description_snapshot").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 3, mode: "string" }).notNull(),
    unitAmountMinor: bigint("unit_amount_minor", { mode: "bigint" }).notNull(),
    totalMinor: bigint("total_minor", { mode: "bigint" }).notNull(),
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("finance_charge_items_id_org_key").on(table.id, table.organizationId),
    foreignKey({
      columns: [table.chargeId, table.organizationId],
      foreignColumns: [financeCharges.id, financeCharges.organizationId],
    }),
    index("finance_charge_items_org_charge_idx").on(table.organizationId, table.chargeId),
  ],
);

export const financePayments = pgTable(
  "finance_payments",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    branchId: uuid("branch_id").notNull(),
    customerId: uuid("customer_id"),
    paymentMethodId: uuid("payment_method_id").notNull(),
    status: text("status").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    externalReference: text("external_reference"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => coreUsers.id),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("finance_payments_id_org_key").on(table.id, table.organizationId),
    uniqueIndex("finance_payments_id_org_branch_key").on(
      table.id,
      table.organizationId,
      table.branchId,
    ),
    foreignKey({
      columns: [table.branchId, table.organizationId],
      foreignColumns: [coreBranches.id, coreBranches.organizationId],
    }),
    foreignKey({
      columns: [table.customerId, table.organizationId],
      foreignColumns: [coreCustomers.id, coreCustomers.organizationId],
    }),
    foreignKey({
      columns: [table.paymentMethodId, table.organizationId],
      foreignColumns: [financePaymentMethods.id, financePaymentMethods.organizationId],
    }),
    index("finance_payments_org_branch_received_idx").on(
      table.organizationId,
      table.branchId,
      table.receivedAt,
    ),
    check("finance_payments_status_chk", sql`status IN ('COMPLETED')`),
    check("finance_payments_currency_chk", sql`currency ~ '^[A-Z]{3}$'`),
    check("finance_payments_amount_chk", sql`amount_minor > 0`),
  ],
);

export const financePaymentAllocations = pgTable(
  "finance_payment_allocations",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    paymentId: uuid("payment_id").notNull(),
    chargeId: uuid("charge_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("finance_payment_allocations_id_org_key").on(table.id, table.organizationId),
    foreignKey({
      columns: [table.paymentId, table.organizationId],
      foreignColumns: [financePayments.id, financePayments.organizationId],
    }),
    foreignKey({
      columns: [table.chargeId, table.organizationId],
      foreignColumns: [financeCharges.id, financeCharges.organizationId],
    }),
    index("finance_payment_allocations_payment_idx").on(table.paymentId),
    index("finance_payment_allocations_charge_idx").on(table.chargeId),
    check("finance_payment_allocations_amount_chk", sql`amount_minor > 0`),
  ],
);

export const financeExpenseCategories = pgTable(
  "finance_expense_categories",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("finance_expense_categories_id_org_key").on(table.id, table.organizationId),
    uniqueIndex("finance_expense_categories_org_code_key").on(table.organizationId, table.code),
    index("finance_expense_categories_org_status_idx").on(table.organizationId, table.status),
    check("finance_expense_categories_status_chk", sql`status IN ('ACTIVE', 'ARCHIVED')`),
  ],
);

export const financeExpenses = pgTable(
  "finance_expenses",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    branchId: uuid("branch_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    paymentMethodId: uuid("payment_method_id"),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    description: text("description").notNull(),
    status: text("status").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => coreUsers.id),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("finance_expenses_id_org_key").on(table.id, table.organizationId),
    uniqueIndex("finance_expenses_id_org_branch_key").on(
      table.id,
      table.organizationId,
      table.branchId,
    ),
    foreignKey({
      columns: [table.branchId, table.organizationId],
      foreignColumns: [coreBranches.id, coreBranches.organizationId],
    }),
    foreignKey({
      columns: [table.categoryId, table.organizationId],
      foreignColumns: [financeExpenseCategories.id, financeExpenseCategories.organizationId],
    }),
    foreignKey({
      columns: [table.paymentMethodId, table.organizationId],
      foreignColumns: [financePaymentMethods.id, financePaymentMethods.organizationId],
    }),
    index("finance_expenses_org_branch_occurred_idx").on(
      table.organizationId,
      table.branchId,
      table.occurredAt,
    ),
    check("finance_expenses_status_chk", sql`status IN ('POSTED', 'VOIDED')`),
    check("finance_expenses_currency_chk", sql`currency ~ '^[A-Z]{3}$'`),
    check("finance_expenses_amount_chk", sql`amount_minor > 0`),
  ],
);

export const financeCustomerLedgerEntries = pgTable(
  "finance_customer_ledger_entries",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    branchId: uuid("branch_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    entryKind: text("entry_kind").notNull(),
    direction: text("direction").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    description: text("description").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    sourceModule: text("source_module").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    chargeId: uuid("charge_id"),
    paymentId: uuid("payment_id"),
    createdBy: uuid("created_by").references(() => coreUsers.id),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("finance_customer_ledger_id_org_key").on(table.id, table.organizationId),
    uniqueIndex("finance_customer_ledger_source_key").on(
      table.organizationId,
      table.sourceModule,
      table.sourceType,
      table.sourceId,
    ),
    foreignKey({
      columns: [table.branchId, table.organizationId],
      foreignColumns: [coreBranches.id, coreBranches.organizationId],
    }),
    foreignKey({
      columns: [table.customerId, table.organizationId],
      foreignColumns: [coreCustomers.id, coreCustomers.organizationId],
    }),
    foreignKey({
      columns: [table.chargeId, table.organizationId],
      foreignColumns: [financeCharges.id, financeCharges.organizationId],
    }),
    foreignKey({
      columns: [table.paymentId, table.organizationId],
      foreignColumns: [financePayments.id, financePayments.organizationId],
    }),
    index("finance_customer_ledger_customer_time_idx").on(
      table.organizationId,
      table.customerId,
      table.occurredAt,
    ),
    check(
      "finance_customer_ledger_kind_chk",
      sql`entry_kind IN ('OPENING_DEBT', 'OPENING_CREDIT', 'PAYMENT', 'GAMING', 'DRINK')`,
    ),
    check("finance_customer_ledger_direction_chk", sql`direction IN ('DEBIT', 'CREDIT')`),
    check("finance_customer_ledger_amount_chk", sql`amount_minor > 0`),
    check("finance_customer_ledger_currency_chk", sql`currency ~ '^[A-Z]{3}$'`),
    check("finance_customer_ledger_description_chk", sql`char_length(btrim(description)) > 0`),
  ],
);

export const catalogCategories = pgTable(
  "catalog_categories",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    parentId: uuid("parent_id"),
    code: text("code"),
    name: text("name").notNull(),
    status: text("status").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("catalog_categories_id_org_key").on(table.id, table.organizationId),
    foreignKey({
      columns: [table.parentId, table.organizationId],
      foreignColumns: [table.id, table.organizationId],
    }),
    index("catalog_categories_org_status_idx").on(table.organizationId, table.status),
    check("catalog_categories_status_chk", sql`status IN ('ACTIVE', 'ARCHIVED')`),
  ],
);

export const catalogProducts = pgTable(
  "catalog_products",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    categoryId: uuid("category_id"),
    code: text("code").notNull(),
    sku: text("sku"),
    barcode: text("barcode"),
    name: text("name").notNull(),
    productType: text("product_type").notNull(),
    trackInventory: boolean("track_inventory").notNull().default(false),
    status: text("status").notNull(),
    createdAt: timestamps.createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("catalog_products_id_org_key").on(table.id, table.organizationId),
    uniqueIndex("catalog_products_org_code_key").on(table.organizationId, table.code),
    foreignKey({
      columns: [table.categoryId, table.organizationId],
      foreignColumns: [catalogCategories.id, catalogCategories.organizationId],
    }),
    index("catalog_products_org_status_idx").on(table.organizationId, table.status),
    check("catalog_products_type_chk", sql`product_type IN ('STOCK', 'SERVICE', 'NON_STOCK')`),
    check("catalog_products_status_chk", sql`status IN ('ACTIVE', 'ARCHIVED')`),
  ],
);

export const catalogProductPrices = pgTable(
  "catalog_product_prices",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    productId: uuid("product_id").notNull(),
    branchId: uuid("branch_id"),
    currency: char("currency", { length: 3 }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("catalog_product_prices_id_org_key").on(table.id, table.organizationId),
    foreignKey({
      columns: [table.productId, table.organizationId],
      foreignColumns: [catalogProducts.id, catalogProducts.organizationId],
    }),
    foreignKey({
      columns: [table.branchId, table.organizationId],
      foreignColumns: [coreBranches.id, coreBranches.organizationId],
    }),
    index("catalog_product_prices_lookup_idx").on(
      table.organizationId,
      table.productId,
      table.branchId,
      table.validFrom,
    ),
    check("catalog_product_prices_currency_chk", sql`currency ~ '^[A-Z]{3}$'`),
    check("catalog_product_prices_amount_chk", sql`amount_minor >= 0`),
  ],
);

export const posOrders = pgTable(
  "pos_orders",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    branchId: uuid("branch_id").notNull(),
    customerId: uuid("customer_id"),
    orderNumber: text("order_number").notNull(),
    status: text("status").notNull(),
    subtotalMinor: bigint("subtotal_minor", { mode: "bigint" }).notNull(),
    discountMinor: bigint("discount_minor", { mode: "bigint" }).notNull(),
    taxMinor: bigint("tax_minor", { mode: "bigint" }).notNull(),
    totalMinor: bigint("total_minor", { mode: "bigint" }).notNull(),
    openedBy: uuid("opened_by")
      .notNull()
      .references(() => coreUsers.id),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    chargeId: uuid("charge_id"),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("pos_orders_id_org_key").on(table.id, table.organizationId),
    uniqueIndex("pos_orders_id_org_branch_key").on(table.id, table.organizationId, table.branchId),
    uniqueIndex("pos_orders_org_branch_number_key").on(
      table.organizationId,
      table.branchId,
      table.orderNumber,
    ),
    foreignKey({
      columns: [table.branchId, table.organizationId],
      foreignColumns: [coreBranches.id, coreBranches.organizationId],
    }),
    foreignKey({
      columns: [table.customerId, table.organizationId],
      foreignColumns: [coreCustomers.id, coreCustomers.organizationId],
    }),
    foreignKey({
      columns: [table.chargeId, table.organizationId],
      foreignColumns: [financeCharges.id, financeCharges.organizationId],
    }),
    index("pos_orders_org_branch_opened_idx").on(
      table.organizationId,
      table.branchId,
      table.openedAt,
    ),
    check("pos_orders_status_chk", sql`status IN ('DRAFT', 'OPEN', 'COMPLETED', 'CANCELLED')`),
  ],
);

export const posOrderItems = pgTable(
  "pos_order_items",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    orderId: uuid("order_id").notNull(),
    productId: uuid("product_id"),
    descriptionSnapshot: text("description_snapshot").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 3, mode: "string" }).notNull(),
    unitAmountMinor: bigint("unit_amount_minor", { mode: "bigint" }).notNull(),
    totalMinor: bigint("total_minor", { mode: "bigint" }).notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("pos_order_items_id_org_key").on(table.id, table.organizationId),
    foreignKey({
      columns: [table.orderId, table.organizationId],
      foreignColumns: [posOrders.id, posOrders.organizationId],
    }),
    foreignKey({
      columns: [table.productId, table.organizationId],
      foreignColumns: [catalogProducts.id, catalogProducts.organizationId],
    }),
    index("pos_order_items_org_order_idx").on(table.organizationId, table.orderId),
  ],
);

export const gamingSessionOrderLinks = pgTable(
  "gaming_session_order_links",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => coreOrganizations.id),
    sessionId: uuid("session_id").notNull(),
    orderId: uuid("order_id").notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.orderId] }),
    foreignKey({
      columns: [table.sessionId, table.organizationId],
      foreignColumns: [gamingSessions.id, gamingSessions.organizationId],
    }),
    foreignKey({
      columns: [table.orderId, table.organizationId],
      foreignColumns: [posOrders.id, posOrders.organizationId],
    }),
    index("gaming_session_order_links_order_idx").on(table.orderId),
    index("gaming_session_order_links_org_session_idx").on(table.organizationId, table.sessionId),
  ],
);

/**
 * Gaming module — master data, session engine, Gaming Floor, and billing.
 * Occupancy is derived from ACTIVE/PAUSED sessions. Billing uses segment snapshots.
 */
export {
  createArea,
  createAreaInputSchema,
  updateArea,
  updateAreaInputSchema,
  listAreas,
  listAreasInputSchema,
  getArea,
  archiveArea,
  AREA_STATUSES,
  type CreateAreaInput,
  type UpdateAreaInput,
  type ListAreasInput,
  type AreaRecord,
  type AreaStatus,
} from "./areas";

export {
  createDeviceType,
  createDeviceTypeInputSchema,
  updateDeviceType,
  updateDeviceTypeInputSchema,
  listDeviceTypes,
  listDeviceTypesInputSchema,
  getDeviceType,
  archiveDeviceType,
  archiveWizardDeviceType,
  DEVICE_TYPE_IN_USE_REASON,
  DEVICE_TYPE_STATUSES,
  type CreateDeviceTypeInput,
  type UpdateDeviceTypeInput,
  type ListDeviceTypesInput,
  type DeviceTypeRecord,
  type DeviceTypeStatus,
} from "./device-types";

export {
  createDevice,
  createDeviceInputSchema,
  updateDevice,
  updateDeviceInputSchema,
  listDevices,
  listDevicesInputSchema,
  getDevice,
  archiveDevice,
  DEVICE_OPERATIONAL_STATUSES,
  type CreateDeviceInput,
  type UpdateDeviceInput,
  type ListDevicesInput,
  type DeviceRecord,
  type DeviceOperationalStatus,
} from "./devices";

export {
  createDevicesBulk,
  createDevicesBulkInputSchema,
  previewBulkDeviceNames,
  BULK_DEVICE_MAX_COUNT,
  type CreateDevicesBulkInput,
} from "./devices-bulk";

export {
  describeTimeBasedPrice,
  describePackagePrice,
  roundingFromPartialPeriod,
  partialPeriodFromRounding,
  parseFriendlyMajor,
  PARTIAL_PERIOD_POLICIES,
  type PartialPeriodPolicy,
} from "./pricing-adapter";

export {
  BILLING_RULE_VERSION,
  BILLING_RULE_VERSION_PRORATED,
  TIME_BILLING_PRORATED_HOUR,
  TIME_BILLING_UNIT,
  PRORATED_SNAPSHOT_FIELDS,
  allocateTotalByWeights,
  proratedHourlyAmountFromTerms,
  roundBillableSecondsProrated,
  proratedHourlyAmountMinor,
  roundToMultipleHalfUp,
} from "./billing-prorated";

export {
  createPricingPlan,
  createPricingPlanInputSchema,
  updatePricingPlan,
  updatePricingPlanInputSchema,
  listPricingPlans,
  listPricingPlansInputSchema,
  getPricingPlan,
  archivePricingPlan,
  serializePricingPlan,
  PRICING_MODELS,
  ROUNDING_MODES,
  PRICING_PLAN_STATUSES,
  type CreatePricingPlanInput,
  type UpdatePricingPlanInput,
  type ListPricingPlansInput,
  type PricingPlanRecord,
  type PricingPlanJson,
} from "./pricing-plans";

export {
  createDevicePricing,
  createDevicePricingInputSchema,
  DEVICE_PRICING_KINDS,
  type CreateDevicePricingInput,
  type DevicePricingKind,
  type DevicePricingResult,
} from "./pricing-device";

export {
  summarizeDeviceScopedPrices,
  uniqueDeviceIds,
  type DevicePriceSummaryPlan,
  type DevicePriceSummaryAssignment,
  type DeviceHourlyPriceRow,
  type DeviceOfferPriceRow,
} from "./pricing-device-summary";

export {
  createPricingAssignment,
  createPricingAssignmentInputSchema,
  updatePricingAssignment,
  updatePricingAssignmentInputSchema,
  listPricingAssignments,
  listPricingAssignmentsInputSchema,
  getPricingAssignment,
  ASSIGNMENT_SCOPE_TYPES,
  type CreatePricingAssignmentInput,
  type UpdatePricingAssignmentInput,
  type ListPricingAssignmentsInput,
  type PricingAssignmentRecord,
  type AssignmentScopeType,
} from "./pricing-assignments";

export {
  listAccessibleBranches,
  listSessionBranches,
  listGrantedBranches,
  grantedBranchIds,
} from "./access";

export {
  resolveFloorBranchId,
  resolveReportBranchId,
  firstSearchParam,
  shouldShowBranchPicker,
  soleBranchId,
} from "./branch-selection";

export {
  startSession,
  startSessionInputSchema,
  getSession,
  listSessions,
  listSessionsInputSchema,
  pauseSession,
  pauseSessionInputSchema,
  resumeSession,
  endSession,
  cancelSession,
  cancelSessionInputSchema,
  moveSession,
  moveSessionInputSchema,
  assignSessionCustomer,
  assignSessionCustomerInputSchema,
  serializeSession,
  SESSION_STATUSES,
  SESSION_TYPES,
  type StartSessionInput,
  type PauseSessionInput,
  type CancelSessionInput,
  type MoveSessionInput,
  type AssignSessionCustomerInput,
  type ListSessionsInput,
  type SessionRecord,
  type SessionJson,
  type SessionDetail,
  type SessionStatus,
  type SessionType,
} from "./sessions";

export {
  listFloor,
  listFloorInputSchema,
  listBranchIdsWithFloorDevices,
  listHallReadyDeviceIds,
  type ListFloorInput,
  type FloorDevice,
  type FloorOccupancy,
} from "./floor";

export {
  getSessionBilling,
  finalizeSessionBilling,
  persistBillingInTransaction,
  type SessionBillingView,
  type SessionBillingStatus,
} from "./billing";

export {
  PACKAGE_MULTI_SEGMENT_MESSAGE,
  calculateSessionBilling,
  billedUnitsFromSeconds,
  type BillingResult,
} from "./billing-calculator";

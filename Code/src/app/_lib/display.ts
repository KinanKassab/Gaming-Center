import { DEFAULT_LOCALE, type AppLocale } from "@/i18n/locales";
import { formatDateTimeForDisplay } from "@/i18n/format";
import { formatDurationForDisplay } from "@/i18n/duration";
import { t, tGroup, type MessageKey } from "@/i18n/t";
import { formatMinorAmount, parseMinorUnits } from "@/core/money";

export function formatDateTime(
  value: Date | string | null | undefined,
  locale: AppLocale = DEFAULT_LOCALE,
  timeZone = "UTC",
): string {
  return formatDateTimeForDisplay(value, locale, timeZone);
}

export function sessionStatusLabel(status: string, locale: AppLocale = DEFAULT_LOCALE): string {
  const key = `status.session.${status}` as MessageKey;
  const translated = t(locale, key);
  return translated === key ? status : translated;
}

export function sessionStatusTone(status: string): "success" | "warning" | "neutral" | "danger" {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "PAUSED":
      return "warning";
    case "CANCELLED":
      return "danger";
    default:
      return "neutral";
  }
}

export function customerStatusLabel(status: string, locale: AppLocale = DEFAULT_LOCALE): string {
  const key = `status.customer.${status}` as MessageKey;
  const translated = t(locale, key);
  return translated === key ? status : translated;
}

export function membershipStatusLabel(status: string, locale: AppLocale = DEFAULT_LOCALE): string {
  const key = `status.membership.${status}` as MessageKey;
  const translated = t(locale, key);
  return translated === key ? status : translated;
}

export function accessModeLabel(mode: string, locale: AppLocale = DEFAULT_LOCALE): string {
  const key = `status.access.${mode}` as MessageKey;
  const translated = t(locale, key);
  return translated === key ? mode : translated;
}

export function settlementLabel(status: string, locale: AppLocale = DEFAULT_LOCALE): string {
  const key = `status.settlement.${status}` as MessageKey;
  const translated = t(locale, key);
  return translated === key ? status.replaceAll("_", " ").toLowerCase() : translated;
}

export function billingViewLabel(status: string, finalized: boolean, locale: AppLocale = DEFAULT_LOCALE): string {
  if (finalized) return t(locale, "status.billing.final");
  if (status === "PROVISIONAL") return t(locale, "status.billing.provisional");
  if (status === "UNFINALIZED") return t(locale, "status.billing.unfinalized");
  return status.replaceAll("_", " ").toLowerCase();
}

export function settingTitle(key: string, locale: AppLocale = DEFAULT_LOCALE, fallback?: string | null): string {
  if (key === "gaming.allow_guest_sessions") return t(locale, "settingKeys.allowGuestSessions.title");
  if (key === "gaming.billing_unit_seconds") return t(locale, "settingKeys.billingUnitSeconds.title");
  return fallback?.trim() || key;
}

export function settingHelp(
  key: string,
  locale: AppLocale = DEFAULT_LOCALE,
): { what: string; choose: string; example: string } | null {
  if (key === "gaming.allow_guest_sessions") {
    return {
      what: t(locale, "settingKeys.allowGuestSessions.what"),
      choose: t(locale, "settingKeys.allowGuestSessions.choose"),
      example: t(locale, "settingKeys.allowGuestSessions.example"),
    };
  }
  if (key === "gaming.billing_unit_seconds") {
    return {
      what: t(locale, "settingKeys.billingUnitSeconds.what"),
      choose: t(locale, "settingKeys.billingUnitSeconds.choose"),
      example: t(locale, "settingKeys.billingUnitSeconds.example"),
    };
  }
  return null;
}

export function assignmentScopeLabel(
  input: {
    scopeType: string;
    branchName?: string | null | undefined;
    areaName?: string | null | undefined;
    deviceName?: string | null | undefined;
    deviceTypeName?: string | null | undefined;
  },
  locale: AppLocale = DEFAULT_LOCALE,
): string {
  switch (input.scopeType) {
    case "ORGANIZATION":
      return t(locale, "scope.ORGANIZATION");
    case "BRANCH":
      return input.branchName ?? t(locale, "scope.BRANCH");
    case "AREA":
      return input.areaName ?? t(locale, "scope.AREA");
    case "DEVICE":
      return input.deviceName ?? t(locale, "scope.DEVICE");
    case "DEVICE_TYPE":
      return input.deviceTypeName ?? t(locale, "scope.DEVICE_TYPE");
    default:
      return input.scopeType.replaceAll("_", " ").toLowerCase();
  }
}

export function occupancyLabel(occupancy: string, locale: AppLocale = DEFAULT_LOCALE): string {
  const key = `status.occupancy.${occupancy}` as MessageKey;
  const translated = t(locale, key);
  return translated === key ? occupancy : translated;
}

export function operationalStatusLabel(status: string, locale: AppLocale = DEFAULT_LOCALE): string {
  const key = `status.operational.${status}` as MessageKey;
  const translated = t(locale, key);
  return translated === key ? status : translated;
}

export function branchStatusLabel(status: string, locale: AppLocale = DEFAULT_LOCALE): string {
  const key = `status.branch.${status}` as MessageKey;
  const translated = t(locale, key);
  return translated === key ? status : translated;
}

export function recordLifecycleLabel(status: string, locale: AppLocale = DEFAULT_LOCALE): string {
  if (status === "ACTIVE") return t(locale, "common.active");
  if (status === "ARCHIVED") return t(locale, "common.archived");
  if (status === "INACTIVE") return t(locale, "common.inactive");
  return status;
}

export function settingSourceLabel(source: string, locale: AppLocale): string {
  if (source === "BRANCH") return t(locale, "settings.usingBranch");
  if (source === "ORGANIZATION") return t(locale, "settings.usingOrganization");
  return t(locale, "settings.usingBuiltIn");
}

export function pricingPlanAmountLabel(
  input: {
    pricingModel: string;
    currency: string;
    rateMinor?: string | bigint | null;
    billingUnitSeconds?: number | null;
    roundingMode?: string | null;
    timeBillingMode?: string | null;
    packagePriceMinor?: string | bigint | null;
    packageDurationSeconds?: number | null;
  },
  locale: AppLocale,
): string {
  if (input.pricingModel === "TIME_BASED" && input.rateMinor != null) {
    const money = formatMinorAmount(
      typeof input.rateMinor === "string" ? parseMinorUnits(input.rateMinor) : input.rateMinor,
      input.currency,
    );
    return t(locale, "pricing.perHour", { amount: money });
  }
  if (input.pricingModel === "PACKAGE" && input.packagePriceMinor != null && input.packageDurationSeconds) {
    const money = formatMinorAmount(
      typeof input.packagePriceMinor === "string"
        ? parseMinorUnits(input.packagePriceMinor)
        : input.packagePriceMinor,
      input.currency,
    );
    return t(locale, "pricing.packageFor", {
      amount: money,
      duration: formatDurationForDisplay(input.packageDurationSeconds, locale),
    });
  }
  return t(locale, "common.dash");
}

export function humanAuditAction(action: string, locale: AppLocale = DEFAULT_LOCALE): string {
  const mapped = action === "gaming.session.ended" ? "gaming.session.completed" : action;
  return tGroup(locale, "auditAction", mapped);
}

export function permissionLabel(code: string, locale: AppLocale, fallbackName?: string | null): string {
  const translated = tGroup(locale, "permission", code);
  if (translated !== code) return translated;
  const stored = fallbackName?.trim();
  return stored && stored.length > 0 ? stored : code;
}

export function permissionDescriptionText(
  code: string,
  locale: AppLocale,
  fallbackDescription?: string | null,
): string | null {
  const translated = tGroup(locale, "permissionDescription", code);
  if (translated !== code) return translated;
  const stored = fallbackDescription?.trim();
  return stored && stored.length > 0 ? stored : null;
}

export function permissionModuleLabel(module: string, locale: AppLocale): string {
  const translated = tGroup(locale, "permissionModule", module);
  return translated !== module ? translated : module;
}

export function systemRoleLabel(code: string, name: string, locale: AppLocale): string {
  if (code === "OWNER") return t(locale, "roles.owner");
  return name;
}

const SENSITIVE_AUDIT_KEY = /password|token|secret|credential|hash/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown> | null, keys: readonly string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    if (SENSITIVE_AUDIT_KEY.test(key)) continue;
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function moneyField(record: Record<string, unknown> | null, locale: AppLocale): string | null {
  if (!record) return null;
  const currency = typeof record.currency === "string" ? record.currency : null;
  const rate = record.rateMinor;
  const packagePrice = record.packagePriceMinor;
  const amount = typeof rate === "string" || typeof rate === "bigint" ? rate : packagePrice;
  if (currency && (typeof amount === "string" || typeof amount === "bigint")) {
    try {
      const money = formatMinorAmount(typeof amount === "string" ? parseMinorUnits(amount) : amount, currency);
      if (record.pricingModel === "PACKAGE" || record.packagePriceMinor != null) {
        return money;
      }
      return t(locale, "pricing.perHour", { amount: money });
    } catch {
      return null;
    }
  }
  return null;
}

/** Extra human detail from after_data / metadata. Never includes secrets. */
export function formatAuditDetail(
  row: {
    action: string;
    afterData?: unknown;
    beforeData?: unknown;
    metadata?: unknown;
  },
  locale: AppLocale = DEFAULT_LOCALE,
): string | null {
  const after = asRecord(row.afterData);
  const before = asRecord(row.beforeData);
  const meta = asRecord(row.metadata);
  const person =
    stringField(after, ["displayName", "email", "name"]) ??
    stringField(meta, ["displayName", "email"]) ??
    stringField(before, ["displayName", "email", "name"]);
  const entityName =
    stringField(after, ["name", "code"]) ??
    stringField(meta, ["name", "code"]) ??
    stringField(before, ["name", "code"]);
  const roleCode = stringField(after, ["roleCode"]);
  const count = typeof after?.count === "number" ? after.count : typeof meta?.count === "number" ? meta.count : null;
  const money = moneyField(after, locale);

  switch (row.action) {
    case "core.user.created":
    case "core.membership.created":
    case "core.membership.invited":
    case "core.membership.activated":
    case "core.membership.suspended":
    case "core.membership.reactivated":
    case "core.user.disabled":
      return person;
    case "core.membership.role_assigned":
    case "core.membership.role_removed":
      return roleCode ?? person;
    case "core.customer.created":
    case "core.customer.updated":
    case "core.branch.created":
    case "core.branch.updated":
    case "gaming.area.created":
    case "gaming.area.updated":
    case "gaming.device_type.created":
    case "gaming.device_type.updated":
    case "gaming.device_type.archived":
    case "gaming.device.created":
    case "gaming.device.updated":
    case "gaming.device.archived":
      return entityName ?? person;
    case "gaming.device.bulk_created":
      if (count != null) return String(count);
      return entityName;
    case "gaming.pricing_plan.created":
    case "gaming.pricing_plan.updated":
    case "gaming.pricing_assignment.created":
      return [entityName, money].filter(Boolean).join(" · ") || entityName || money;
    default:
      return person ?? entityName ?? money;
  }
}

export function formatAuditLine(
  row: {
    action: string;
    afterData?: unknown;
    beforeData?: unknown;
    metadata?: unknown;
    occurredAt: Date | string;
  },
  locale: AppLocale,
  timeZone?: string,
): string {
  const action = humanAuditAction(row.action, locale);
  const detail = formatAuditDetail(row, locale);
  const when = formatDateTime(row.occurredAt, locale, timeZone);
  return detail ? `${action} · ${detail} · ${when}` : `${action} · ${when}`;
}

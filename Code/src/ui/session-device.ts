import type { AppLocale } from "@/i18n/locales";
import { t } from "@/i18n/t";

export function sessionDeviceDisplayName(input: {
  currentDeviceId: string | null | undefined;
  segments: Array<{ deviceId: string }>;
  deviceNameById: Map<string, string>;
  locale: AppLocale;
}): string {
  if (input.currentDeviceId) {
    return input.deviceNameById.get(input.currentDeviceId) ?? t(input.locale, "sessions.device");
  }
  const uniqueIds: string[] = [];
  for (const segment of input.segments) {
    if (!uniqueIds.includes(segment.deviceId)) uniqueIds.push(segment.deviceId);
  }
  if (uniqueIds.length === 0) return t(input.locale, "common.dash");
  const lastId = input.segments[input.segments.length - 1]!.deviceId;
  const lastName = input.deviceNameById.get(lastId) ?? t(input.locale, "sessions.device");
  if (uniqueIds.length === 1) return lastName;
  return t(input.locale, "sessions.deviceAfterMove", { device: lastName });
}

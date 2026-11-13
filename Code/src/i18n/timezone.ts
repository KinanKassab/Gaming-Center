/** Business IANA timezone when the browser does not supply one. */
export const DEFAULT_BUSINESS_TIMEZONE = "Asia/Damascus";

export function resolveBusinessTimezone(value?: string | null): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length > 0 && trimmed.length <= 64) return trimmed;
  return DEFAULT_BUSINESS_TIMEZONE;
}

/** Browser IANA zone. Never prompts for geolocation. */
export function detectBrowserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return resolveBusinessTimezone(zone);
  } catch {
    return DEFAULT_BUSINESS_TIMEZONE;
  }
}

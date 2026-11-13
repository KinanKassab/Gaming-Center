/**
 * Wizard convenience labels only. Device types remain tenant-owned rows.
 * FUN-010: do not treat these as the product catalog or the only allowed names.
 */
export const DEVICE_TYPE_SUGGESTION_IDS = [
  "ps5",
  "ps4",
  "xbox",
  "pc",
  "billiards",
  "vr",
  "switch",
] as const;

export type DeviceTypeSuggestionId = (typeof DEVICE_TYPE_SUGGESTION_IDS)[number];

const ALIASES: Record<DeviceTypeSuggestionId, readonly string[]> = {
  ps5: [
    "ps5",
    "ps 5",
    "playstation 5",
    "playstation5",
    "play station 5",
    "بلايستيشن 5",
    "بلايستيشن5",
    "بلاي ستيشن 5",
    "بلاي ستيشن5",
  ],
  ps4: [
    "ps4",
    "ps 4",
    "playstation 4",
    "playstation4",
    "play station 4",
    "بلايستيشن 4",
    "بلايستيشن4",
    "بلاي ستيشن 4",
    "بلاي ستيشن4",
  ],
  xbox: ["xbox", "xbox series", "xbox series x", "xbox series s", "اكس بوكس", "إكس بوكس"],
  pc: ["pc", "pcs", "computer", "كمبيوتر", "بي سي", "حاسب", "حاسوب"],
  billiards: ["billiards", "billiard", "pool", "بلياردو", "بليارد"],
  vr: ["vr", "virtual reality", "في آر", "في ار", "واقع افتراضي"],
  switch: ["switch", "nintendo switch", "nintendo", "نينتندو", "نينتندو سويتش", "سويتش"],
};

export function foldDeviceTypeName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .toLowerCase()
    .replace(/[._\-–—]/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchDeviceTypeSuggestion(
  name: string,
  labels: Partial<Record<DeviceTypeSuggestionId, string>>,
): DeviceTypeSuggestionId | null {
  const folded = foldDeviceTypeName(name);
  if (!folded) return null;
  for (const id of DEVICE_TYPE_SUGGESTION_IDS) {
    const label = labels[id];
    if (label && foldDeviceTypeName(label) === folded) return id;
    if (ALIASES[id].some((alias) => foldDeviceTypeName(alias) === folded)) return id;
  }
  return null;
}

export function isExistingDeviceTypeName(
  candidate: string,
  existing: ReadonlyArray<{ name: string }>,
  labels: Partial<Record<DeviceTypeSuggestionId, string>> = {},
): boolean {
  return findMatchingDeviceType(candidate, existing, labels) != null;
}

export function findMatchingDeviceType<T extends { name: string }>(
  candidate: string,
  existing: ReadonlyArray<T>,
  labels: Partial<Record<DeviceTypeSuggestionId, string>> = {},
): T | undefined {
  const folded = foldDeviceTypeName(candidate);
  if (!folded) return undefined;
  const candidateSuggestion = matchDeviceTypeSuggestion(candidate, labels);
  return existing.find((row) => {
    if (foldDeviceTypeName(row.name) === folded) return true;
    return candidateSuggestion != null && matchDeviceTypeSuggestion(row.name, labels) === candidateSuggestion;
  });
}

/** Extra stations to create so the type reaches `desiredTotal`, without deleting. */
export function additionalDevicesToCreate(
  desiredTotal: number,
  existingCount: number,
  maxBatch: number,
): number {
  if (!Number.isInteger(desiredTotal) || desiredTotal < 1) return 0;
  if (!Number.isInteger(maxBatch) || maxBatch < 1) return 0;
  const existing = Number.isInteger(existingCount) && existingCount > 0 ? existingCount : 0;
  const extra = desiredTotal - existing;
  if (extra <= 0) return 0;
  return Math.min(extra, maxBatch);
}

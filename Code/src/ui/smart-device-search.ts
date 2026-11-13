/**
 * Live floor search: tolerant of small typos, Arabic/Latin variants,
 * and number tokens (e.g. "بلايستيشن 10" → device 10 of that type).
 */

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const EASTERN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Shared stems expanded into alternate spellings / brand nicknames. */
const SYNONYM_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  ["playstation", "بلايستيشن", "بلاي ستيشن", "بلايستيشن", "ps", "بلاىستيشن"],
  ["xbox", "اكس بوكس", "إكس بوكس", "اكس بوك"],
  ["pc", "كمبيوتر", "بي سي", "حاسوب"],
  ["billard", "بلياردو", "بليارد"],
  ["fifa", "فيفا"],
];

export type SmartDeviceSearchFields = {
  name: string;
  code: string;
  areaName?: string;
  deviceTypeName?: string;
};

export function normalizeSearchText(input: string): string {
  let out = input.normalize("NFKC").toLowerCase();
  out = out.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
  out = out.replace(/[۰-۹]/g, (d) => String(EASTERN_DIGITS.indexOf(d)));
  out = out
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/گ/g, "ك")
    .replace(/ڤ/g, "ف");
  out = out.replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  return out;
}

function expandSynonyms(token: string): string[] {
  const variants = new Set<string>([token]);
  for (const group of SYNONYM_GROUPS) {
    const normalizedGroup = group.map(normalizeSearchText);
    if (normalizedGroup.some((alias) => alias === token || token.includes(alias) || alias.includes(token))) {
      for (const alias of normalizedGroup) variants.add(alias);
    }
  }
  return [...variants];
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

function maxEditDistance(tokenLength: number): number {
  if (tokenLength <= 2) return 0;
  if (tokenLength <= 5) return 1;
  if (tokenLength <= 9) return 2;
  return 3;
}

function tokenMatchesHaystack(haystack: string, token: string): boolean {
  if (!token) return true;
  if (/^\d+$/.test(token)) {
    return numberTokenMatches(haystack, token);
  }
  for (const variant of expandSynonyms(token)) {
    if (!variant) continue;
    if (haystack.includes(variant)) return true;
    const words = haystack.split(" ").filter(Boolean);
    const compact = haystack.replace(/\s+/g, "");
    if (compact.includes(variant.replace(/\s+/g, ""))) return true;
    const allowance = maxEditDistance(variant.length);
    if (allowance === 0) continue;
    for (const word of words) {
      if (Math.abs(word.length - variant.length) > allowance) continue;
      if (levenshtein(word, variant) <= allowance) return true;
    }
    // Typo against a sliding window of similar length in the compacted string.
    if (variant.length >= 4 && compact.length >= variant.length) {
      for (let i = 0; i <= compact.length - variant.length; i++) {
        const slice = compact.slice(i, i + variant.length);
        if (levenshtein(slice, variant) <= allowance) return true;
      }
    }
  }
  return false;
}

function numberTokenMatches(haystack: string, digits: string): boolean {
  const numbers: string[] = haystack.match(/\d+/g) ?? [];
  if (numbers.includes(digits)) return true;
  // "10" should not match "100" as a whole number, but may match as a code segment.
  const padded = digits.replace(/^0+/, "") || "0";
  return numbers.some((n) => (n.replace(/^0+/, "") || "0") === padded);
}

export function matchesSmartDeviceSearch(fields: SmartDeviceSearchFields, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const haystack = normalizeSearchText(
    [fields.name, fields.code, fields.areaName ?? "", fields.deviceTypeName ?? ""].join(" "),
  );
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  return tokens.every((token) => tokenMatchesHaystack(haystack, token));
}

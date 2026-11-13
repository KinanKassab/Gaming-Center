import { ar } from "@/i18n/messages/ar";
import { en, type MessageTree } from "@/i18n/messages/en";
import type { AppLocale } from "@/i18n/locales";

type LeafPaths<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : T[K] extends Record<string, unknown>
      ? LeafPaths<T[K], `${Prefix}${K}.`>
      : never;
}[keyof T & string];

export type MessageKey = LeafPaths<MessageTree>;

const catalogs: Record<AppLocale, MessageTree> = { ar, en };

function lookup(tree: unknown, path: string): string | undefined {
  let current: unknown = tree;
  for (const part of path.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = vars[name];
    return value == null ? `{${name}}` : String(value);
  });
}

export function t(locale: AppLocale, key: MessageKey, vars?: Record<string, string | number>): string {
  const raw = lookup(catalogs[locale], key) ?? lookup(en, key) ?? key;
  return interpolate(raw, vars);
}

export function flattenMessageKeys(tree: unknown, prefix = ""): string[] {
  if (tree == null || typeof tree !== "object") return [];
  const keys: string[] = [];
  for (const [name, value] of Object.entries(tree as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${name}` : name;
    if (typeof value === "string") keys.push(path);
    else keys.push(...flattenMessageKeys(value, path));
  }
  return keys;
}

export function tGroup(
  locale: AppLocale,
  group: "auditAction" | "permission" | "permissionDescription" | "permissionModule",
  key: string,
): string {
  const table = catalogs[locale][group] as Record<string, string> | undefined;
  const fallback = catalogs.en[group] as Record<string, string>;
  const found = table?.[key] ?? fallback[key];
  if (found) return found;
  if (group === "auditAction") return t(locale, "audit.unknownAction");
  return key;
}

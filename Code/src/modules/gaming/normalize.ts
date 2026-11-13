import { ValidationError } from "@/core/errors";
import { normalizeInternalCode } from "@/core/codes";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const uuidPattern = UUID_PATTERN;

export function normalizeMasterCode(value: string, label: string): string {
  return normalizeInternalCode(value, label);
}

export function normalizeRequiredName(value: string, label = "Name"): string {
  const name = value.trim();
  if (name.length < 1) {
    throw new ValidationError(`${label} is required`);
  }
  if (name.length > 200) {
    throw new ValidationError(`${label} must be at most 200 characters`);
  }
  return name;
}

export function normalizeOptionalText(value: string | null | undefined, maxLength: number): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > maxLength) {
    throw new ValidationError(`Value must be at most ${maxLength} characters`);
  }
  return trimmed;
}

export function likeSafe(value: string): string {
  return value.replace(/[%_\\]/g, "");
}

export function parseNonNegativeMinor(value: string | number | bigint, label: string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) throw new ValidationError(`${label} must be a non-negative integer (minor units)`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      throw new ValidationError(`${label} must be a non-negative integer (minor units)`);
    }
    return BigInt(value);
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new ValidationError(`${label} must be a non-negative integer (minor units)`);
  }
  return BigInt(trimmed);
}

export function minorToJson(value: bigint | null | undefined): string | null {
  if (value == null) return null;
  return value.toString();
}

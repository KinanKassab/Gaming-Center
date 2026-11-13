import { ConflictError, ValidationError } from "@/core/errors";
import { createId } from "@/core/ids";

/** Matches existing branch / master-data code CHECKs (max 32). */
export const INTERNAL_CODE_PATTERN = /^[A-Z0-9](?:[A-Z0-9_-]{0,30}[A-Z0-9])?$/;

export function normalizeInternalCode(value: string, label: string): string {
  const code = value.trim().toUpperCase();
  if (!INTERNAL_CODE_PATTERN.test(code)) {
    throw new ValidationError(`${label} must be short letters, digits, underscores, or dashes`);
  }
  return code;
}

/** Empty or missing client codes are omitted so the server can allocate one. */
export function optionalInternalCode(value: string | undefined | null): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Collision-safe internal identifier. Not derived from display names, so Arabic
 * (or any) labels cannot produce duplicate transliterations.
 *
 * Format: PREFIX + 10 hex characters from a UUID (fits the 32-character code CHECK).
 */
export function allocateInternalCode(prefix: string): string {
  const normalizedPrefix = prefix.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const token = createId().replace(/-/g, "").slice(-10).toUpperCase();
  return normalizeInternalCode(`${normalizedPrefix}${token}`, "Generated code");
}

export async function insertWithAllocatedCode<T>(options: {
  explicit: string | undefined;
  prefix: string;
  label: string;
  conflictMessage: string;
  isUniqueViolation: (error: unknown) => boolean;
  insert: (code: string) => Promise<T>;
}): Promise<T> {
  const explicit = options.explicit ? normalizeInternalCode(options.explicit, options.label) : undefined;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = explicit ?? allocateInternalCode(options.prefix);
    try {
      return await options.insert(code);
    } catch (error) {
      if (explicit || !options.isUniqueViolation(error) || attempt === 7) {
        if (options.isUniqueViolation(error)) {
          throw new ConflictError(options.conflictMessage);
        }
        throw error;
      }
    }
  }
  throw new ConflictError(options.conflictMessage);
}

import { ValidationError } from "@/core/errors";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Contact normalization for customers (FUN-006).
 *
 * Email: trim + lowercase. Empty becomes null.
 * Phone: trim; strip spaces, dashes, dots, and parentheses; optional leading `+`;
 *        6–15 digits. Stored in `phone_normalized`. Empty becomes null.
 * Display name / notes / customer code: trim; empty optional fields become null.
 *
 * Name, phone, and email are **not** unique. Duplicates are warned at the
 * application layer only — never merged or rejected solely for matching contact.
 */
export function normalizeOptionalText(value: string | null | undefined, maxLength: number): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > maxLength) {
    throw new ValidationError(`Value must be at most ${maxLength} characters`);
  }
  return trimmed;
}

export function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = normalizeOptionalText(value, 320);
  if (trimmed == null) return null;
  const email = trimmed.toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new ValidationError("Invalid email");
  }
  return email;
}

export function normalizePhone(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const compact = trimmed.replace(/[\s().-]/g, "");
  if (!/^\+?[0-9]{6,15}$/.test(compact)) {
    throw new ValidationError("Phone must be 6 to 15 digits, optionally starting with +");
  }
  return compact;
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function likeSafe(value: string): string {
  return value.replace(/[%_\\]/g, "");
}

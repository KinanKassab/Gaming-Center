export class TenantIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantIsolationError";
  }
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  readonly reason?: string;
  constructor(message: string, reason?: string) {
    super(message);
    this.name = "ConflictError";
    if (reason !== undefined) this.reason = reason;
  }
}

/** A mutation would leave the organization in a forbidden administrative state. */
export class AdminInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminInvariantError";
  }
}

/** Semantic validation failure beyond request shape (e.g. unknown permission code). */
export class ValidationError extends Error {
  readonly reason?: string;
  constructor(message: string, reason?: string) {
    super(message);
    this.name = "ValidationError";
    if (reason !== undefined) this.reason = reason;
  }
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** Fail-closed billing calculation or finalization (maps to HTTP 409). */
export class BillingError extends ConflictError {
  constructor(message: string, reason?: string) {
    super(message, reason);
    this.name = "BillingError";
  }
}

export function domainErrorReason(error: unknown): string | undefined {
  if (error instanceof ValidationError || error instanceof ConflictError) {
    return error.reason;
  }
  return undefined;
}

/** True when the underlying driver reports a PostgreSQL unique violation (23505). */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (candidate.code === "23505") return true;
  return isUniqueViolation(candidate.cause);
}

/** Constraint/index names and driver messages from a unique-violation chain. */
export function uniqueConstraintText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current && typeof current === "object") {
    const row = current as Record<string, unknown>;
    for (const key of ["constraint", "constraint_name", "constraintName"]) {
      if (typeof row[key] === "string") parts.push(row[key]);
    }
    if (typeof row.message === "string") parts.push(row.message);
    if (typeof row.detail === "string") parts.push(row.detail);
    current = row.cause;
  }
  return parts.join(" ");
}

export function uniqueViolationMentions(error: unknown, fragment: string): boolean {
  return uniqueConstraintText(error).toLowerCase().includes(fragment.toLowerCase());
}

/** True when the underlying driver reports a PostgreSQL foreign-key violation (23503). */
export function isForeignKeyViolation(error: unknown): boolean {
  return isPostgresErrorCode(error, "23503");
}

/** True when the underlying driver reports a check/constraint violation (23514). */
export function isCheckViolation(error: unknown): boolean {
  return isPostgresErrorCode(error, "23514");
}

/** True when the connected role lacks the required table privilege (42501). */
export function isInsufficientPrivilege(error: unknown): boolean {
  return isPostgresErrorCode(error, "42501");
}

function isPostgresErrorCode(error: unknown, code: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (candidate.code === code) return true;
  return isPostgresErrorCode(candidate.cause, code);
}

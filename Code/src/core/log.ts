import { AsyncLocalStorage } from "node:async_hooks";
import { createId } from "@/core/ids";

export type RequestLogContext = {
  requestId: string;
  route?: string;
  organizationId?: string;
  branchId?: string;
  actorId?: string;
};

const requestLog = new AsyncLocalStorage<RequestLogContext>();

const REDACT_KEY =
  /password|secret|token|authorization|cookie|database_url|migration_database|better_auth|session|supabase|service_role|pooler|vercel_|api[_-]?key|private[_-]?key|credential/i;
const MAX_REDACTION_DEPTH = 8;
const DATABASE_URL = /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?):\/\/[^\s"'<>]+/gi;
const BEARER_CREDENTIAL = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const SECRET_ASSIGNMENT =
  /\b(password|secret|token|authorization|cookie|api[_-]?key|private[_-]?key|credential)\b(\s*[:=]\s*|\s+)("[^\"]*"|'[^']*'|[^\s,;&]+)/gi;

export function createRequestId(): string {
  return createId();
}

export function runWithRequestLog<T>(context: RequestLogContext, fn: () => T): T {
  return requestLog.run(context, fn);
}

export function getRequestLogContext(): RequestLogContext | undefined {
  return requestLog.getStore();
}

function redactString(value: string): string {
  return value
    .replace(DATABASE_URL, "[redacted-database-url]")
    .replace(BEARER_CREDENTIAL, "Bearer [redacted]")
    .replace(SECRET_ASSIGNMENT, "$1$2[redacted]");
}

function redactValueInner(
  key: string,
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (REDACT_KEY.test(key)) return "[redacted]";
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_REDACTION_DEPTH) return "[redacted-depth-limit]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (value instanceof Error) {
    const extra = Object.fromEntries(
      Object.entries(value).filter(([name]) => !["name", "message", "stack", "cause"].includes(name)),
    );
    const normalized = {
      ...extra,
      name: value.name,
      message: value.message,
      ...(value.stack ? { stack: value.stack } : {}),
      ...(value.cause !== undefined ? { cause: value.cause } : {}),
    };
    return redactValueInner("", normalized, depth + 1, seen);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => redactValueInner(String(index), item, depth + 1, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      redactValueInner(childKey, childValue, depth + 1, seen),
    ]),
  );
}

export function redactValue(key: string, value: unknown): unknown {
  return redactValueInner(key, value, 0, new WeakSet());
}

export function redactFields(fields: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!fields) return undefined;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    next[key] = redactValue(key, value);
  }
  return next;
}

function write(level: "info" | "error" | "warn", event: string, fields?: Record<string, unknown>): void {
  const context = requestLog.getStore();
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    requestId: context?.requestId,
    route: context?.route ?? fields?.route,
    organizationId: context?.organizationId,
    branchId: context?.branchId,
    actorId: context?.actorId,
    ...redactFields(fields),
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export function logInfo(event: string, fields?: Record<string, unknown>): void {
  write("info", event, fields);
}

export function logWarn(event: string, fields?: Record<string, unknown>): void {
  write("warn", event, fields);
}

export function logError(event: string, error: unknown, fields?: Record<string, unknown>): void {
  const err = error instanceof Error ? error : { message: String(error) };
  write("error", event, { ...fields, error: err });
}

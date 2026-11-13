/**
 * Authentication provider boundary (ADR 0003 / ADR 0007).
 *
 * - Better Auth owns credentials and login sessions (auth_* tables).
 * - The stable link into the domain is core_users.auth_subject, which stores
 *   the provider subject id as opaque text.
 * - Domain modules never import Better Auth; they receive resolved contexts
 *   from src/auth/context.ts.
 */
export type AuthSubject = string;

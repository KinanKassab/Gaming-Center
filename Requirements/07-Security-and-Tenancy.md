# 07 — Security and tenancy

Source: Blueprint v1.1 §§2–4, §6, §16, §26, §28.

| ID | Requirement | Status |
| --- | --- | --- |
| SEC-001 | Shared multi-tenant PostgreSQL with strict isolation by `organization_id` (and `branch_id` for branch data). | MVP |
| SEC-002 | Tenant isolation is not a UI filter. Every query, relation, and constraint must honor the current organization. | MVP |
| SEC-003 | Composite foreign keys prevent attaching Organization A rows to Organization B’s branches or entities. | MVP |
| SEC-004 | Authorization in the backend is mandatory before data access. | MVP |
| SEC-005 | RLS is defense-in-depth when the connection model allows it. Request path must not use a BYPASSRLS or table-owner role. Tenant GUC/settings must be **transaction-local** (not leftover on a pooled connection). | MVP |
| SEC-006 | Automated tests must prove Organization A cannot read/update/delete Organization B, including by guessing IDs. UI filters are not the test. | MVP |
| SEC-007 | Audit logs are append-only from the application (no update/delete). | MVP |
| SEC-008 | Do not log passwords, tokens, secrets, or payment secrets in audit metadata or application logs. | MVP |
| SEC-009 | TLS for database connections in deployed environments. Secrets stay out of git and out of the frontend bundle. | MVP |
| SEC-019 | Financial history is immutable: fix mistakes with refund/adjustment, not by rewriting completed charges/payments. | MVP |
| SEC-020 | Personal-data retention/anonymization policy when market/legal requirements are known. | NEEDS DECISION |
| SEC-021 | Rate limits on sensitive financial operations. | MVP (when APIs exist) |

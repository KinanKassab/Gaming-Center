# 03 — Non-functional requirements

Source: Blueprint v1.1 §§4–6, §17–23, §26.

| ID | Requirement | Status |
| --- | --- | --- |
| NFR-001 | PostgreSQL is the system of record. The browser never holds admin/database credentials. | MVP |
| NFR-002 | Identifiers for distributed/public entities are UUID (UUIDv7 preferred when available). | MVP |
| NFR-003 | Instants are `timestamptz` (stored as absolute time). Organization timezone is for display and local business days, not for rewriting stored timestamps. | MVP |
| NFR-004 | Money is integer minor units (`bigint`) plus a currency code. JavaScript `number` / float must not be the source of truth for persisted money. | MVP |
| NFR-005 | Schema changes only via versioned migrations. No ad-hoc production DDL. Destructive expand/contract when data exists. | MVP |
| NFR-006 | Indexes follow real query patterns (floor by branch, sessions by time, debt by customer, unpublished outbox, audit by entity). Do not index every column. | MVP |
| NFR-007 | Partitioning of large tables is not done until metrics justify it. | Phase 2 |
| NFR-008 | Modular monolith: modules own their tables; other modules call services or consume events, they do not insert into foreign tables from UI code. | MVP |
| NFR-009 | Local development must not require Docker or a paid cloud account. Production managed PostgreSQL provider is **NEEDS DECISION**. | MVP / NEEDS DECISION |
| NFR-010 | Environments are separated: local (fake data), CI (ephemeral DB), staging, production. Development must not use production data or credentials. | MVP |
| NFR-011 | Backups, PITR, RPO/RTO, and restore tests before commercial launch. | NEEDS DECISION (budget) / required before production |
| NFR-012 | Compilation is not done. Implemented features need automated tests including tenant isolation, concurrency, and migration-from-empty. | MVP |
| NFR-013 | Table names `snake_case` with module prefix; columns `snake_case`; PK `id`; FKs `<entity>_id`. | MVP |
| NFR-014 | Statuses are text plus CHECK (or lookup), not tightly coupled DB enums that are hard to migrate. | MVP |
| NFR-015 | jsonb is for flexible validated config and snapshots, not a substitute for relational FKs. | MVP |

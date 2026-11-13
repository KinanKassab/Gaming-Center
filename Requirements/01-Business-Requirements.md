# 01 — Business requirements

Source: Architecture Blueprint v1.1 §§1–3, §8, §27, §30.

## Product identity

| ID | Requirement | Status |
| --- | --- | --- |
| GAM-001 | The product is **Akodus Gaming Center**, a SaaS system for gaming-center businesses only — not a generic Akodus platform for other products. | MVP |
| GAM-002 | One **Organization** is one gaming-center business (tenant). Example: Dragon Gaming. Unrelated businesses are separate organizations and must never see each other’s data. | MVP |
| GAM-003 | An organization may operate **one or many branches** (locations) in the same software. Example: Jaramana, Mezzeh, Shaalan. | MVP |
| GAM-004 | The same software must support employees, customers, gaming devices, gaming areas, pricing, sessions, POS, inventory, payments, customer debt, cash shifts, expenses, reporting, permissions, audit history, and configuration. | MVP (capabilities); delivery is phased |
| GAM-005 | Cloud PostgreSQL is the source of truth. Installing a database on each customer PC is not the default. | MVP |
| GAM-006 | Offline / Edge for Gaming or POS is **not** required until real operational need is proven. | Future / NEEDS DECISION |

## Configuration vs integrity

| ID | Requirement | Status |
| --- | --- | --- |
| GAM-007 | Business behavior that differs between customers (areas, device types, prices, payment methods, categories, warnings, flags) is **configurable** without a code fork per customer. | MVP |
| GAM-008 | Security, tenant isolation, financial integrity, concurrency, and database consistency are **enforced in application and database logic**, not left to UI convention. | MVP |
| GAM-009 | Do not implement per-tenant special cases as `if (organizationId === "…")`. Recurring variation must become settings, features, or documented domain data. | MVP |

## Customers and identity (business)

| ID | Requirement | Status |
| --- | --- | --- |
| GAM-010 | A **Customer** belongs to the organization and is shared across that organization’s branches. | MVP |
| GAM-011 | Guest play is allowed; a customer record is not required to start a normal gaming session. | MVP |
| GAM-012 | Unpaid debt may exist only for a registered customer. Guests cannot leave debt. | MVP |
| GAM-013 | Physical cards, NFC, QR membership, and loyalty are **not** part of MVP customer identification. | Future — see `90-Future-Cards-NFC.md` |

## Delivery phasing (from blueprint §27)

| ID | Requirement | Status |
| --- | --- | --- |
| GAM-014 | Foundation order is: repository/DB → core tenancy → authorization/settings → customers/audit/outbox → gaming master data → sessions → finance → POS/inventory → hardening → pilot. | MVP planning |
| GAM-015 | Cards/NFC, reservations, tournaments, membership, loyalty, and offline sync are out of MVP unless later approved. | Future |

## Open product questions

| ID | Topic | Status |
| --- | --- | --- |
| GAM-016 | First pilot gaming center and real operating rules before UI freeze. | NEEDS DECISION |
| GAM-017 | Default MVP payment methods. Blueprint proposes cash plus ShamCash as a **manual** method, not an API. | NEEDS DECISION (proposal recorded) |
| GAM-018 | Default pricing calculation defaults (billing unit, rounding, minimums) as product defaults. Rules themselves are configurable. | NEEDS DECISION |

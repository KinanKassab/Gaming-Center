# Akodus Gaming Center — Requirements

These files answer **what** the Gaming Center system must do.

Architecture (how it is designed) lives in `Code/docs/architecture/`. The DOCX blueprint is the primary architecture source; `GAMING_CENTER_BLUEPRINT.md` is the implementation reference.

Every requirement below originates from the architecture blueprint v1.1 or an explicit project decision recorded in an ADR. **Do not invent features.** Unknown behavior is marked **NEEDS DECISION**.

| File | Topic |
| --- | --- |
| [01-Business-Requirements.md](01-Business-Requirements.md) | Product identity, tenants, branches, MVP vs later |
| [02-Functional-Requirements.md](02-Functional-Requirements.md) | What the system must do |
| [03-Non-Functional-Requirements.md](03-Non-Functional-Requirements.md) | Quality, time, money, operations |
| [04-Roles-and-Permissions.md](04-Roles-and-Permissions.md) | AuthN vs AuthZ, roles, branch access |
| [05-Gaming-Session-and-Pricing-Rules.md](05-Gaming-Session-and-Pricing-Rules.md) | Floor, sessions, pricing snapshots |
| [06-POS-Inventory-Finance-Requirements.md](06-POS-Inventory-Finance-Requirements.md) | Catalog, stock, charges, payments, shifts |
| [07-Security-and-Tenancy.md](07-Security-and-Tenancy.md) | Isolation, RLS, audit, secrets |
| [90-Future-Cards-NFC.md](90-Future-Cards-NFC.md) | Non-MVP Cards/NFC only |

ID prefixes: `GAM` business, `FUN` functional, `NFR` quality, `SEC` security, `POS` POS/inventory/finance, `CRD` future cards.

Status values: **MVP**, **Phase 2**, **Future**, **NEEDS DECISION**.

# 90 — Future Cards / NFC (not MVP)

Source: Blueprint v1.1 §15, §27 Phase 10, §30.

**Status: FUTURE / LATER / PROPOSED / SUBJECT TO CHANGE.**

This file is isolated so agents do not treat cards as current work.

## What this is

Gaming Center may later use physical or digital identifiers so staff can recognize a customer quickly (NFC tap, QR scan). That must remain **architecturally possible** (stable UUIDs, organization-level customers, identification as a layer on top of sessions).

## What this is not

| Do not | Why |
| --- | --- |
| Create `cards_*` / `nfc_*` / `membership_*` / `loyalty_*` tables | Explicitly not in MVP database scope |
| Build Cards APIs or Cards UI | Not approved |
| Install NFC libraries | Not approved |
| Treat the preliminary cards schema as final | Blueprint: re-validate before implementation |
| Require a card to start a session | Session/finance core must work without cards |
| Store PII or balances on the chip | Opaque token/URL → backend; finance ledger stays source of truth for money |

## Possible later ideas (all unapproved)

- Customer identification (tap/scan)
- Membership or loyalty (needs product validation)
- Check-in
- Stored balance / gift credit (needs finance/security design)

## Preliminary tables (do not migrate)

The blueprint sketches `cards_types`, `cards_cards`, `cards_identifiers`, `cards_assignments`, `cards_events`. Names and shapes **will change**. Presence in the blueprint is not approval to implement.

## Guardrails when (if) approved later

- Opaque tokens, rotatable identifiers, lost-card replacement without losing customer history.
- Card is optional identification, not a second ledger.
- Implement only the validated use case — not loyalty/membership/wallet automatically.

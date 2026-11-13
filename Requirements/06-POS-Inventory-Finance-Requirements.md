# 06 — POS, inventory, and finance requirements

Source: Blueprint v1.1 §§11–13, §18, §24. **Not fully implemented in Foundation Milestone 1.**

## Finance

| ID | Requirement | Status |
| --- | --- | --- |
| POS-001 | Charge, payment, allocation, refund, and debt are separate concepts. Do not model “paid” as a single boolean on a session. | MVP |
| POS-002 | Customer debt is the remaining balance on open charges, **not** an editable `debt_balance` column. | MVP |
| POS-003 | Split payments are required (e.g. cash + ShamCash on one charge, or one payment covering several charges). | MVP |
| POS-004 | Payment amount is `bigint` minor units, strictly greater than zero. After COMPLETED, amount is not edited; use refund. | MVP |
| POS-005 | Refunds are documented reversals; completed refunds cannot exceed the original payment. | MVP |
| POS-006 | Payment completion is idempotent. | MVP |
| POS-007 | Payment methods are organization data (CASH, SHAMCASH, …). Recording ShamCash as a method is **not** an API integration. | MVP / integration NEEDS DECISION |
| POS-008 | Cash shifts document opening/closing counts. Whether two OPEN shifts per user/drawer are allowed is a business setting. | MVP / NEEDS DECISION |
| POS-009 | Expenses are posted or voided (permission + reason + audit), not deleted. | MVP |
| POS-010 | Completed financial rows are not physically deleted. | MVP |

## POS / catalog

| ID | Requirement | Status |
| --- | --- | --- |
| POS-011 | Products are organization-level; price and availability may differ by branch. Line items store price/name snapshots. | MVP |
| POS-012 | POS is reusable, not gaming-only. An order may stand alone or link to a session. | MVP |
| POS-013 | Whether a session-linked order shares the session charge or gets its own charge follows a documented checkout flow. | NEEDS DECISION (both allowed in schema) |

## Inventory

| ID | Requirement | Status |
| --- | --- | --- |
| POS-014 | Stock quantity changes only with a movement in the same transaction as the balance update. Do not edit balances from the UI. | MVP |
| POS-015 | Posted movements are not edited; corrections are new movements. | MVP |
| POS-016 | Inter-branch transfer is Phase 2 (requested → shipped → received). | Phase 2 |

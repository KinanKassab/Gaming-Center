# 05 — Gaming session and pricing rules

Source: Blueprint v1.1 §§10, §14, §18–19. **Not implemented in Foundation Milestone 1.**

| ID | Requirement | Status |
| --- | --- | --- |
| GAM-101 | Gaming Floor is the primary operational UI. | MVP |
| GAM-102 | Guest sessions are allowed. Customer is optional on the session. | MVP |
| GAM-103 | Server time is authoritative; browser timers are display-only. Duration and money come from server timestamps and segments. | MVP |
| GAM-104 | At most one ACTIVE or PAUSED session per device, enforced with a transaction row lock **and** a partial unique index. | MVP |
| GAM-105 | Start session is atomic: lock device, verify enabled and free, insert session + first segment with pricing snapshot, outbox event. | MVP |
| GAM-106 | Session segments record device and pricing for each slice (move, price change, end, cancel). Do not re-price a closed segment from a later plan. | MVP |
| GAM-107 | Pause/resume is stored as pause rows. Proposed MVP default: pause is **not** billable; a setting may override if product confirms. | MVP / NEEDS DECISION for default if disputed |
| GAM-108 | Move device: lock session, current device, and target device in a **fixed ID order**; close segment; open new segment; update `current_device_id`. | MVP |
| GAM-109 | End session: idempotent; freeze `ended_at`; close last segment; sum segments (not the browser timer); attach unbilled POS orders; create finance charge; pay now or leave debt only if a customer exists; clear `current_device_id`. | MVP |
| GAM-110 | Cancel is distinct from complete and requires reason + permission + audit. | MVP |
| GAM-111 | Historical prices stay on the segment snapshot. Changing a plan must not alter completed sessions. | MVP |
| GAM-112 | Occupied/free is derived from session state, not stored as the device’s operational status. Operational status is ENABLED / MAINTENANCE / DISABLED. | MVP |
| GAM-113 | Day-part / advanced schedule pricing is Phase 2 (`gaming_pricing_rules`). | Phase 2 |
| GAM-114 | Guest cannot close with unpaid remainder. Assign customer before close if debt is needed. Direct cash pay as guest is allowed. | MVP |

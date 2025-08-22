Remaining Backend Tasks (excluding E2E)
======================================

Priority order for hardening and polish. E2E items are intentionally excluded.

P0 — Critical (do first)
------------------------
- [x] Enforce strict DB-backed token validation for all socket events in production (dev-only fallback remains)
  - [x] Behavior covered by tests for production vs dev when DB disconnected
- [x] Add tests for 401/403 across critical socket events (connection rejection and per-event 401s covered)
- [x] Zod-based env config validation; fail fast in production for required vars (`MONGO_URI`, `ADMIN_TOKEN`, `JWT_SECRET`, `RAKE_WALLET_USER_ID` when rake > 0)
- [x] Add type-check stage to CI (`tsc --noEmit`)
- [x] Define and apply DB indexes:
  - [x] `WalletLedger(userId, createdAt)`
  - [x] `WalletHold(userId, tableId, active)`
  - [x] `RoundResult(tableId, winnerUserId, createdAt)`

P1 — High
---------
- [x] Snapshot persistence tests: save/restore on restart; verify cleanup-on-boot behavior
- [x] Tune per-socket rate limits; add tests for chatty events (`status`)
- [ ] Admin API tests:
  - [x] `GET /api/admin/holds` (filters: active, userId, tableId)
  - [x] `GET /api/admin/invariants` (multi-holds, holdsForMissingTable, negativeWallets)
  - [x] `GET /api/admin/rake` (date range, aggregation)
- [ ] Documentation upgrades in `backend/README.md`:
  - [x] Full HTTP route docs (params, responses, examples)
  - [x] Socket.IO contracts: events, payload schemas, errors, idempotency usage, timing
  - [x] Finance/holds lifecycle diagrams (join, round-end, leave-table)
- [x] Security: restrict CORS for production (specific origins); re-verify Helmet and rate-limit settings

P2 — Medium
-----------
- [ ] Cron-like jobs & maintenance:
  - [x] Stale hold sweeper (release holds where table/game no longer exists); tests
  - [x] Snapshot garbage collector; tests
  - [x] Scheduled reconciliation runner (wraps `npm run reconcile`); dry-run mode (simulated test)
- [ ] Observability: correlation/request IDs in structured logs; minimal metrics endpoint (rounds, rake, holds, active games)
  - [x] Request IDs middleware
  - [x] Minimal metrics endpoint (`GET /api/metrics`)
  - [x] Include requestId in structured socket logs when present
- [ ] ESLint setup and CI step; fix lint violations
  - [x] ESLint config + CI step added

P3 — Nice-to-have
-----------------
- [ ] Operational tooling:
  - [x] Export ledgers/rounds to CSV (with date range filters)
  - [x] Rake wallet checker (service)
  - [x] User wallet backfill/repair utility (guarded, dry-run)
- [ ] Performance/load:
  - [x] Basic load test script for `/rummy` namespace (connections)
  - [ ] Profiling pass on hot paths (deal/init, status emissions)
- [ ] Contracts & errors:
  - [ ] Centralize error code registry across HTTP + Socket.IO
  - [ ] Versioning note for socket payload schemas (backward-compat guidance)



End-to-End Test Plan
====================

Goal
----
Deterministic, fast, and non-flaky E2E coverage for Points, Deals, and Pool using Socket.IO + HTTP, with clean setup/teardown and clear assertions.

Test Harness & Utilities
------------------------
Create `src/__tests__/helpers/e2e.ts`:
- connectClient({ userId, token }): returns a wrapped Socket.IO client with:
  - emitAck(event, payload, timeoutMs): uses Socket.IO ack callbacks for deterministic completion.
  - emitIdem(event, payload): auto-injects a unique idempotencyKey.
  - waitFor(event, predicate, timeoutMs): resolves when predicate(data) is true.
- startServer()/stopServer(): spin app + namespace per suite (reuse current pattern); ensure `ioServer.of('/rummy').disconnectSockets(true)` on teardown.
- pollAdmin(path, query): calls admin endpoints with `x-admin-token`.
- advanceDeals(tableId), advancePool(tableId): POSTs to the test-only HTTP endpoints to deterministically advance matches.
- getTableAndJoin(client, opts): wraps `get-table` + `join-table`; returns `{ tableId }`.

Deterministic Environment (per E2E)
-----------------------------------
- TEST_DISABLE_TIMERS=1
- TOSS_JOIN_ORDER=1
- POINT_VALUE=1
- MAX_POINTS=80
- RAKE_PERCENT=0
- AUTO_FILL_BOT=0
- Optional (Points): TEST_WILD_RANK, TEST_HAND_S{seat}, TEST_LOOSE_DECLARE=1

Suites
------
1) Points Rummy E2E (points.e2e.test.ts)
- Valid declare flow:
  - c1, c2 connect; `getTableAndJoin` for 2 players, format=points.
  - waitFor('status', s => s.phase === 'started').
  - c1 performs actions (optionally `get-card`) then `declare` with seeded hand groups; waitFor('round-end').
  - Assert wallet delta via `wallet-update` and RoundResult persisted via `GET /api/admin/rounds/search`.
- Pack flow:
  - Same setup; c2 `pack-game` via emitAck; wait for 'round-end'.
  - Assert winner, deltas, hold release (if applicable).

2) Deals Rummy E2E (deals.e2e.test.ts)
- Set `DEALS_COUNT=2`; join and wait for started.
- Loop: `advanceDeals(tableId)` then poll `GET /api/admin/format-state` until remaining==0.
- Assert final settlement (min points winner), holds release, RoundResult persisted.

3) Pool Rummy E2E (pool.e2e.test.ts)
- Set `POOL_MAX_POINTS=20`; join and wait for started.
- Loop: `advancePool(tableId)` then poll format-state until only one remaining.
- Assert final settlement, holds release, RoundResult persisted.

Stability Tactics
-----------------
- Prefer ack-based emitAck() or admin polling over timing-sensitive broadcast waits.
- Use retry loops for admin polling: up to 80 iterations × 100 ms.
- Run E2Es `--runInBand` in CI to avoid port/signal contention.
- Ensure all timers/sockets are torn down in `afterAll`.

Structure
---------
- Place tests under `src/__tests__/e2e/`:
  - points.e2e.test.ts
  - deals.e2e.test.ts
  - pool.e2e.test.ts
- Optionally add `jest.e2e.config.js` with longer timeouts (e.g., `jest.setTimeout(30000)`).

CI Strategy
-----------
- Add a dedicated CI step after unit/integration:
  - `npm test -- --runInBand src/__tests__/e2e`
- Keep test-friendly env flags in CI: `TEST_DISABLE_TIMERS=1`, `TOSS_JOIN_ORDER=1`, etc.

Profiling & Logs (optional)
---------------------------
- ENABLE_PROFILING=1 to capture `x-response-time-ms` in HTTP responses during E2E.
- LOG_SOCKETS=1 for debugging only; keep off by default in CI.

Documentation
-------------
- Update README with an “E2E testing” section:
  - How to run E2Es locally/CI, required env vars, usage of test-only endpoints (`/api/test/deals/advance`, `/api/test/pool/advance`).
  - Note to include `schema_version: 'v1'` in future client emits for compatibility.

Acceptance Criteria
-------------------
- All E2Es pass reliably on repeated runs locally and in CI.
- No flakiness over 5 consecutive CI runs.
- Clear failure messages; ≤30s per E2E suite.



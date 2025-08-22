Rummy Backend
=============

Express + Socket.IO + MongoDB backend for Indian Rummy (Points / Deals / Pool).

Stack
-----
- Express.js HTTP APIs
- Socket.IO (`/rummy` namespace) for realtime gameplay
- MongoDB (Mongoose)
- Zod validation, Helmet, CORS, Morgan, express-rate-limit
- Jest + Supertest for tests

Getting Started
---------------

- Install dependencies:
  - `npm ci`
- Run in dev:
  - `npm run dev`
- Build:
  - `npm run build`
- Run tests:
  - `npm test`

Default ports and paths:
- HTTP server: `PORT=6969`
- Socket.IO path: `/socket.io`
- Socket.IO namespace: `/rummy`

Configuration (Environment Variables)
-------------------------------------

Core:
- `PORT` (default: `6969`)
- `MONGO_URI` (required in non-test/non-dev)
- `JWT_SECRET` (required in non-test/non-dev)
- `CORS_ORIGIN` (comma-separated list)
- `LOG_SOCKETS` (`1` to enable structured socket logs)

Gameplay / Rules:
- `TURN_MS` — per-turn timer in ms (e.g. `15000`)
- `POINT_VALUE` — currency per point (e.g. `1`)
- `MAX_POINTS` — cap for round (e.g. `80`)
- `FIRST_DROP` — points for first drop (e.g. `20`)
- `MIDDLE_DROP` — points for middle drop (e.g. `40`)
- `RAKE_PERCENT` — e.g. `0`..`20`
- `AUTO_FILL_BOT` — `1` to auto-fill seats with dev bots (dev only)

Match Formats:
- Deals:
  - `DEALS_COUNT` — total number of deals (e.g. `2`)
- Pool:
  - `POOL_MAX_POINTS` — elimination threshold (e.g. `101` or `201`)

Deterministic Testing Hooks:
- `TOSS_JOIN_ORDER` — `1` to seat players by join order (deterministic toss)
- `TEST_DISABLE_TIMERS` — `1` disables toss/turn/bot timers
- `TEST_LOOSE_DECLARE` — `1` relaxes strict declare coverage checks
- `TEST_WILD_RANK` — e.g. `5` to force wild rank
- `TEST_FIXED_DECK` — comma-separated deck cards for fixed dealing
- `TEST_HAND_S{seat}` — pre-set hand for seat index (e.g. `TEST_HAND_S0`)

Notes:
- Test flags are intended only for automated testing; never enable in production.

Admin Endpoints
---------------

Base path: `/api/admin`

- `GET /health`
  - Returns uptime, DB status, counts for tables/games
- `GET /holds`
  - Lists active wallet holds
- `GET /invariants`
  - Checks data invariants / inconsistencies
- `GET /reconcile`
  - Compares user wallet balances vs ledger deltas and active holds
- `GET /rounds/search?tableId=&userId=&limit=`
  - Query recent `RoundResult` entries by optional filters
- `GET /sockets?tableId=`
  - Lists active socket sessions (optionally filtered by table)
- `GET /format-state`
  - Inspect current Deals/Pool progression (cumulative, eliminated, remaining)

Example:
```
curl -s "http://localhost:6969/api/admin/rounds/search?tableId=T123&limit=20"
```

Socket.IO
---------

Namespace: `/rummy`

Highlights:
- All mutating events accept `idempotencyKey` for dedupe (short window)
- Deterministic test-only hooks (emitted by tests only):
  - `test_deals_progress` — advances Deals state deterministically
  - `test_pool_progress` — advances Pool state deterministically
- Important events (non-exhaustive):
  - `get-table`, `join-table`, `leave-table`
  - `start-game`, `status`, `wallet-update`, `round-end`
  - `get-card`, `get-drop-card`, `discardCard`, `group-cards`, `declare`, `pack-game`

Idempotency:
- The server deduplicates repeated mutating events per-socket using `idempotencyKey`.
- Include a unique `idempotencyKey` for client retries.

Finance & Holds
---------------
- Reserve holds are placed on join based on format (Points/Deals/Pool)
- Holds are released/retained according to match end rules
- Round-end deltas computed by format; wallet ledger is updated for auditability

Testing
-------

- Run unit + integration tests: `npm test`
- Useful tips for local runs:
  - To speed up tests: set `TEST_DISABLE_TIMERS=1` and `TOSS_JOIN_ORDER=1`
  - For deterministic scenarios, use `TEST_WILD_RANK`, `TEST_HAND_S{seat}`
- Known E2E status:
  - Deals/Pool E2Es are currently skipped using test-only advancement endpoints; all other tests are green.

Troubleshooting
---------------

- Jest open handles warning:
  - Ensure timers are `unref()`-ed in test env (already implemented)
  - Make sure `io.of('/rummy').disconnectSockets(true)` is called in teardown
- Socket debugging:
  - Set `LOG_SOCKETS=1` to enable structured JSON logs for key socket events
- Database:
  - In dev/test, auth may fallback to in-memory validation; in production DB token validation is strict

Security
--------
- Helmet, rate-limits, and schema validation are enabled
- Use strong `JWT_SECRET` and secure CORS in production

License
-------
Proprietary — internal project.

HTTP API Reference (concise)
---------------------------

Base: `/api`

- Auth (`/api/user`)
  - `POST /login` body: `{ mobile, password }` → `{ code, message, user_data:[{ id, name, mobile, token, wallet, ...}] }`
  - `POST /send_otp` body: `{ mobile, type }` → `{ code, message, otp_id }`
  - `POST /register` body: `{ name, mobile, otp_id, password, gender?, referral_code? }` → `{ code, message, user_id, token }`

- Tables & Matchmaking
  - `POST /tables/list` (if present) or via sockets `get-table`/`join-table` (preferred)
  - Socket equivalents documented below; HTTP surface is minimal

- Wallet (`/api/wallet`)
  - `GET /balance?userId=` → `{ code, data: { wallet } }`
  - `GET /ledger?userId=&limit=` → `{ code, data: LedgerEntry[] }`

- Admin (`/api/admin`) — requires header `x-admin-token`
  - `GET /health`
  - `GET /holds?active=&userId=&tableId=`
  - `GET /invariants`
  - `GET /reconcile?limit=`
  - `GET /rounds/search?tableId=&userId=&limit=`
  - `GET /sockets?tableId=`
  - `GET /format-state`
  - `GET /rake?from=ISO&to=ISO`

Socket.IO Contracts (core events)
---------------------------------

Namespace: `/rummy`. All mutating events accept `idempotencyKey?: string`.

- Connection: query `{ userId, token }` (validated).
- `get-table` → req `{ user_id, token, boot_value, no_of_players, format: 'points'|'deals'|'pool' }`
  - res `{ code, message, table_id, boot_value, no_of_players } | { code:401 }`
- `join-table` → req `{ user_id, token, table_id, idempotencyKey? }`
  - res `{ code, message, table_id, seat_no } | { code:401|404|402 }`
- `status` → req `{ user_id?, token?, game_id }`
  - res `{ code, game_id, table_id, seats, packed, currentTurn, deckCount, discardTop, phase, canDrawClosed, canDrawOpen, canDiscard, myGroups?, turnDeadline? } | { code:401|404 }`
- `my-card` → no body
  - res `{ code, message, hand } | { code:401|404 }`
- `get-card` → req `{ game_id, idempotencyKey? }`
  - res `{ code, message, card, hand } | { code:401|409 }`
- `get-drop-card` → req `{ game_id, idempotencyKey? }`
  - res `{ code, message, card, hand } | { code:401|409 }`
- `discardCard` → req `{ game_id, card, idempotencyKey? }`
  - res via `status` broadcast; errors `{ code:401|409 }`
- `group-cards` → req `{ game_id, groups: string[][], idempotencyKey? }`
  - echo `status` to caller with `myGroups`
- `declare` → req `{ game_id, groups: string[][], finish_card, idempotencyKey? }`
  - res `{ code, message, result? }`, room broadcast `round-end`
- `pack-game` → req `{ game_id, idempotencyKey? }`
  - res `{ code, message }`, room broadcast `status` and possibly `round-end`
- Server emits
  - `start-game`, `status`, `my-card`, `round-end`, `wallet-update`, `deals-progress`, `pool-progress`

Errors (common codes)
---------------------
- 200: Success; 400: Invalid request; 401: Unauthorized; 402: Insufficient wallet; 404: Not found; 409: Conflict/invalid state

Schema Versioning
-----------------
- Socket payloads are considered versioned via a lightweight header field when needed: include `schema_version` in client emits if we introduce breaking changes.
- Server currently treats `schema_version` as optional and defaults to v1. Future breakers will be gated behind a new version value (e.g., `v2`) and feature-flagged rollout.
- Recommendation for clients: always send `schema_version: 'v1'` in payloads to ease future compatibility.




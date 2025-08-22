## Rummy App — Professional Build Plan (Backend first, then Mobile Frontend)

This document is the single source of truth for delivery scope, priorities, and step-by-step tasks for a production-grade rummy app. It is designed to closely mirror RummyCircle’s functionality while using our own implementation.

Notes and constraints applied throughout:
- Mobile app will be bare React Native CLI, not Expo [[memory:5877401]].
- Primary brand color is purple `#7B2FF2` and should be used for call-to-action/upgrade buttons [[memory:4955460]].
- Keep `frontend` and `backend` as separate folders; do not copy builds into each other [[memory:2811886]].
- Backend default port: 6969; Socket.IO namespace: `/rummy`; path: `/socket.io`.
- Database: MongoDB; asset storage for KYC/docs: DigitalOcean Spaces [[memory:2971035]].

---

### 1) High-Level Architecture

- Clients: React Native mobile app (iOS/Android), Admin web console (later).
- Backend: Express HTTP API + Socket.IO realtime gateway (namespace `/rummy`).
- Data: MongoDB for system of record; Redis for sessions/queues/pubsub (scale phase).
- Storage: DigitalOcean Spaces for KYC docs; Payments via aggregator (UPI/cards/net banking).
- Observability: Centralized logs, metrics, traces; audit logging for wallet/admin.

---

## Backend Plan (Priority-ordered, with steps and acceptance criteria)

We will deliver the backend first. Each priority block is small, shippable, and independently verifiable.

### P0 — Stabilize core server and security (Now)

Goals: No dev-only shortcuts in prod; consistent status payload; minimum observability.

Steps
1. Environment/config hardening
   - Add `.env.example` with: `PORT=6969`, `CLIENT_ORIGIN=*`, `MONGO_URI`, `MONGO_DB=rummy`, `ADMIN_TOKEN`, `REDIS_URL` (future), `PAYMENTS_*` (future).
   - Implement strict config loader (required vars by NODE_ENV).
2. Request pipeline
   - Ensure `helmet`, `cors`, `morgan` in place; JSON body limits; rate-limit public endpoints.
   - Add `/health` and `/ready` endpoints.
3. Auth guard tightening
   - Enforce DB-backed token validation when `MONGO_URI` is set; disable in-memory fallback in production.
   - Add admin middleware checking `x-admin-token`.
4. Status event enrichment
   - Include `phase`, `currentTurn`, `packed`, `deckCount`, `discardTop`, `turnDeadline` (epoch ms), `game_id`, `table_id` in every `status` emit.
5. Basic metrics/logging
   - Log socket connects/disconnects with userId; count active tables/games.

Acceptance Criteria
- Hitting `/health` returns `{ status: 'ok' }`; `/ready` verifies DB connection when configured.
- Socket connect drops invalid tokens when DB is connected.
- `status` payload always contains `turnDeadline` and core fields.
- Logs show connects/disconnects and table counts without PII.

---

### P1 — Gameplay rules lock (Validation, scoring, timers)

Goals: Deterministic rules engine mirroring 13-card Indian Rummy (configurable).

Steps
1. Rules config module
   - JSON/TS config for variant, timers, penalties, `handPointCap`, jokers usage, rake.
2. Declare validator
   - Validate pure/impure sequences, minimum two sequences with ≥1 pure, sets, joker handling.
   - Return structured errors for invalid declares.
3. Scoring engine
   - Compute hand points; apply caps; calculate winner and deltas.
4. Timers & auto-actions
   - Per-turn timer with soft warning; expiry → auto-pack or server policy discard.
   - Declare timer; expiry → invalid declare penalty.
5. Tests (must pass before merge)
   - Unit tests for sequences/sets, joker cases, invalid declares, score caps, drop penalties.

Acceptance Criteria
- Given test hands, validator outcomes match spec; scoring matches expected totals; timers trigger correct auto-actions.
- Code coverage for rules ≥ 90%.

---

### P2 — Socket contract freeze (Schemas, idempotency, errors, reconnect)

Goals: Stable, documented event protocol for client integration.

Steps
1. Event catalog
   - Client→Server: `get-table`, `join-table`, `my-card`, `get-card`, `get-drop-card`, `discardCard`, `group-cards`, `pack-game`, `declare`, `leave-table`, `ping`, `health_check`.
   - Server→Client: `get-table`, `status`, `roundResult`, `error`, `pong`, `health_ok`.
2. JSON Schemas & validation
   - Define schemas for all payloads; validate on ingress; emit structured error codes.
3. Idempotency & rate limits
   - Per-socket rate-limits for spammy events; optional `idempotencyKey` to dedupe replays.
4. Reconnect semantics
   - On connect, server replays last `status` for user’s table; preserve timers; grace window for seat hold.

Acceptance Criteria
- Schemas published in repo; integration tests run full turn: draw→discard→status; reconnect resumes correctly; duplicate actions are safely ignored.

---

### P3 — Persistence for tables/games/results

Goals: Durable game state; safe restarts; queryable history.

Data Models (MongoDB)
- `tables`: { tableId, format, bootValue, noOfPlayers, status, seats[], createdAt, updatedAt }
- `games`: { gameId, tableId, phase, deck, discard, players[], currentTurn, packed[], deadlines, config }
- `round_results`: { tableId, gameId, pointValue, winnerUserId, points[{ user_id, seat, points, delta }], rake }

Steps
1. Define schemas with indexes (e.g., `tableId`, `gameId`, `winnerUserId`, timestamps).
2. Persist transitions: table create/join/start/round-end; append-only where possible.
3. Safe restart: on boot, reload active tables/games into memory; reconcile timers.

Acceptance Criteria
- Restart does not lose active games; historical queries for a table/game return consistent snapshots.

---

### P4 — Matchmaking & lobby

Goals: Deterministic quick-join; reliable seat assignment; reconnection to same seat.

Steps
1. Lobbies by format and boot/stake; 2P/6P pools.
2. Quick-join selects non-full table or creates one.
3. Seat reservation with timeout; reclaim if player doesn’t ready in time.
4. Reconnect to same seat within grace period; else auto-pack.
5. Lobby API: list minimal available tables; admin listings.

Acceptance Criteria
- Joining is predictable; reconnection returns same seat; seat reclaim works; lobby endpoints return expected lists.

---

### P5 — Wallet MVP (Ledger-first)

Goals: Auditable ledger; holds on join; settlements with rake; no gateway yet.

Data Models
- `wallet_ledger`: { userId, delta, reason, ref, balanceAfter, meta, createdAt }
- `transactions` (prepare for P6): { userId, type, amount, status, gatewayRef, fees, tax, createdAt }

Steps
1. Ledger invariants and helpers: idempotent writes keyed by `ref`.
2. Join: place hold = boot/entry; on pack/end, settle/release per format policy.
3. Round end: compute rake; ledger entries for winner/losers/rake.
4. APIs: `GET /wallet/balance`, `GET /wallet/ledger` (paginated).
5. Tests: invariants, concurrent ops, round settlements.

Acceptance Criteria
- Round settlements reconcile to zero-sum except rake; ledger passes invariants; idempotency verified.

---

### P6 — Payments, KYC, state restrictions (minimal viable)

Goals: Legal play + cash-in/out path; block restricted states; KYC gate withdrawals.

Steps
1. State restrictions: capture user state; block table join if restricted.
2. KYC: store PAN/Aadhaar status; simple doc upload to DO Spaces; manual verify flag.
3. Payments: sandbox gateway integration for add cash; basic withdrawal request queue.
4. Withdrawals require KYC-approved; add audit logs.

Acceptance Criteria
- Restricted states cannot join paid tables; deposits succeed in sandbox; withdrawals gated by KYC status.

---

### P7 — Admin essentials

Steps
1. Tables monitor: list active tables/games; inspect seats/status.
2. User lookup; wallet adjustments (dual-control approval); view round history.
3. Audit every admin action.

Acceptance Criteria
- Ops can safely view and adjust with full audit trail.

---

### P8 — Observability/SRE

Steps
1. Metrics: active tables, per-turn latency, drop/pack rates, reconnects, wallet errors.
2. Structured logging; correlation IDs; request and socket spans.
3. Alerts and dashboards; backup/restore runbooks.

Acceptance Criteria
- Dashboards and alerts exist; on-call can diagnose issues via traces and logs.

---

### P9 — Scale-out readiness

Steps
1. Socket.IO Redis adapter; namespace `/rummy` pub/sub.
2. Shard assignment by `tableId` → sticky to worker; worker pool for timers.
3. Load test; tune rate limits/backpressure.

Acceptance Criteria
- Sustained high room counts with target latency; no timer drift under load.

---

### P10 — Risk & fair play

Steps
1. Signals: device/IP clustering; abnormal play heuristics; repeated co-play detection.
2. Throttle or flag suspect sessions; surface signals in admin.

Acceptance Criteria
- Basic anti-collusion signals visible; actions logged.

---

### Backend API & Socket Reference (Authoritative)

Environment Variables (`.env`)
```
PORT=6969
CLIENT_ORIGIN=http://localhost:3333
MONGO_URI=mongodb://localhost:27017
MONGO_DB=rummy
ADMIN_TOKEN=change-me
REDIS_URL=redis://localhost:6379
PAYMENTS_PROVIDER=
PAYMENTS_KEY=
PAYMENTS_SECRET=
DO_SPACES_KEY=
DO_SPACES_SECRET=
DO_SPACES_BUCKET=
```

HTTP Endpoints (prefix `/api`)
- `/health`, `/ready`
- `/user/login`, `/user/register`, `/user/send_otp`, `/user/update_user_data`
- `/admin/tables` (token-protected)
- `/wallet/balance`, `/wallet/ledger`
- `/tables/list` (minimal lobby)

Socket.IO (namespace `/rummy`)
- Client→Server: `get-table`, `join-table`, `my-card`, `get-card`, `get-drop-card`, `discardCard`, `group-cards`, `pack-game`, `declare`, `leave-table`, `ping`, `health_check`.
- Server→Client: `get-table`, `status`, `roundResult`, `error`, `pong`, `health_ok`.
- Status payload includes: `{ game_id, table_id, seats, currentTurn, phase, packed, deckCount, discardTop, turnDeadline }`.

Testing Strategy
- Rules engine unit tests (validator/scoring/timers) with high coverage.
- Socket integration tests for full turn cycle and reconnect.
- Wallet reconciliation tests (idempotency, concurrent ops).
- Load test scripts for rooms and timers.

---

## Mobile Frontend Plan (to start after backend P2–P3)

Platform & Foundations
- Bare React Native CLI app (no Expo) [[memory:5877401]].
- State: Zustand or Redux Toolkit; React Query for server cache.
- Navigation: React Navigation (stack + bottom tabs).
- Theming: primary `#7B2FF2` [[memory:4955460]]; dark mode support.
- Socket client: `socket.io-client` with reconnect and queueing.
- Error/reporting: Sentry or equivalent; in-app logs toggle.

Project Structure
```
mobile/
  src/
    screens/ (Login, Lobby, Table, Results, Wallet, KYC, Settings)
    components/ (Hand, Card, TimerRing, SeatsRing, GameTable, DashboardHeader/Footer, etc.)
    services/ (api, socket)
    store/ (auth, settings, socket, game)
    theme/ (colors, spacing, typography)
    utils/ (validators, formatters)
```

UI Flows
- Onboarding: login via mobile+OTP/password, consent, state selection/blocking.
- Lobby: Points/Deals/Pool tabs, filters, quick-join, table details.
- Table: hand grouping, draw/discard, joker highlight, timer ring, pack/declare.
- Wallet: balance, ledger, add cash (sandbox), withdraw (gated by KYC).
- KYC: PAN/Aadhaar upload to DO Spaces; status screen.
- Reconnect: auto-resume, offline banners.

Socket Integration
- Connect with `{ userId, token }` query.
- Subscribe to `status`, `roundResult`; send actions per contract.
- Local queue for actions when temporarily offline; dedupe with `idempotencyKey`.

Testing & Quality
- Unit tests: reducers/stores, components.
- Integration tests: turn flows against mock socket server.
- E2E: Detox flows (login, quick-join, play, declare, results).

Performance & UX
- Asset optimization (sprite sheets, lazy loading); 60fps animations for card moves.
- Accessibility labels; haptics on key actions.

Release & Ops
- Env-driven API base; feature flags.
- CI/CD for builds; fastlane for stores; OTA update policy.

---

## Deliverables & Milestones Checklist

- [ ] P0 Backend security/observability
- [ ] P1 Rules engine lock + tests
- [ ] P2 Socket contract freeze + schemas
- [ ] P3 Persistence for tables/games/results
- [ ] P4 Matchmaking/lobby
- [ ] P5 Wallet MVP + settlements
- [ ] P6 Payments/KYC/state restrictions (minimal)
- [ ] P7 Admin essentials + audit
- [ ] P8 Observability/SRE (dashboards/alerts)
- [ ] P9 Scale-out readiness (Redis adapter, sharding)
- [ ] P10 Risk/fair play signals
- [ ] Mobile foundations + socket integration
- [ ] Mobile gameplay UI/UX polish
- [ ] Wallet/KYC flows on mobile

---

## References
- Backend defaults: `PORT=6969`, namespace `/rummy`, path `/socket.io`.
- Data: MongoDB primary; DigitalOcean Spaces for KYC/docs [[memory:2971035]].
- Mobile theming: primary `#7B2FF2` [[memory:4955460]].
- Folder separation policy for frontend/backend [[memory:2811886]].



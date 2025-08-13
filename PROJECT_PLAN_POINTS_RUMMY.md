## Points Rummy – Project Plan (v1)

### Vision and scope
- Build a high-quality mobile rummy app (React Native) inspired by RummyCircle, using our Flutter app for UI/UX reference and parity.
- Start with Points Rummy (13-card Indian Rummy) as the first game type; architect to support Deals and Pool later.

### Key references and rule notes (Points Rummy)
- Standard Points Rummy (13 cards, at least two sequences, at least one pure sequence).
- Jokers: printed jokers + wild card rank per game.
- Typical scoring defaults (to be confirmed against product):
  - Pure/impure sequence validation as per Indian rummy norms.
  - Drop penalties and max score cap are product-configurable. Tentative defaults: first drop 20, middle drop 40, wrong show/full count max 80. Validate against design/Flutter reference before locking.
- Payouts: Winner gets sum of opponents’ points × per-point value (minus rake if applicable). For v1, we simulate chips/wallet using the existing `wallet` field; no payment gateway in scope for initial builds.

> Action: Confirm exact rule values (drop penalties, max count, scoring cap, per-point value ranges) with product and align with Flutter reference screens.

---

### Current state assessment

Backend (Node, Express, Socket.IO, optional Mongo)
- [x] Express server with CORS, helmet, morgan; health endpoint.
- [x] Auth routes: login, send_otp, register (dev supports in-memory user auto-creation; DB path uses bcrypt passwordHash).
- [x] User route: update_user_data with wallet adjustment (atomic when Mongo is enabled).
- [x] Socket namespace `/rummy` with events: `get-table`, `join-table`, `table-joined`, `start-game`, `status`, `my-card`, `get-card`, `get-drop-card`, `discardCard`, `pack-game`, `declare`, `leave-table`.
- [x] In-memory game engine: deck build, joker rank, toss logic, seating, turn order, basic draw/discard rules, simple rate limits.
- [ ] Token enforcement in handshake and across all events (currently permissive in dev).
- [ ] Persistence for tables/games/sessions (currently in-memory, no reconnect/recovery across server restarts).

React Native app (`mobile`)
- [x] Auth flow with `zustand`, persistent `AsyncStorage`, login/register screens.
- [x] Dashboard, Cash/Practice lists, Points Rummy lobby and Game Table screens.
- [x] Socket client wiring for lobby and game, status polling, card draw/drop, declare preview using local validation utilities.
- [x] Basic orientation handling (portrait for login, landscape for in-game).
- [ ] Robust reconnection/resubscribe logic (resume status after reconnect, rejoin room, recover timers/UI).
- [ ] Full UI parity with Flutter (styles, components, micro-interactions, assets coverage).

Flutter app (reference)
- [x] Rich UI/UX implementation with Providers and detailed screens; used as authoritative design reference.

Environments
- Backend default port 6969; RN app base URL `http://10.0.2.2:6969` for Android emulator. Socket namespace `/rummy`.

---

### Functional requirements (Points Rummy v1)
- Auth and Profile
  - [x] Login/Register via mobile/password (OTP simulated)
  - [ ] Edit profile, show wallet, update gender/referral
- Lobby and Matchmaking
  - [x] Quick Play for Points Rummy (select boot/no_of_players ⇒ get/join table)
  - [ ] Table list and custom table configs (point value, seats, entry)
- Game Lifecycle
  - [x] Deal 13 cards, wild card rank, toss to decide first turn
  - [x] Draw from closed/open deck, discard, turn rotation
  - [x] Client declare preview + server validate stub
  - [ ] Full scoring/settlement, drop penalties, wrong show handling, winner broadcast, round end state
  - [ ] Turn timers, auto actions on timeout (draw/drop/auto-pack optional), anti-spam/anti-cheat validations
  - [ ] Rejoin mid-game (recover seat, hand, turn, timers)
- Wallet and Settlement (Simulated for v1)
  - [ ] Per-point value config, compute round deltas, update wallet atomically (Mongo)
  - [ ] Match summary and history (server emits, client renders)
- Observability and Admin
  - [ ] Structured logs for game events, error metrics
  - [ ] Basic admin/debug endpoints (list games/tables, force-start/stop) – dev only

---

### Non-functional requirements
- Reliability: Reconnection support, idempotent actions, server-side guards.
- Security: Token-based auth on sockets and APIs; input validation; minimal PII.
- Performance: Event rate limiting (present), optimize broadcast scopes (rooms used), avoid large payloads.
- Observability: Log game IDs, table IDs, user IDs; add basic metrics counters.

---

### Architecture notes and decisions
- Keep game state server-authoritative. Client is presentation only; all moves validated server-side.
- Maintain in-memory engine for fast iteration; add persistence abstraction to enable Mongo/Redis later without changing client.
- Namespace: `/rummy`; rooms per table (`table:{id}`).
- Token validation: accept in Socket handshake (query `userId`,`token`) and per-event fallback; enforce when DB is connected.
- Consistent payload shapes with Flutter reference to maximize reuse.

---

### Delivery plan (milestones and checklists)

Milestone 0 – Repo hygiene and environment
- [x] Verify backend boots on 6969 and socket on `/rummy`
- [x] RN app compiles, logs in, and plays a mock game end-to-end in dev
- [ ] Add `.env` support across backend and RN app (base URL, AUTO_FILL_BOT, point values)
- [ ] Add `docs/` with architecture diagrams and event contracts

Milestone 1 – Auth + token hardening
- [ ] Pass `token` in RN socket handshake query; include in all event payloads where applicable
- [ ] Enforce token on all events when DB is connected (`validateUserToken`)
- [ ] Session middleware for APIs; rate-limit login/register
- [ ] Add logout/invalidate token (optional for v1)

Milestone 2 – Lobby and matchmaking UX
- [x] Quick Play (get-table → join-table → wait → start-game)
- [ ] Player count selector parity (2/6), entry/boot UI polish per Flutter
- [ ] Optional real table list with filters (defer if time-constrained)

Milestone 3 – Gameplay engine completeness
- [x] Dealing, joker selection, toss
- [x] Draw from closed/open, discard with turn validation
- [x] Enforce draw-then-discard strictly on server (partial exists)
- [ ] Turn timers (server clock), timeout actions (auto-pack or auto-discard rules per product)
- [x] Server-side declare validation (baseline) and provisional scoring (drop penalties, caps)
- [x] Round settlement stub: winner computation, losers’ penalties, max cap; emit `round-end`
- [ ] Full scoring per rummy rules (deadwood, sequences, sets); wallet settlement

Milestone 4 – Persistence and reconnection
- [ ] Persist users, tables, games to Mongo (minimal schema for game snapshot)
- [ ] On reconnect, restore session to room, rehydrate seat/hand/status
- [ ] Idempotent event handling (ignore duplicates)

Milestone 5 – Wallet and match summary
- [ ] Configure per-point value per table; store in table/game
- [ ] Compute wallet deltas at round end; atomic update in Mongo
- [ ] Client summary UI (who won, points, payouts); history list (recent games)

Milestone 6 – RN UI parity with Flutter
- [ ] Apply Flutter reference layouts: lobby, in-game table, controls, animations
- [ ] Theme consistency, typography, asset coverage
- [ ] Micro-interactions: button states, toasts, timers, indicators

Milestone 7 – QA, telemetry, and readiness
- [ ] E2E happy-path tests: login → quick play → one round → summary
- [ ] Load test basic concurrency (multiple tables)
- [ ] Crash/edge cases: disconnects, late joins, invalid moves
- [ ] Basic analytics/logging for key events (start-game, declare, winner)

---

### Technical tasks backlog (detailed)

Backend
- [ ] Add `token` to Socket handshake and verify in `connection` (already partly supported) and all events
- [ ] Expand `declare` to compute points per player; add penalties (first/middle drop, wrong show)
- [ ] Add `round-end` event; snapshot game; transition table status to waiting or closed
- [ ] Introduce simple persistence layer: GameSnapshot collection (tableId, gameId, hands, discard, turn, wild, timestamps)
- [ ] Reconnect handler: map userId → table/game → seat; send `status` + `my-card` on connect
- [ ] Admin/dev endpoints to introspect tables/games (dev-only)

React Native
- [ ] Socket provider/store (centralize socket, auto-reconnect, backoff, re-subscribe to status)
- [ ] Game state store to reduce per-screen socket plumbing
- [ ] UI: Lobby selector parity, waiting room, in-game controls, timer UI, declare flow
- [ ] Summary modal/screen; history screen (optional for v1)
- [ ] Theming pass and assets audit to match Flutter

QA and Tooling
- [ ] Contract tests for API and socket events
- [ ] Simulated multi-client test scripts (bot runner)
- [ ] Error reporting and logging format

---

### Open questions
- Exact product values for drop penalties, max points, wrong show, and per-point ranges?
- Bot behavior in production (disabled?) and practice mode separation?
- Persistence expectations (resume across app cold start vs server restart)?
- Table lifecycle (single round vs continuous matches)?

---

### Acceptance criteria (v1)
- A user can login/register, quick-join Points Rummy, complete a round with another player/bot, and see a round summary with basic scoring and wallet adjustment (in Mongo when enabled).
- Client gracefully handles brief disconnects and resumes.
- UI closely matches Flutter reference for the focused screens (login, lobby, game table, summary).

---

### Appendices
- Ports: Backend 6969; RN base URL `http://10.0.2.2:6969` (Android emulator), adjust for device.
- Socket namespace: `/rummy`, path `/socket.io`.
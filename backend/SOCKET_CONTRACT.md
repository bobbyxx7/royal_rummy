## Socket Contract (namespace `/rummy`)

Connection: query `{ userId, token }`

Client → Server
- `get-table { user_id?, token?, boot_value?, no_of_players?, idempotencyKey? }`
- `join-table { user_id, token?, table_id, idempotencyKey? }`
- `status { game_id, user_id?, token? }`
- `my-card {}`
- `get-card { idempotencyKey? }`
- `get-drop-card { idempotencyKey? }`
- `discardCard { card, idempotencyKey? }`
- `group-cards { groups, idempotencyKey? }`
- `pack-game { game_id?, idempotencyKey? }`
- `declare { groups, finish_card?, idempotencyKey? }`
- `leave-table {}`
- `ping`, `health_check`

Server → Client
- `status { code, message, game_id, table_id, currentTurn, deckCount, discardTop, seats, packed, phase, turnDeadline, canDrawClosed?, canDrawOpen?, canDiscard?, myGroups? }`
- `my-card { code, message, hand }`
- `get-table { code, message, table_id, boot_value, no_of_players }`
- `join-table { code, message, table_id, seat_no }`
- `round-end { code, message, game_id, table_id, winner_user_id, points[], point_value, wildCardRank, hands, groups, rake }`
- `table-joined { code, message, table_id, joined, total }`
- `pong`, `health_ok`

See `ERROR_CODES.md` for response codes.



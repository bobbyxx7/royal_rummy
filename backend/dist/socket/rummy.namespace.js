"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rummyNamespace = rummyNamespace;
const state_1 = require("./state");
function rummyNamespace(io) {
    const nsp = io.of('/rummy');
    nsp.on('connection', (socket) => {
        // eslint-disable-next-line no-console
        console.log(`[socket] connected: ${socket.id}`);
        const { userId } = socket.handshake.query;
        if (userId && typeof userId === 'string') {
            state_1.sessions.set(socket.id, { socketId: socket.id, userId });
            state_1.userIdToSocket.set(userId, socket.id);
        }
        // Health check event used by connectivity service
        socket.on('health_check', (payload) => {
            socket.emit('health_ok', { ok: true, ts: Date.now(), echo: payload });
        });
        // Generic ping support (client also sends periodic pings)
        socket.on('ping', (data) => {
            socket.emit('pong', data ?? 'pong');
        });
        // get-table matchmaking
        socket.on('get-table', (payload) => {
            try {
                const session = (0, state_1.findSessionBySocket)(socket.id);
                if (!session)
                    return;
                const { user_id, token, boot_value, no_of_players } = payload || {};
                // TODO: validate token for prod
                const table = (0, state_1.createOrFindTable)(String(boot_value ?? '0'), Number(no_of_players ?? 2));
                socket.join((0, state_1.TABLE_ROOM)(table.id));
                session.tableId = table.id;
                socket.emit('get-table', {
                    code: 200,
                    message: 'Success',
                    table_id: table.id,
                    boot_value: table.bootValue,
                    no_of_players: table.noOfPlayers,
                });
            }
            catch (e) {
                socket.emit('get-table', { code: 500, message: 'error' });
            }
        });
        // join-table
        socket.on('join-table', (payload) => {
            const session = (0, state_1.findSessionBySocket)(socket.id);
            if (!session)
                return;
            const { user_id, token, table_id } = payload || {};
            const table = state_1.waitingTables.get(String(table_id || session.tableId || ''));
            if (!table) {
                socket.emit('join-table', { code: 404, message: 'Table not found' });
                return;
            }
            const joined = (0, state_1.joinTable)(table, String(user_id));
            if (!joined) {
                socket.emit('join-table', { code: 409, message: 'Table full' });
                return;
            }
            session.tableId = table.id;
            session.seatNo = joined.seatNo;
            socket.join((0, state_1.TABLE_ROOM)(table.id));
            socket.emit('join-table', { code: 200, message: 'Success', table_id: table.id, seat_no: joined.seatNo });
            // Auto-start when table fills
            const filled = table.players.filter(Boolean).length >= table.noOfPlayers;
            if (filled) {
                const game = (0, state_1.startGameForTable)(table);
                // broadcast start-game to room
                nsp.to((0, state_1.TABLE_ROOM)(table.id)).emit('start-game', {
                    code: 200,
                    message: 'Success',
                    game_id: game.id,
                    table_id: table.id,
                    playersHands: game.playersHands,
                    wildCardRank: game.wildCardRank,
                    currentTurn: game.currentTurn,
                });
            }
        });
        // status
        socket.on('status', (payload) => {
            const { game_id } = payload || {};
            const game = state_1.games.get(String(game_id || ''));
            if (!game) {
                socket.emit('status', { code: 404, message: 'Game not found' });
                return;
            }
            socket.emit('status', {
                code: 200,
                message: 'Success',
                game_id: game.id,
                currentTurn: game.currentTurn,
                deckCount: game.deck.length,
                discardTop: game.discardPile[game.discardPile.length - 1] || null,
                seats: game.players,
            });
        });
        // my-card: return the player hand for current game
        socket.on('my-card', (_payload) => {
            const session = (0, state_1.findSessionBySocket)(socket.id);
            if (!session || !session.tableId)
                return;
            const game = [...state_1.games.values()].find((g) => g.tableId === session.tableId);
            if (!game) {
                socket.emit('my-card', { code: 404, message: 'Game not found' });
                return;
            }
            const seat = session.seatNo ?? game.players.findIndex((u) => u === session.userId);
            const hand = seat >= 0 ? game.playersHands[seat] : [];
            socket.emit('my-card', { code: 200, message: 'Success', hand });
        });
        // get-card: draw from deck to player hand, emit updated hand
        socket.on('get-card', (_payload) => {
            const session = (0, state_1.findSessionBySocket)(socket.id);
            if (!session || !session.tableId)
                return;
            const game = [...state_1.games.values()].find((g) => g.tableId === session.tableId);
            if (!game)
                return;
            const seat = session.seatNo ?? game.players.findIndex((u) => u === session.userId);
            const card = game.deck.shift() || null;
            if (card && seat >= 0) {
                game.playersHands[seat].push(card);
            }
            socket.emit('get-card', { code: 200, message: 'Success', card, hand: seat >= 0 ? game.playersHands[seat] : [] });
        });
        // get-drop-card: peek top discard and give it
        socket.on('get-drop-card', (_payload) => {
            const session = (0, state_1.findSessionBySocket)(socket.id);
            if (!session || !session.tableId)
                return;
            const game = [...state_1.games.values()].find((g) => g.tableId === session.tableId);
            if (!game)
                return;
            const seat = session.seatNo ?? game.players.findIndex((u) => u === session.userId);
            const card = game.discardPile.pop() || null;
            if (card && seat >= 0) {
                game.playersHands[seat].push(card);
            }
            socket.emit('get-drop-card', { code: 200, message: 'Success', card, hand: seat >= 0 ? game.playersHands[seat] : [] });
        });
        // discardCard: client sends full card object, server converts to code and discards
        socket.on('discardCard', (payload) => {
            const session = (0, state_1.findSessionBySocket)(socket.id);
            if (!session || !session.tableId)
                return;
            const game = [...state_1.games.values()].find((g) => g.tableId === session.tableId);
            if (!game)
                return;
            const seat = session.seatNo ?? game.players.findIndex((u) => u === session.userId);
            const code = (0, state_1.clientCardToCode)(payload?.card);
            if (!code || seat < 0)
                return;
            // remove from hand if present
            const idx = game.playersHands[seat].indexOf(code);
            if (idx >= 0)
                game.playersHands[seat].splice(idx, 1);
            game.discardPile.push(code);
            nsp.to((0, state_1.TABLE_ROOM)(game.tableId)).emit('status', {
                code: 200,
                message: 'Discarded',
                discardTop: code,
                currentTurn: game.currentTurn,
            });
        });
        // pack-game: user packs; for now just acknowledge
        socket.on('pack-game', (payload) => {
            const { game_id } = payload || {};
            const game = state_1.games.get(String(game_id || ''));
            if (!game) {
                socket.emit('pack-game', { code: 404, message: 'Game not found' });
                return;
            }
            socket.emit('pack-game', { code: 200, message: 'Success' });
        });
        // declare: stub accept and echo
        socket.on('declare', (payload) => {
            // TODO: add full validation
            socket.emit('declare', { code: 200, message: 'Success', result: { valid: true } });
        });
        // leave-table: remove user from table room
        socket.on('leave-table', (payload) => {
            const session = (0, state_1.findSessionBySocket)(socket.id);
            if (!session || !session.tableId)
                return;
            const tableId = session.tableId;
            socket.leave((0, state_1.TABLE_ROOM)(tableId));
            session.tableId = undefined;
            session.seatNo = undefined;
            socket.emit('leave-table', { code: 200, message: 'Success' });
        });
        socket.on('disconnect', (reason) => {
            // eslint-disable-next-line no-console
            console.log(`[socket] disconnected: ${socket.id} reason=${reason}`);
            const s = state_1.sessions.get(socket.id);
            if (s) {
                state_1.userIdToSocket.delete(s.userId);
            }
            state_1.sessions.delete(socket.id);
        });
    });
    return nsp;
}

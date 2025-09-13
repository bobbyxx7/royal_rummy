"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.persistTableSnapshot = persistTableSnapshot;
exports.persistGameSnapshot = persistGameSnapshot;
exports.deleteGameSnapshot = deleteGameSnapshot;
const db_1 = require("../db");
const auth_1 = require("../auth");
async function persistTableSnapshot(table) {
    if (!(0, auth_1.isDbConnected)())
        return;
    try {
        await db_1.TableModel.updateOne({ tableId: table.id }, {
            $set: {
                tableId: table.id,
                bootValue: table.bootValue,
                noOfPlayers: table.noOfPlayers,
                status: table.status,
                players: table.players,
                pointValue: Number(table.pointValue || 1),
            },
        }, { upsert: true }).exec();
    }
    catch { }
}
async function persistGameSnapshot(game) {
    if (!(0, auth_1.isDbConnected)())
        return;
    try {
        await db_1.GameModel.updateOne({ gameId: game.id }, {
            $set: {
                gameId: game.id,
                tableId: game.tableId,
                players: game.players,
                currentTurn: game.currentTurn,
                phase: game.phase,
                deckCount: game.deck.length,
                discardTop: game.discardPile[game.discardPile.length - 1] || null,
                pointValue: Number(game.pointValue || 1),
                wildCardRank: game.wildCardRank || undefined,
                turnDeadline: game.turnDeadline,
            },
        }, { upsert: true }).exec();
    }
    catch { }
}
async function deleteGameSnapshot(gameId) {
    if (!(0, auth_1.isDbConnected)())
        return;
    try {
        await db_1.GameModel.deleteOne({ gameId }).exec();
    }
    catch { }
}

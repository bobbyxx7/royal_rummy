import { Table, Game } from './state';
import { GameModel, TableModel } from '../db';
import { isDbConnected } from '../auth';

export async function persistTableSnapshot(table: Table): Promise<void> {
  if (!isDbConnected()) return;
  try {
    await TableModel.updateOne(
      { tableId: table.id },
      {
        $set: {
          tableId: table.id,
          bootValue: table.bootValue,
          noOfPlayers: table.noOfPlayers,
          status: table.status,
          players: table.players,
          pointValue: Number(table.pointValue || 1),
        },
      },
      { upsert: true },
    ).exec();
  } catch {}
}

export async function persistGameSnapshot(game: Game): Promise<void> {
  if (!isDbConnected()) return;
  try {
    await GameModel.updateOne(
      { gameId: game.id },
      {
        $set: {
          gameId: game.id,
          tableId: game.tableId,
          players: game.players,
          currentTurn: game.currentTurn,
          phase: game.phase,
          deckCount: game.deck.length,
          discardTop: game.discardPile[game.discardPile.length - 1] || null,
          pointValue: Number((game as any).pointValue || 1),
          wildCardRank: game.wildCardRank || undefined,
          turnDeadline: game.turnDeadline,
        },
      },
      { upsert: true },
    ).exec();
  } catch {}
}

export async function deleteGameSnapshot(gameId: string): Promise<void> {
  if (!isDbConnected()) return;
  try {
    await GameModel.deleteOne({ gameId }).exec();
  } catch {}
}



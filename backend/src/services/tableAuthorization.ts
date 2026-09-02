import { pool } from '../db/pool';

export type SeatType = 'player' | 'spectator';

// H-01/H-02/H-03: the shared "are you actually part of this table/game"
// check. Everything that used to gate on "logged in" alone (table detail,
// game state, round detail/mutations, socket room joins) should gate on
// this instead - a bare login proves who you are, not that you belong to
// this particular table.
export async function loadActiveSeat(tableId: string, userId: string): Promise<SeatType | null> {
  const result = await pool.query(
    `SELECT seat_type FROM table_seat WHERE table_id = $1 AND user_id = $2 AND left_at IS NULL LIMIT 1`,
    [tableId, userId],
  );
  return (result.rows[0]?.seat_type as SeatType | undefined) ?? null;
}

export interface GameAccess {
  gameId: string;
  tableId: string;
  seatType: SeatType;
}

// Read access to a game (state, round detail): requires an active seat
// (player or spectator) at the game's table. Returns null for "doesn't
// exist" and "not a member" alike, so callers can 404 either case without
// confirming to a stranger that a given gameId is real.
export async function authorizeGameViewer(gameId: string, userId: string): Promise<GameAccess | null> {
  const gameResult = await pool.query(`SELECT id, table_id FROM game WHERE id = $1`, [gameId]);
  const game = gameResult.rows[0];
  if (!game) return null;

  const seatType = await loadActiveSeat(game.table_id, userId);
  if (!seatType) return null;

  return { gameId: game.id, tableId: game.table_id, seatType };
}

// Same rule for a display socket/token: it's scoped to exactly the table it
// was minted for (see services/displayToken.ts), never any other table's
// games, no matter what gameId the client asks for.
export async function authorizeDisplayGame(displayTableId: string, gameId: string): Promise<boolean> {
  const gameResult = await pool.query(`SELECT table_id FROM game WHERE id = $1`, [gameId]);
  return gameResult.rows[0]?.table_id === displayTableId;
}

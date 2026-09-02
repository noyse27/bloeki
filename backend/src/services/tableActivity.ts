import { pool } from '../db/pool';

// A table untouched for this long gets hard-deleted "for performance
// reasons" (see tableCleanup.ts) - not a penalty, so it bypasses the
// normal leave path entirely (no early-leave karma malus, no games_played
// credit). The 1-minute gap before that gives the table room's UI room to
// show a dismissible warning (see TableRoomPage.tsx) whose "Ich bin noch
// da" button just calls touchTableActivity again to reset the clock.
export const INACTIVITY_WARNING_MS = 59 * 60 * 1000;
export const INACTIVITY_DELETE_MS = 60 * 60 * 1000;
// A shorter, non-destructive threshold purely for the admin table list's
// "inactive" pill (routes/admin.ts) - flags a stale table well before it's
// actually at risk of deletion.
export const ADMIN_INACTIVE_MS = 30 * 60 * 1000;

export async function touchTableActivity(tableId: string): Promise<void> {
  await pool.query(`UPDATE game_table SET last_activity_at = NOW() WHERE id = $1`, [tableId]);
}

export async function touchTableActivityForGame(gameId: string): Promise<void> {
  await pool.query(
    `UPDATE game_table SET last_activity_at = NOW() WHERE id = (SELECT table_id FROM game WHERE id = $1)`,
    [gameId],
  );
}

import { pool } from '../db/pool';
import { broadcastLobby, broadcastTable } from '../realtime/broadcast';

// A finished table auto-closes 60s after the match ends unless someone
// rematches first - see restartTable() below and LiveGameBoard.tsx's
// matching client-side countdown (both are driven off the same
// game_table.match_ended_at timestamp, so they land in sync without the
// client needing to poll this timer directly).
// Overridable for fast, deterministic tests - same pattern as
// tables.ts's REJOIN_GRACE_MS.
export const AUTO_CLOSE_MS = Number(process.env.MATCH_AUTO_CLOSE_MS ?? 60_000);

// In-memory, single-process scheduling - same reasoning as
// roundReadyWindow.ts/roundEngine.ts's other raw setTimeout usage.
const pendingTimeouts = new Map<string, NodeJS.Timeout>();

export function scheduleAutoClose(tableId: string): void {
  clearScheduledAutoClose(tableId);
  const timer = setTimeout(() => {
    pendingTimeouts.delete(tableId);
    autoCloseIfStillFinished(tableId).catch((err) => {
      console.error('failed to auto-close finished table', err);
    });
  }, AUTO_CLOSE_MS);
  pendingTimeouts.set(tableId, timer);
}

export function clearScheduledAutoClose(tableId: string): void {
  const timer = pendingTimeouts.get(tableId);
  if (timer) {
    clearTimeout(timer);
    pendingTimeouts.delete(tableId);
  }
}

async function autoCloseIfStillFinished(tableId: string): Promise<void> {
  const result = await pool.query(`SELECT state FROM game_table WHERE id = $1`, [tableId]);
  // Already restarted (state back to 'open') or the table is otherwise
  // gone - nothing to clean up.
  if (result.rowCount === 0 || result.rows[0].state !== 'finished') return;

  await pool.query(`UPDATE table_seat SET left_at = NOW() WHERE table_id = $1 AND left_at IS NULL`, [tableId]);
  await Promise.all([broadcastLobby(), broadcastTable(tableId)]);
}

export type RestartOutcome =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

// Lets any still-seated player send the table back to 'open' for a
// rematch, reusing the normal ready-up/start flow rather than
// auto-starting immediately - keeps this one code path for "how a game
// begins" instead of a second, parallel one.
export async function restartTable(tableId: string, requesterId: string): Promise<RestartOutcome> {
  const tableResult = await pool.query(`SELECT state FROM game_table WHERE id = $1`, [tableId]);
  if (tableResult.rowCount === 0) {
    return { ok: false, status: 404, code: 'TABLE_NOT_FOUND', message: 'table not found' };
  }
  if (tableResult.rows[0].state !== 'finished') {
    return { ok: false, status: 409, code: 'TABLE_NOT_FINISHED', message: 'table is not in a finished state' };
  }

  const seatResult = await pool.query(
    `SELECT id FROM table_seat WHERE table_id = $1 AND user_id = $2 AND seat_type = 'player' AND left_at IS NULL LIMIT 1`,
    [tableId, requesterId],
  );
  if (seatResult.rowCount === 0) {
    return { ok: false, status: 403, code: 'NOT_SEATED', message: 'not seated as a player at this table' };
  }

  clearScheduledAutoClose(tableId);
  await pool.query(`UPDATE game_table SET state = 'open', match_ended_at = NULL WHERE id = $1`, [tableId]);
  await pool.query(`UPDATE table_seat SET ready = FALSE WHERE table_id = $1 AND left_at IS NULL`, [tableId]);
  await Promise.all([broadcastLobby(), broadcastTable(tableId)]);
  return { ok: true };
}

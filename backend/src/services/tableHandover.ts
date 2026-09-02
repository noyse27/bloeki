import { PoolClient } from 'pg';
import { pool } from '../db/pool';

// FR-016: leaves a 60s reconnect window for the table owner before the
// longest-present active player automatically takes over.
export const OWNER_RECONNECT_WINDOW_SECONDS = 60;

/**
 * Lazily evaluates whether a table's owner-reconnect window has expired and,
 * if so, transfers ownership to the longest-present active player. Called
 * at the start of join/leave/start/detail requests instead of relying on a
 * background timer, which keeps the rule deterministic and trivially
 * testable (tests move owner_left_at into the past instead of sleeping).
 */
export async function evaluateOwnerHandover(
  tableId: string,
  client: PoolClient | typeof pool = pool,
): Promise<{ handedOver: boolean; newOwnerUserId?: string }> {
  const tableResult = await client.query(
    `SELECT owner_user_id, owner_left_at FROM game_table WHERE id = $1 FOR UPDATE`,
    [tableId],
  );
  if (tableResult.rowCount === 0) {
    return { handedOver: false };
  }

  const table = tableResult.rows[0];
  if (!table.owner_left_at) {
    return { handedOver: false };
  }

  const elapsedSeconds = (Date.now() - new Date(table.owner_left_at).getTime()) / 1000;
  if (elapsedSeconds < OWNER_RECONNECT_WINDOW_SECONDS) {
    return { handedOver: false };
  }

  const candidateResult = await client.query(
    `SELECT user_id FROM table_seat
     WHERE table_id = $1 AND seat_type = 'player' AND left_at IS NULL AND user_id != $2
     ORDER BY joined_at ASC
     LIMIT 1`,
    [tableId, table.owner_user_id],
  );

  if (candidateResult.rowCount === 0) {
    // No one to hand over to yet; leave the window open until a player is present.
    return { handedOver: false };
  }

  const newOwnerUserId = candidateResult.rows[0].user_id;
  await client.query(
    `UPDATE game_table SET owner_user_id = $1, owner_left_at = NULL WHERE id = $2`,
    [newOwnerUserId, tableId],
  );

  return { handedOver: true, newOwnerUserId };
}

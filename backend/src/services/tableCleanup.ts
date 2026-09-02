import { pool } from '../db/pool';
import { INACTIVITY_DELETE_MS } from './tableActivity';
import { broadcastLobby } from '../realtime/broadcast';

export interface TableCleanupResult {
  deletedTableIds: string[];
}

// Runs periodically (see scheduler.ts) to hard-delete any table nobody has
// interacted with in INACTIVITY_DELETE_MS - "for performance reasons", not
// a penalty: the FKs cascading off game_table (see the
// table-inactivity-cleanup migration) take every dependent row with it in
// one statement, except karma_ledger/score_ledger which just lose their
// game_id (their points were already applied to app_user, so the audit
// row itself must survive). Deliberately never touches
// applyEarlyLeavePenalty or games_played - those are for someone leaving
// an active match, not for a table nobody came back to.
export async function deleteInactiveTables(): Promise<TableCleanupResult> {
  const deletedResult = await pool.query(
    `DELETE FROM game_table
     WHERE last_activity_at <= NOW() - ($1 || ' milliseconds')::interval
     RETURNING id`,
    [INACTIVITY_DELETE_MS],
  );
  const deletedTableIds: string[] = deletedResult.rows.map((row) => row.id);
  if (deletedTableIds.length > 0) {
    await broadcastLobby();
  }
  return { deletedTableIds };
}

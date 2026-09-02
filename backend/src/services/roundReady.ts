import { pool } from '../db/pool';
import { RoundEngineError } from './errors';
import { startRoundAuto } from './roundEngine';
import { broadcastGame } from '../realtime/broadcast';
import { AUTO_READY_GRACE_MS } from './roundConfig';
import {
  clearScheduledTimeout,
  registerExpiryHandler,
  registerOpenHandler,
  startReadyWindow,
} from './roundReadyWindow';

const ACTIVE_ROUND_STATUSES = ['countdown', 'playing', 'guessing'];

// scheduleAutoReadyStart/clearPendingAutoReadyStart below: a manual ready
// click can still complete the group and start the round immediately (see
// checkAllReadyAndMaybeStart) even while an auto-ready grace timer from
// applyAutoReadyOnWindowOpen is still pending for the same window - without
// cancelling it here, that timer fires later regardless, re-running its own
// (harmless but wasted) DB round-trip against whatever's using that gameId
// by then.
const pendingAutoReadyStarts = new Map<string, NodeJS.Timeout>();

function clearPendingAutoReadyStart(gameId: string): void {
  const existing = pendingAutoReadyStarts.get(gameId);
  if (existing) {
    clearTimeout(existing);
    pendingAutoReadyStarts.delete(gameId);
  }
}

// The timer itself (and the "arm the window" logic shared with
// roundEngine.ts's automatic post-resolve trigger) lives in
// roundReadyWindow.ts to avoid a circular import - see that module's
// comment. This file owns what happens once the window actually expires,
// and what happens the instant a window newly opens (auto-ready).
registerExpiryHandler(resolveReadyTimeout);
registerOpenHandler(applyAutoReadyOnWindowOpen);

async function activePlayerIds(tableId: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT user_id FROM table_seat WHERE table_id = $1 AND seat_type = 'player' AND left_at IS NULL`,
    [tableId],
  );
  return result.rows.map((row) => row.user_id as string);
}

async function readyUserIds(gameId: string): Promise<Set<string>> {
  const result = await pool.query(`SELECT user_id FROM round_ready WHERE game_id = $1 AND ready = TRUE`, [
    gameId,
  ]);
  return new Set(result.rows.map((row) => row.user_id as string));
}

async function markReady(gameId: string, userId: string, ready: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO round_ready (game_id, user_id, ready, updated_at) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (game_id, user_id) DO UPDATE SET ready = EXCLUDED.ready, updated_at = NOW()`,
    [gameId, userId, ready],
  );
}

// Shared by every path that can make "everyone's ready" become true
// (a manual ready click, a window newly opening with auto-ready players
// already locked in, or someone locking in auto-ready mid-window): starts
// the round if so, and reports back whether it did so the caller knows
// whether it still owes a plain broadcastGame() itself.
async function checkAllReadyAndMaybeStart(gameId: string, tableId: string): Promise<boolean> {
  const activeIds = await activePlayerIds(tableId);
  const readyIds = await readyUserIds(gameId);
  const allReady = activeIds.length > 0 && activeIds.every((id) => readyIds.has(id));

  if (allReady) {
    clearScheduledTimeout(gameId);
    clearPendingAutoReadyStart(gameId);
    await clearReadyState(gameId);
    await startRoundAuto(gameId, []);
  }
  return allReady;
}

export async function setRoundReady(gameId: string, userId: string, ready: boolean): Promise<void> {
  const gameResult = await pool.query(`SELECT id, table_id, status FROM game WHERE id = $1`, [gameId]);
  if (gameResult.rowCount === 0) {
    throw new RoundEngineError('GAME_NOT_FOUND', 'game not found');
  }
  const game = gameResult.rows[0];
  if (game.status !== 'active') {
    throw new RoundEngineError('GAME_NOT_ACTIVE', 'game is not active');
  }

  const seatResult = await pool.query(
    `SELECT 1 FROM table_seat WHERE table_id = $1 AND user_id = $2 AND seat_type = 'player' AND left_at IS NULL`,
    [game.table_id, userId],
  );
  if (seatResult.rowCount === 0) {
    throw new RoundEngineError('FORBIDDEN', 'not an active player at this table');
  }

  const activeRoundResult = await pool.query(
    `SELECT id FROM round WHERE game_id = $1 AND status = ANY($2::text[]) LIMIT 1`,
    [gameId, ACTIVE_ROUND_STATUSES],
  );
  if ((activeRoundResult.rowCount ?? 0) > 0) {
    throw new RoundEngineError('ROUND_ALREADY_ACTIVE', 'a round is already in progress');
  }

  await markReady(gameId, userId, ready);

  if (ready) {
    await startReadyWindow(gameId);
  }

  const started = await checkAllReadyAndMaybeStart(gameId, game.table_id);
  if (!started) {
    await broadcastGame(gameId);
  }
}

// Self-service "auto bereit" lock (see 1757404800000_round-ready-auto.js):
// bound to this game only, so it resets to off on its own for the next
// match (fresh game_id, see tableRestart.ts). Turning it on while a
// round-ready window happens to be open right now also marks the player
// ready for *that* window immediately - see LiveGameBoard's avatar
// double-click, which is the only entry point for this and is meant to
// read as one confident "I'm ready, and I'll stay ready" action rather
// than two separate steps.
export async function setAutoReady(gameId: string, userId: string, autoReady: boolean): Promise<void> {
  const gameResult = await pool.query(
    `SELECT id, table_id, status, round_ready_started_at FROM game WHERE id = $1`,
    [gameId],
  );
  if (gameResult.rowCount === 0) {
    throw new RoundEngineError('GAME_NOT_FOUND', 'game not found');
  }
  const game = gameResult.rows[0];
  if (game.status !== 'active') {
    throw new RoundEngineError('GAME_NOT_ACTIVE', 'game is not active');
  }

  const seatResult = await pool.query(
    `SELECT 1 FROM table_seat WHERE table_id = $1 AND user_id = $2 AND seat_type = 'player' AND left_at IS NULL`,
    [game.table_id, userId],
  );
  if (seatResult.rowCount === 0) {
    throw new RoundEngineError('FORBIDDEN', 'not an active player at this table');
  }

  await pool.query(
    `INSERT INTO round_ready_pref (game_id, user_id, auto_ready, updated_at) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (game_id, user_id) DO UPDATE SET auto_ready = EXCLUDED.auto_ready, updated_at = NOW()`,
    [gameId, userId, autoReady],
  );

  if (autoReady && game.round_ready_started_at) {
    await markReady(gameId, userId, true);
    const started = await checkAllReadyAndMaybeStart(gameId, game.table_id);
    if (!started) {
      await broadcastGame(gameId);
    }
    return;
  }

  await broadcastGame(gameId);
}

// Registered as roundReadyWindow.ts's open-handler: fires the instant a
// window newly arms (including the automatic re-arm right after a round
// resolves). Locks in anyone with auto-ready set - so their ready-check
// shows immediately, same as a manual click - but the round is only
// allowed to actually *start* off the back of that once AUTO_READY_GRACE_MS
// has passed (see scheduleAutoReadyStart below): auto-ready automates the
// ready click only, never the reveal/announcement the window just opened
// on top of. A manual ready click from a non-auto player can still complete
// the group and start the round earlier, same as before - only the
// auto-ready path itself is held back.
async function applyAutoReadyOnWindowOpen(gameId: string): Promise<void> {
  const gameResult = await pool.query(`SELECT table_id, status FROM game WHERE id = $1`, [gameId]);
  if (gameResult.rowCount === 0 || gameResult.rows[0].status !== 'active') return;
  const tableId = gameResult.rows[0].table_id;

  const activeIds = await activePlayerIds(tableId);
  if (activeIds.length === 0) return;

  const prefResult = await pool.query(
    `SELECT user_id FROM round_ready_pref WHERE game_id = $1 AND auto_ready = TRUE AND user_id = ANY($2::uuid[])`,
    [gameId, activeIds],
  );
  if (prefResult.rowCount === 0) return;

  for (const row of prefResult.rows) {
    await markReady(gameId, row.user_id as string, true);
  }

  scheduleAutoReadyStart(gameId, tableId);
}

function scheduleAutoReadyStart(gameId: string, tableId: string): void {
  clearPendingAutoReadyStart(gameId);
  const timer = setTimeout(() => {
    pendingAutoReadyStarts.delete(gameId);
    checkAllReadyAndMaybeStart(gameId, tableId)
      .then((started) => (started ? undefined : broadcastGame(gameId)))
      .catch((err) => {
        console.error('failed to auto-start round after auto-ready grace period', err);
      });
  }, AUTO_READY_GRACE_MS);
  pendingAutoReadyStarts.set(gameId, timer);
}

async function clearReadyState(gameId: string): Promise<void> {
  await pool.query(`DELETE FROM round_ready WHERE game_id = $1`, [gameId]);
  await pool.query(`UPDATE game SET round_ready_started_at = NULL WHERE id = $1`, [gameId]);
}

async function resolveReadyTimeout(gameId: string): Promise<void> {
  const gameResult = await pool.query(
    `SELECT table_id, status, round_ready_started_at FROM game WHERE id = $1`,
    [gameId],
  );
  if (gameResult.rowCount === 0) return;
  const game = gameResult.rows[0];
  // Already started (or the game ended) via some other path in the
  // meantime - nothing to do.
  if (game.status !== 'active' || !game.round_ready_started_at) return;

  const activeIds = await activePlayerIds(game.table_id);
  const readyIds = await readyUserIds(gameId);
  const sitOutUserIds = activeIds.filter((id) => !readyIds.has(id));

  await clearReadyState(gameId);

  if (sitOutUserIds.length >= activeIds.length) {
    // Nobody readied up at all - don't start a round with no participants;
    // just reset and wait for someone to ready up again.
    await broadcastGame(gameId);
    return;
  }

  await startRoundAuto(gameId, sitOutUserIds);
}

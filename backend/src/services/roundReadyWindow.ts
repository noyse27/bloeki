import { pool } from '../db/pool';
import { broadcastGame } from '../realtime/broadcast';
import { ROUND_READY_WINDOW_MS } from './roundConfig';

// Owns the round-ready 30s timer + "arm the window" logic as a module with
// no dependency on roundEngine.ts or roundReady.ts, so that roundEngine.ts
// (which needs to arm the window right after every round resolves) and
// roundReady.ts (which owns what happens once the window expires) can both
// depend on this without creating a circular import between the two -
// same reasoning as roundConfig.ts's constant extraction.
const pendingTimeouts = new Map<string, NodeJS.Timeout>();
let onExpire: ((gameId: string) => Promise<void>) | null = null;
let onOpen: ((gameId: string) => Promise<void>) | null = null;

/** roundReady.ts registers its own expiry handler once at module load. */
export function registerExpiryHandler(handler: (gameId: string) => Promise<void>): void {
  onExpire = handler;
}

// roundReady.ts also registers this once, to auto-ready any player with
// "auto bereit" locked in (round_ready_pref) the instant a window newly
// arms - notably including the automatic re-arm right after a round
// resolves, so a fully auto-ready table never sits idle waiting on clicks
// nobody needs to make.
export function registerOpenHandler(handler: (gameId: string) => Promise<void>): void {
  onOpen = handler;
}

export function scheduleTimeout(gameId: string): void {
  clearScheduledTimeout(gameId);
  const timer = setTimeout(() => {
    pendingTimeouts.delete(gameId);
    onExpire?.(gameId).catch((err) => {
      console.error('failed to resolve round-ready timeout', err);
    });
  }, ROUND_READY_WINDOW_MS);
  pendingTimeouts.set(gameId, timer);
}

export function clearScheduledTimeout(gameId: string): void {
  const timer = pendingTimeouts.get(gameId);
  if (timer) {
    clearTimeout(timer);
    pendingTimeouts.delete(gameId);
  }
}

// Starts the round-ready window if the game is still active and one isn't
// already running. Used both by the self-service ready-up route (the first
// player to ready up between rounds arms it) and, automatically, right
// after every round resolves from round 2 onward - see roundEngine.ts's
// resolve* functions - so play keeps moving without everyone having to
// re-click ready after each reveal.
export async function startReadyWindow(gameId: string): Promise<void> {
  const gameResult = await pool.query(`SELECT status, round_ready_started_at FROM game WHERE id = $1`, [gameId]);
  if (gameResult.rowCount === 0) return;
  const game = gameResult.rows[0];
  if (game.status !== 'active' || game.round_ready_started_at) return;

  await pool.query(`UPDATE game SET round_ready_started_at = NOW() WHERE id = $1`, [gameId]);
  scheduleTimeout(gameId);
  await onOpen?.(gameId);
  await broadcastGame(gameId);
}

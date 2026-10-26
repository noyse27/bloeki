import cron from 'node-cron';
import { pool } from '../db/pool';
import { deleteInactiveTables } from './tableCleanup';
import { deleteExpiredChatMessages } from './communication';
import { startTrailerScanSchedule } from './trailerScan';
import { deleteExpiredDebugCaptures } from './debugLogging';

// Every minute: cheap enough at this scale (a private-group game, not
// thousands of concurrent tables) and keeps a table from lingering for up
// to a day if it goes stale - see tableCleanup.ts for why this is a hard
// delete rather than the normal leave-table path.
export function startTableCleanupSchedule(): void {
  cron.schedule('* * * * *', () => {
    deleteInactiveTables().catch((err) => {
      console.error('[table-cleanup] failed', err);
    });
  });
}

// Chat is intentionally ephemeral. Removing expired rows every five minutes
// keeps the database aligned with the 30-minute history visible to users.
export function startChatCleanupSchedule(): void {
  cron.schedule('*/5 * * * *', () => {
    deleteExpiredChatMessages().catch((err) => {
      console.error('[chat-cleanup] failed', err);
    });
  });
}

export function startTrailerPlaylistCleanupSchedule(): void {
  cron.schedule('17 * * * *', () => {
    pool.query(`DELETE FROM game_trailer_playlist WHERE expires_at <= NOW()`).catch((err) => {
      console.error('[trailer-playlist-cleanup] failed', err);
    });
  });
}

export function startDebugCaptureCleanupSchedule(): void {
  cron.schedule('37 * * * *', () => {
    deleteExpiredDebugCaptures().catch((err) => {
      console.error('[debug-capture-cleanup] failed', err);
    });
  });
}

// Trailer-Bibliotheks-Scan (services/trailerScan.ts): re-exportiert hier nur
// fuer eine einheitliche Schedule-Registrierung von index.ts aus, die
// eigentliche Logik (inkl. eigenem node-cron-Job) lebt im Service selbst.
export { startTrailerScanSchedule };

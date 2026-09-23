import argon2 from 'argon2';
import { pool } from '../db/pool';
import {
  DEMO_ADMIN_EMAIL,
  DEMO_ADMIN_PASSWORD,
  DEMO_ADMIN_USERNAME,
  DEMO_INVITE_CODE,
  DEMO_RESET_MINUTES,
} from '../config/demoMode';

// Marks a database as "this is a demo instance I'm allowed to manage" -
// written by the first successful reset/seed and checked on every startup
// (see assertDemoSafeToManage). Without this, turning DEMO_MODE=true on
// against an already-populated database (a copy-pasted production
// DATABASE_URL, a mistaken env file) would otherwise silently start
// periodically wiping real user data.
const DEMO_MARKER_KEY = 'demo_managed';
const DEMO_MARKER_VALUE = '1';

// Every table that holds user-generated activity (accounts, tables, games,
// chat, host-device pairings, debug logs) - reset on each demo cycle so a
// public demo never accumulates real registrations or gameplay history.
// Deliberately NOT included: trailer_ref (repopulated from the mounted demo
// clip directory by the regular trailer-scan cron, see trailerScan.ts) and
// playboard_reaction (static reference data seeded once by the schema
// migration, unrelated to user activity). system_setting is reset
// separately below (only the counters that reflect activity, not the demo
// marker itself).
const VOLATILE_TABLES = [
  'game_event_log',
  'client_debug_event',
  'host_device',
  'chat_message',
  'round_ready_pref',
  'round_sitout',
  'round_ready',
  'karma_ledger',
  'score_ledger',
  'timeline_card',
  'guess',
  'session_trailer_history',
  'round',
  'game',
  'table_session_trailer_pool',
  'table_session',
  'table_seat',
  'game_table',
  // invite_token and app_user reference each other (app_user.registered_via_invite_id
  // -> invite_token, invite_token.created_by -> app_user), so both must be
  // truncated together in the same statement for Postgres to accept the
  // circular foreign keys.
  'invite_token',
  'app_user',
].join(', ');

export interface DemoStatus {
  active: boolean;
  resetIntervalMinutes: number;
  lastResetAt: string | null;
  nextResetAt: string | null;
  standingInviteCode: string;
  adminUsername: string;
  adminPassword: string;
}

let lastResetAt: Date | null = null;

/** Wipes all demo activity and reseeds a fixed admin account, a standing
 * invite code, and a couple of demo players with some score/karma so the
 * leaderboard isn't empty on a fresh reset. Also (re-)writes the
 * demo-managed marker. */
export async function resetDemoData(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`TRUNCATE TABLE ${VOLATILE_TABLES} RESTART IDENTITY CASCADE`);
    await client.query(`UPDATE system_setting SET value = '0', updated_at = NOW() WHERE key = 'total_games_finished'`);

    const adminPasswordHash = await argon2.hash(DEMO_ADMIN_PASSWORD);
    const adminResult = await client.query(
      `INSERT INTO app_user (username, email, password_hash, role, status, can_create_invites)
       VALUES ($1, $2, $3, 'admin', 'active', TRUE)
       RETURNING id`,
      [DEMO_ADMIN_USERNAME, DEMO_ADMIN_EMAIL, adminPasswordHash],
    );
    const adminId = adminResult.rows[0].id as string;

    await client.query(
      `INSERT INTO invite_token (code, created_by, max_uses, expires_at)
       VALUES ($1, $2, 1000000, NULL)`,
      [DEMO_INVITE_CODE, adminId],
    );

    const demoPlayers: Array<{ username: string; email: string; karma: number; score: number; games: number }> = [
      { username: 'demo-anna', email: 'demo-anna@example.invalid', karma: 12, score: 340, games: 6 },
      { username: 'demo-ben', email: 'demo-ben@example.invalid', karma: 4, score: 210, games: 4 },
    ];
    const demoPassword = await argon2.hash(DEMO_ADMIN_PASSWORD);
    const demoPlayerIds: Record<string, string> = {};
    for (const player of demoPlayers) {
      const playerResult = await client.query(
        `INSERT INTO app_user (username, email, password_hash, role, status, karma_points, score_points, games_played)
         VALUES ($1, $2, $3, 'user', 'active', $4, $5, $6)
         RETURNING id`,
        [player.username, player.email, demoPassword, player.karma, player.score, player.games],
      );
      demoPlayerIds[player.username] = playerResult.rows[0].id as string;
    }

    // A table a visitor can join and start playing right away, rather than
    // landing on an empty lobby: owned and already seated by demo-anna, who
    // is also marked ready at the table (table_seat.ready) - the same gate
    // tableStart.ts's automatic start-on-everyone-ready checks. A second
    // player joining and readying up therefore starts a game immediately,
    // no extra clicks needed on either side. demo-anna herself is a seeded
    // row nobody is logged into, so round_ready_pref's per-game "Auto
    // bereit" toggle (see roundReady.ts) can't be pre-set the same way -
    // it only exists once a game row does - but that only affects whether
    // she auto-readies for a *second* round; the first round always starts
    // cleanly. docs/demo.md documents logging in as demo-anna in a second
    // tab to keep a longer test session going.
    const demoTableResult = await client.query(
      `INSERT INTO game_table (owner_user_id, name, visibility, allow_spectators, max_players)
       VALUES ($1, 'Demo-Tisch', 'public', TRUE, 5)
       RETURNING id`,
      [demoPlayerIds['demo-anna']],
    );
    await client.query(
      `INSERT INTO table_seat (table_id, user_id, seat_type, ready)
       VALUES ($1, $2, 'player', TRUE)`,
      [demoTableResult.rows[0].id, demoPlayerIds['demo-anna']],
    );

    await client.query(
      `INSERT INTO system_setting (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [DEMO_MARKER_KEY, DEMO_MARKER_VALUE],
    );

    await client.query('COMMIT');
    lastResetAt = new Date();
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Refuses to let demo mode manage a database that isn't already
 * demo-managed and isn't empty - the only two states in which periodically
 * TRUNCATEing app_user etc. is safe. Call once at startup before scheduling
 * periodic resets. */
export async function assertDemoSafeToManage(): Promise<void> {
  const markerResult = await pool.query(`SELECT value FROM system_setting WHERE key = $1`, [DEMO_MARKER_KEY]);
  if ((markerResult.rowCount ?? 0) > 0) {
    return;
  }

  const userCountResult = await pool.query(`SELECT COUNT(*)::int AS count FROM app_user`);
  const userCount = userCountResult.rows[0].count as number;
  if (userCount === 0) {
    await resetDemoData();
    return;
  }

  throw new Error(
    `DEMO_MODE is enabled but this database already has ${userCount} user account(s) and no demo marker - ` +
      "refusing to start, since periodic demo resets would otherwise wipe real data. DEMO_MODE must only be " +
      'used against a fresh, isolated database (see docker-compose.demo.yml / docs/demo.md), never against ' +
      'an existing production database.',
  );
}

export function startDemoResetSchedule(): void {
  const intervalMs = DEMO_RESET_MINUTES * 60 * 1000;
  setInterval(() => {
    resetDemoData().catch((err) => {
      console.error('[demo-reset] failed', err);
    });
  }, intervalMs);
  console.log(`[demo-reset] scheduled every ${DEMO_RESET_MINUTES} minute(s)`);
}

export function getDemoStatus(): DemoStatus {
  const nextResetAt = lastResetAt
    ? new Date(lastResetAt.getTime() + DEMO_RESET_MINUTES * 60 * 1000)
    : null;
  return {
    active: true,
    resetIntervalMinutes: DEMO_RESET_MINUTES,
    lastResetAt: lastResetAt ? lastResetAt.toISOString() : null,
    nextResetAt: nextResetAt ? nextResetAt.toISOString() : null,
    standingInviteCode: DEMO_INVITE_CODE,
    adminUsername: DEMO_ADMIN_USERNAME,
    // Not a secret on a demo deployment - see config/demoMode.ts's own
    // comment on DEMO_ADMIN_PASSWORD. Exposed here (rather than hardcoded
    // in the frontend) so DemoBanner.tsx stays correct even when an
    // operator overrides it via env.
    adminPassword: DEMO_ADMIN_PASSWORD,
  };
}

/** Test-only: lets tests observe/reset the module-level lastResetAt state
 * without waiting on the real interval timer. */
export function _setLastResetAtForTests(date: Date | null): void {
  lastResetAt = date;
}

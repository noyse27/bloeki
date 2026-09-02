/* eslint-disable @typescript-eslint/no-var-requires */
const { Pool } = require('pg');

// H-06: this unconditionally wipes every core table. DATABASE_URL is
// operator-supplied (README/.env), so a typo or a copy-pasted staging URL
// would otherwise empty a real database the moment `npm run
// test:integration` runs. Only proceed against a host that's clearly a
// local/CI throwaway instance, or when the operator has explicitly opted
// in via ALLOW_DESTRUCTIVE_TEST_DB=true.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', 'db', 'postgres']);

function assertSafeToTruncate(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('globalSetup: DATABASE_URL is not a valid connection string, refusing to run TRUNCATE.');
  }

  const host = url.hostname;
  const database = url.pathname.replace(/^\//, '');
  console.log(`globalSetup: integration tests will TRUNCATE database "${database}" on host "${host}"`);

  if (process.env.ALLOW_DESTRUCTIVE_TEST_DB === 'true') return;
  if (LOCAL_HOSTS.has(host)) return;

  throw new Error(
    `globalSetup: refusing to TRUNCATE database "${database}" on host "${host}" - it doesn't look like ` +
      'a local/CI throwaway instance. Point DATABASE_URL at a disposable database (host localhost/127.0.0.1' +
      '/db/postgres), or set ALLOW_DESTRUCTIVE_TEST_DB=true if you are certain this target is safe to wipe.',
  );
}

// Runs once before the whole integration suite so every test file starts
// from a known-empty state (e.g. the admin-bootstrap tests rely on "no
// admin exists yet").
module.exports = async () => {
  assertSafeToTruncate(process.env.DATABASE_URL);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(`
    TRUNCATE TABLE
      chat_message, playboard_reaction, client_debug_event, game_event_log,
      host_device,
      score_ledger, karma_ledger, timeline_card, guess,
      round_ready, round_ready_pref, round_sitout,
      session_trailer_history, round, game, table_session_trailer_pool,
      trailer_ref, table_session,
      table_seat, game_table, invite_token, app_user, system_setting
    RESTART IDENTITY CASCADE;
  `);

  // playboard_reaction isn't seeded by any migration re-run (it's a one-time
  // INSERT in the initial schema migration, see migrations/1788307200000_*),
  // so TRUNCATEing it above leaves it empty for the whole suite unless we
  // restore the same defaults here - otherwise every reaction (see
  // realtime/socketServer.ts's 'game:reaction' handler, which looks up
  // playboard_reaction by phase+asset_id) is rejected as "not available in
  // this phase".
  await pool.query(`
    INSERT INTO playboard_reaction (phase, asset_id, label, sort_order) VALUES
      ('waiting', 'hello', 'Hallo', 0), ('waiting', 'like', 'Stark', 1),
      ('waiting', 'laugh', 'Lustig', 2), ('waiting', 'target', 'Guter Tipp', 3),
      ('waiting', 'technical', 'Technikproblem', 4),
      ('countdown', 'like', 'Stark', 0), ('countdown', 'think', 'Keine Ahnung', 1),
      ('countdown', 'technical', 'Technikproblem', 2),
      ('playing', 'like', 'Stark', 0), ('playing', 'think', 'Keine Ahnung', 1),
      ('playing', 'technical', 'Technikproblem', 2),
      ('guessing', 'like', 'Stark', 0), ('guessing', 'think', 'Keine Ahnung', 1),
      ('guessing', 'technical', 'Technikproblem', 2),
      ('resolved', 'like', 'Stark', 0), ('resolved', 'laugh', 'Lustig', 1),
      ('resolved', 'target', 'Guter Tipp', 2), ('resolved', 'technical', 'Technikproblem', 3),
      ('finished', 'like', 'Stark', 0), ('finished', 'laugh', 'Lustig', 1),
      ('finished', 'target', 'Guter Tipp', 2), ('finished', 'technical', 'Technikproblem', 3);
  `);

  await pool.end();
};

import { pool } from '../../src/db/pool';
import { assertDemoSafeToManage, resetDemoData } from '../../src/services/demoReset';
import { DEMO_ADMIN_USERNAME, DEMO_INVITE_CODE } from '../../src/config/demoMode';

describe('demo reset', () => {
  beforeAll(async () => {
    // Runs order-independent of other integration test files, same
    // reasoning as setup.test.ts: force a clean slate before asserting
    // anything about row counts.
    await pool.query(
      `TRUNCATE TABLE game_table, trailer_ref, invite_token, app_user, system_setting RESTART IDENTITY CASCADE`,
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('seeds a fresh (empty) database with a demo admin and standing invite', async () => {
    await assertDemoSafeToManage();

    const users = await pool.query(`SELECT username, role FROM app_user ORDER BY username`);
    expect(users.rows.map((r) => r.username)).toContain(DEMO_ADMIN_USERNAME);
    expect(users.rows.find((r) => r.username === DEMO_ADMIN_USERNAME).role).toBe('admin');

    const invite = await pool.query(`SELECT max_uses, expires_at FROM invite_token WHERE code = $1`, [
      DEMO_INVITE_CODE,
    ]);
    expect(invite.rowCount).toBe(1);
    expect(invite.rows[0].expires_at).toBeNull();

    const marker = await pool.query(`SELECT value FROM system_setting WHERE key = 'demo_managed'`);
    expect(marker.rows[0].value).toBe('1');
  });

  it('seeds an open, already-ready demo table so a visitor can start playing right away', async () => {
    const table = await pool.query(
      `SELECT gt.id, gt.state, u.username AS owner_username
       FROM game_table gt JOIN app_user u ON u.id = gt.owner_user_id
       WHERE u.username = 'demo-anna'`,
    );
    expect(table.rowCount).toBe(1);
    expect(table.rows[0].state).toBe('open');

    const seat = await pool.query(
      `SELECT seat_type, ready FROM table_seat WHERE table_id = $1 AND user_id = (
         SELECT id FROM app_user WHERE username = 'demo-anna'
       )`,
      [table.rows[0].id],
    );
    expect(seat.rowCount).toBe(1);
    expect(seat.rows[0].seat_type).toBe('player');
    expect(seat.rows[0].ready).toBe(true);
  });

  it('does nothing on a second call once the demo marker is present', async () => {
    const before = await pool.query(`SELECT COUNT(*)::int AS count FROM app_user`);

    await assertDemoSafeToManage();

    const after = await pool.query(`SELECT COUNT(*)::int AS count FROM app_user`);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it('refuses to manage a database that has real users and no demo marker', async () => {
    await pool.query(`TRUNCATE TABLE game_table, invite_token, app_user, system_setting RESTART IDENTITY CASCADE`);
    await pool.query(
      `INSERT INTO app_user (username, email, password_hash) VALUES ('real-user', 'real-user@example.test', 'x')`,
    );

    await expect(assertDemoSafeToManage()).rejects.toThrow(/refusing to start/);
  });

  it('wipes game activity on reset but preserves the trailer library', async () => {
    await pool.query(`TRUNCATE TABLE game_table, trailer_ref, invite_token, app_user, system_setting RESTART IDENTITY CASCADE`);
    await resetDemoData();

    await pool.query(
      `INSERT INTO trailer_ref (imdb_id, title, year_value, clip_path) VALUES ('tt0900099', 'Demo Clip', 2001, '/data/clips/demo.mp4')`,
    );
    const adminRow = await pool.query(`SELECT id FROM app_user WHERE username = $1`, [DEMO_ADMIN_USERNAME]);
    await pool.query(
      `INSERT INTO game_table (owner_user_id, name, visibility) VALUES ($1, 'Some table', 'public')`,
      [adminRow.rows[0].id],
    );

    await resetDemoData();

    // Exactly one table survives the reset: the freshly-seeded demo table
    // itself (see the earlier "seeds an open, already-ready demo table"
    // test) - the manually-inserted "Some table" above is gone.
    const tables = await pool.query(`SELECT name FROM game_table`);
    expect(tables.rowCount).toBe(1);
    expect(tables.rows[0].name).toBe('Demo-Tisch');

    const trailers = await pool.query(`SELECT COUNT(*)::int AS count FROM trailer_ref WHERE imdb_id = 'tt0900099'`);
    expect(trailers.rows[0].count).toBe(1);

    const admins = await pool.query(`SELECT COUNT(*)::int AS count FROM app_user WHERE username = $1`, [
      DEMO_ADMIN_USERNAME,
    ]);
    expect(admins.rows[0].count).toBe(1);
  });
});

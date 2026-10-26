import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db/pool';
import { deleteExpiredDebugCaptures, storeGameEvent } from '../../src/services/debugLogging';
import { authHeader, createUserDirect } from '../helpers/testUtils';

const app = createApp();

describe('admin debug captures', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('records a game, finds its table, exports JSON and retains it for seven days after disabling', async () => {
    const admin = await createUserDirect({ role: 'admin' });
    const table = await pool.query(
      `INSERT INTO game_table (owner_user_id, name, visibility, state)
       VALUES ($1, 'Diagnosetisch', 'private', 'running') RETURNING id`,
      [admin.id],
    );
    const session = await pool.query(`INSERT INTO table_session (table_id) VALUES ($1) RETURNING id`, [table.rows[0].id]);
    const game = await pool.query(
      `INSERT INTO game (table_id, table_session_id, status, started_at)
       VALUES ($1, $2, 'active', NOW()) RETURNING id`,
      [table.rows[0].id, session.rows[0].id],
    );

    const enabled = await request(app)
      .put('/api/v1/admin/debug/settings')
      .set(authHeader(admin.id, 'admin'))
      .send({ enabled: true });
    expect(enabled.status).toBe(200);
    expect(enabled.body.enabled).toBe(true);

    await storeGameEvent({
      eventType: 'test_trailer_event',
      tableId: table.rows[0].id,
      gameId: game.rows[0].id,
      roundIndex: 10,
      payload: { elapsedMs: 17000 },
    });

    const tables = await request(app)
      .get('/api/v1/admin/debug/tables?query=Diagnose')
      .set(authHeader(admin.id, 'admin'));
    expect(tables.status).toBe(200);
    expect(tables.body.tables).toEqual(expect.arrayContaining([
      expect.objectContaining({ tableId: table.rows[0].id, tableName: 'Diagnosetisch', gameCount: 1 }),
    ]));

    const games = await request(app)
      .get(`/api/v1/admin/debug/tables/${table.rows[0].id}/games`)
      .set(authHeader(admin.id, 'admin'));
    expect(games.status).toBe(200);
    expect(games.body.games[0]).toEqual(expect.objectContaining({
      gameId: game.rows[0].id,
      serverEventCount: 1,
    }));

    const exported = await request(app)
      .get(`/api/v1/admin/debug/captures/${enabled.body.captureId}/games/${game.rows[0].id}`)
      .set(authHeader(admin.id, 'admin'));
    expect(exported.status).toBe(200);
    expect(exported.headers['content-disposition']).toContain('attachment');
    expect(exported.body.serverEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: 'test_trailer_event', round_index: 10 }),
    ]));

    const disabled = await request(app)
      .put('/api/v1/admin/debug/settings')
      .set(authHeader(admin.id, 'admin'))
      .send({ enabled: false });
    expect(disabled.body.enabled).toBe(false);
    const capture = await pool.query(`SELECT disabled_at, expires_at FROM debug_capture WHERE id = $1`, [enabled.body.captureId]);
    expect(capture.rows[0].disabled_at).not.toBeNull();
    expect(new Date(capture.rows[0].expires_at).getTime() - new Date(capture.rows[0].disabled_at).getTime())
      .toBe(7 * 24 * 60 * 60 * 1000);

    await pool.query(`UPDATE debug_capture SET expires_at = NOW() - INTERVAL '1 second' WHERE id = $1`, [enabled.body.captureId]);
    await expect(deleteExpiredDebugCaptures()).resolves.toBe(1);
    const removed = await pool.query(`SELECT 1 FROM debug_game_archive WHERE capture_id = $1`, [enabled.body.captureId]);
    expect(removed.rowCount).toBe(0);
  });
});

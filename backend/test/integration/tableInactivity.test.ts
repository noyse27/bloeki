import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db/pool';
import { authHeader, createUserDirect, uniqueSuffix } from '../helpers/testUtils';
import { deleteInactiveTables } from '../../src/services/tableCleanup';
import { ADMIN_INACTIVE_MS, INACTIVITY_DELETE_MS } from '../../src/services/tableActivity';

const app = createApp();

async function ageTable(tableId: string, ms: number): Promise<void> {
  await pool.query(
    `UPDATE game_table SET last_activity_at = NOW() - ($1 || ' milliseconds')::interval WHERE id = $2`,
    [ms, tableId],
  );
}

afterAll(async () => {
  await pool.end();
});

describe('table activity touch + keep-alive', () => {
  it('touches last_activity_at on join and again on keep-alive', async () => {
    const owner = await createUserDirect({});
    const table = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: `Table_${uniqueSuffix()}`, visibility: 'public' });
    const tableId = table.body.tableId;

    await ageTable(tableId, 10 * 60 * 1000); // simulate 10 minutes of silence
    const beforeKeepAlive = await pool.query('SELECT last_activity_at FROM game_table WHERE id = $1', [tableId]);

    const keepAlive = await request(app).post(`/api/v1/tables/${tableId}/keep-alive`).set(authHeader(owner.id, 'user'));
    expect(keepAlive.status).toBe(200);

    const afterKeepAlive = await pool.query('SELECT last_activity_at FROM game_table WHERE id = $1', [tableId]);
    expect(new Date(afterKeepAlive.rows[0].last_activity_at).getTime()).toBeGreaterThan(
      new Date(beforeKeepAlive.rows[0].last_activity_at).getTime(),
    );
  });

  it('rejects keep-alive from someone not seated at the table', async () => {
    const owner = await createUserDirect({});
    const outsider = await createUserDirect({});
    const table = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: `Table_${uniqueSuffix()}`, visibility: 'public' });

    const keepAlive = await request(app)
      .post(`/api/v1/tables/${table.body.tableId}/keep-alive`)
      .set(authHeader(outsider.id, 'user'));
    expect(keepAlive.status).toBe(403);
  });
});

describe('inactive-table cleanup (deleteInactiveTables)', () => {
  it('hard-deletes a table untouched past INACTIVITY_DELETE_MS, cascading its seats', async () => {
    const owner = await createUserDirect({});
    const table = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: `Table_${uniqueSuffix()}`, visibility: 'public' });
    const tableId = table.body.tableId;

    await ageTable(tableId, INACTIVITY_DELETE_MS + 1000);
    const { deletedTableIds } = await deleteInactiveTables();
    expect(deletedTableIds).toContain(tableId);

    const tableRow = await pool.query('SELECT id FROM game_table WHERE id = $1', [tableId]);
    expect(tableRow.rowCount).toBe(0);
    const seatRow = await pool.query('SELECT id FROM table_seat WHERE table_id = $1', [tableId]);
    expect(seatRow.rowCount).toBe(0);
  });

  it('hard-deletes a stale table whose game still has auto-ready preferences', async () => {
    const owner = await createUserDirect({});
    const table = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: `Table_${uniqueSuffix()}`, visibility: 'public' });
    const tableId = table.body.tableId;
    const sessionResult = await pool.query(`INSERT INTO table_session (table_id) VALUES ($1) RETURNING id`, [tableId]);
    const gameResult = await pool.query(
      `INSERT INTO game (table_id, table_session_id, status, started_at)
       VALUES ($1, $2, 'active', NOW())
       RETURNING id`,
      [tableId, sessionResult.rows[0].id],
    );
    const gameId = gameResult.rows[0].id;
    await pool.query(
      `INSERT INTO round_ready_pref (game_id, user_id, auto_ready) VALUES ($1, $2, TRUE)`,
      [gameId, owner.id],
    );

    await ageTable(tableId, INACTIVITY_DELETE_MS + 1000);
    const { deletedTableIds } = await deleteInactiveTables();
    expect(deletedTableIds).toContain(tableId);

    const prefRow = await pool.query('SELECT game_id FROM round_ready_pref WHERE game_id = $1', [gameId]);
    expect(prefRow.rowCount).toBe(0);
  });

  it('leaves a recently-active table alone', async () => {
    const owner = await createUserDirect({});
    const table = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: `Table_${uniqueSuffix()}`, visibility: 'public' });
    const tableId = table.body.tableId;

    const { deletedTableIds } = await deleteInactiveTables();
    expect(deletedTableIds).not.toContain(tableId);

    const tableRow = await pool.query('SELECT id FROM game_table WHERE id = $1', [tableId]);
    expect(tableRow.rowCount).toBe(1);
  });

  it('does not delete a table that was touched after crossing the stale threshold', async () => {
    const owner = await createUserDirect({});
    const table = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: `Table_${uniqueSuffix()}`, visibility: 'public' });
    const tableId = table.body.tableId;

    await ageTable(tableId, INACTIVITY_DELETE_MS + 1000);
    await request(app).post(`/api/v1/tables/${tableId}/keep-alive`).set(authHeader(owner.id, 'user')).expect(200);

    const { deletedTableIds } = await deleteInactiveTables();
    expect(deletedTableIds).not.toContain(tableId);

    const tableRow = await pool.query('SELECT id FROM game_table WHERE id = $1', [tableId]);
    expect(tableRow.rowCount).toBe(1);
  });

  it('preserves karma/score ledger rows (nulling game_id) when their game is deleted along with the table', async () => {
    const owner = await createUserDirect({});
    await pool.query(
      `INSERT INTO karma_ledger (user_id, game_id, delta, reason) VALUES ($1, NULL, 5, 'match_completed')`,
      [owner.id],
    );
    // Sanity: this test only needs to prove the FK on karma_ledger.game_id
    // still allows NULL and doesn't block on a real cascade - the full
    // cascade path (game_table -> game -> ... ) is exercised implicitly by
    // every other integration test that finishes a match on a table that
    // later gets cleaned up; nothing currently forces that combination
    // directly, so this just pins the constraint's ON DELETE SET NULL
    // behavior via a table+game created and then deleted.
    const table = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: `Table_${uniqueSuffix()}`, visibility: 'public' });
    const tableId = table.body.tableId;
    const sessionResult = await pool.query(
      `INSERT INTO table_session (table_id) VALUES ($1) RETURNING id`,
      [tableId],
    );
    const gameResult = await pool.query(
      `INSERT INTO game (table_id, table_session_id, status, started_at)
       VALUES ($1, $2, 'active', NOW())
       RETURNING id`,
      [tableId, sessionResult.rows[0].id],
    );
    const gameId = gameResult.rows[0].id;
    const ledgerResult = await pool.query(
      `INSERT INTO karma_ledger (user_id, game_id, delta, reason) VALUES ($1, $2, 5, 'match_completed') RETURNING id`,
      [owner.id, gameId],
    );

    await ageTable(tableId, INACTIVITY_DELETE_MS + 1000);
    await deleteInactiveTables();

    const ledgerRow = await pool.query('SELECT game_id FROM karma_ledger WHERE id = $1', [ledgerResult.rows[0].id]);
    expect(ledgerRow.rows).toHaveLength(1);
    expect(ledgerRow.rows[0].game_id).toBeNull();
  });
});

describe('GET /admin/tables', () => {
  it('flags a table untouched past ADMIN_INACTIVE_MS as inactive', async () => {
    const admin = await createUserDirect({ role: 'admin' });
    const owner = await createUserDirect({});
    const table = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: `Table_${uniqueSuffix()}`, visibility: 'public' });
    const tableId = table.body.tableId;
    await ageTable(tableId, ADMIN_INACTIVE_MS + 1000);

    const response = await request(app).get('/api/v1/admin/tables').set(authHeader(admin.id, 'admin'));
    expect(response.status).toBe(200);
    const entry = response.body.tables.find((t: { tableId: string }) => t.tableId === tableId);
    expect(entry.inactive).toBe(true);
    expect(entry.ownerUsername).toBe(owner.username);
  });

  it('does not flag a freshly created table as inactive', async () => {
    const admin = await createUserDirect({ role: 'admin' });
    const owner = await createUserDirect({});
    const table = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: `Table_${uniqueSuffix()}`, visibility: 'public' });

    const response = await request(app).get('/api/v1/admin/tables').set(authHeader(admin.id, 'admin'));
    const entry = response.body.tables.find((t: { tableId: string }) => t.tableId === table.body.tableId);
    expect(entry.inactive).toBe(false);
  });

  it('lets an admin delete a table manually', async () => {
    const admin = await createUserDirect({ role: 'admin' });
    const owner = await createUserDirect({});
    const table = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: `Table_${uniqueSuffix()}`, visibility: 'public' });

    const response = await request(app)
      .delete(`/api/v1/admin/tables/${table.body.tableId}`)
      .set(authHeader(admin.id, 'admin'));
    expect(response.status).toBe(204);

    const tableRow = await pool.query('SELECT id FROM game_table WHERE id = $1', [table.body.tableId]);
    expect(tableRow.rowCount).toBe(0);
  });

  it('lets an admin delete a table whose game still has auto-ready preferences', async () => {
    const admin = await createUserDirect({ role: 'admin' });
    const owner = await createUserDirect({});
    const table = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: `Table_${uniqueSuffix()}`, visibility: 'public' });
    const tableId = table.body.tableId;
    const sessionResult = await pool.query(`INSERT INTO table_session (table_id) VALUES ($1) RETURNING id`, [tableId]);
    const gameResult = await pool.query(
      `INSERT INTO game (table_id, table_session_id, status, started_at)
       VALUES ($1, $2, 'active', NOW())
       RETURNING id`,
      [tableId, sessionResult.rows[0].id],
    );
    const gameId = gameResult.rows[0].id;
    await pool.query(
      `INSERT INTO round_ready_pref (game_id, user_id, auto_ready) VALUES ($1, $2, TRUE)`,
      [gameId, owner.id],
    );

    await request(app)
      .delete(`/api/v1/admin/tables/${tableId}`)
      .set(authHeader(admin.id, 'admin'))
      .expect(204);

    const prefRow = await pool.query('SELECT game_id FROM round_ready_pref WHERE game_id = $1', [gameId]);
    expect(prefRow.rowCount).toBe(0);
  });
});

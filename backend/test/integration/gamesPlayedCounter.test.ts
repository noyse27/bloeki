import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db/pool';
import { finishGame } from '../../src/services/matchOutcome';
import { authHeader, createUserDirect, uniqueSuffix } from '../helpers/testUtils';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

// Minimal direct fixture instead of driving a game through the full round
// engine (see matchOutcome.test.ts for that) - finishGame only needs a
// game_table/table_session/game row and a seated player to score, so this
// is enough to isolate the counter behavior itself.
async function createFinishableGame(ownerId: string): Promise<{ tableId: string; gameId: string }> {
  const tableResult = await pool.query(
    `INSERT INTO game_table (owner_user_id, name, visibility) VALUES ($1, $2, 'public') RETURNING id`,
    [ownerId, `Table_${uniqueSuffix()}`],
  );
  const tableId = tableResult.rows[0].id;

  await pool.query(`INSERT INTO table_seat (table_id, user_id, seat_type) VALUES ($1, $2, 'player')`, [
    tableId,
    ownerId,
  ]);

  const sessionResult = await pool.query(`INSERT INTO table_session (table_id) VALUES ($1) RETURNING id`, [
    tableId,
  ]);

  const gameResult = await pool.query(
    `INSERT INTO game (table_id, table_session_id, status, started_at) VALUES ($1, $2, 'active', NOW()) RETURNING id`,
    [tableId, sessionResult.rows[0].id],
  );

  return { tableId, gameId: gameResult.rows[0].id };
}

async function readCounter(): Promise<number> {
  const result = await pool.query(`SELECT value FROM system_setting WHERE key = 'total_games_finished'`);
  return result.rows[0] ? Number(result.rows[0].value) : 0;
}

describe('persistent games-played counter', () => {
  it('increments on finishGame and is exposed via /stats/games-played', async () => {
    const owner = await createUserDirect({});
    const { gameId } = await createFinishableGame(owner.id);

    const before = await readCounter();
    await finishGame(pool, gameId, owner.id);
    expect(await readCounter()).toBe(before + 1);

    const response = await request(app).get('/api/v1/stats/games-played').set(authHeader(owner.id, 'user'));
    expect(response.status).toBe(200);
    expect(response.body.gamesPlayed).toBe(before + 1);
  });

  it('survives the finished table being hard-deleted (the bug this replaces)', async () => {
    const owner = await createUserDirect({});
    const { tableId, gameId } = await createFinishableGame(owner.id);

    const before = await readCounter();
    await finishGame(pool, gameId, owner.id);
    expect(await readCounter()).toBe(before + 1);

    // Mirrors tableCleanup.ts's hard delete - game.table_id cascades away
    // with it, which is exactly what used to wipe the old COUNT(*)-based
    // stat back toward zero.
    await pool.query(`DELETE FROM game_table WHERE id = $1`, [tableId]);
    const gameStillExists = await pool.query(`SELECT id FROM game WHERE id = $1`, [gameId]);
    expect(gameStillExists.rowCount).toBe(0); // sanity: the cascade did happen

    expect(await readCounter()).toBe(before + 1); // but the counter did not regress
  });
});

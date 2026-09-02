import request from 'supertest';
import { pool } from '../../src/db/pool';
import { authHeader, createUserDirect, markSeatReadyDirect, uniqueSuffix } from '../helpers/testUtils';
import { getSetupTokenForTests } from '../../src/services/setupToken';

// See rounds.test.ts for why these are set here (before the deferred
// require) rather than via a normal import.
process.env.ROUND_COUNTDOWN_MS = '100';
process.env.ROUND_TRAILER_DURATION_MS = '100';
process.env.ROUND_GUESS_WINDOW_MS = '100';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createApp } = require('../../src/app');
const app = createApp();

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getRound(userId: string, gameId: string, roundId: string) {
  const response = await request(app)
    .get(`/api/v1/games/${gameId}/rounds/${roundId}`)
    .set(authHeader(userId, 'user'));
  return response.body;
}

async function waitForRoundStatus(
  userId: string,
  gameId: string,
  roundId: string,
  targetStatuses: string[],
  maxMs = 3000,
): Promise<ReturnType<typeof getRound> extends Promise<infer T> ? T : never> {
  const deadline = Date.now() + maxMs;
  let last = await getRound(userId, gameId, roundId);
  while (!targetStatuses.includes(last.status) && Date.now() < deadline) {
    await wait(20);
    last = await getRound(userId, gameId, roundId);
  }
  if (!targetStatuses.includes(last.status)) {
    throw new Error(
      `round ${roundId} did not reach [${targetStatuses.join(',')}] within ${maxMs}ms (stuck at ${last.status})`,
    );
  }
  return last;
}

async function seedTrailer(year: number): Promise<string> {
  const result = await pool.query(
    `INSERT INTO trailer_ref (imdb_id, title, year_value, clip_path)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [`tt_${uniqueSuffix()}`, `Trailer ${uniqueSuffix()}`, year, `/clips/${uniqueSuffix()}.mp4`],
  );
  return result.rows[0].id;
}

afterAll(async () => {
  await pool.end();
});

describe('GET /setup/status', () => {
  it('reflects whether an admin account exists, without side effects', async () => {
    await pool.query('TRUNCATE TABLE app_user RESTART IDENTITY CASCADE');

    const before = await request(app).get('/api/v1/setup/status');
    expect(before.body.adminExists).toBe(false);

    const suffix = uniqueSuffix();
    await request(app).post('/api/v1/setup/bootstrap').send({
      username: `admin_${suffix}`,
      email: `admin_${suffix}@example.test`,
      password: 'correct horse battery staple',
      setupToken: getSetupTokenForTests(),
    });

    const after = await request(app).get('/api/v1/setup/status');
    expect(after.body.adminExists).toBe(true);
  });
});

describe('POST /setup/self-test (FR-063)', () => {
  it('requires admin auth and reports healthy when db and songpool are fine', async () => {
    const plainUser = await createUserDirect({});
    const forbidden = await request(app)
      .post('/api/v1/setup/self-test')
      .set(authHeader(plainUser.id, 'user'));
    expect(forbidden.status).toBe(403);

    const admin = await createUserDirect({ role: 'admin' });
    await pool.query(`UPDATE trailer_ref SET is_valid = FALSE`);
    await seedTrailer(1985);

    const response = await request(app)
      .post('/api/v1/setup/self-test')
      .set(authHeader(admin.id, 'admin'));
    expect(response.status).toBe(200);
    expect(response.body.healthy).toBe(true);
    expect(response.body.checks).toEqual({ database: true, trailerPool: true, roundLogic: true });
  });
});

describe('POST /tables/{id}/new-game (AK-009/010/011)', () => {
  it('refuses to start a new game while the current one has not finished', async () => {
    const owner = await createUserDirect({});
    const other = await createUserDirect({});
    const tableResponse = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: `Table_${uniqueSuffix()}`, visibility: 'public' });
    const tableId = tableResponse.body.tableId;
    await request(app)
      .post(`/api/v1/tables/${tableId}/join`)
      .set(authHeader(other.id, 'user'))
      .send({ joinAs: 'player' });

    const response = await request(app)
      .post(`/api/v1/tables/${tableId}/new-game`)
      .set(authHeader(owner.id, 'user'));
    expect(response.status).toBe(409); // table is still 'open', never started
  });

  it('keeps the same table_session and player composition, and honors session-wide song history', async () => {
    const owner = await createUserDirect({});
    const other = await createUserDirect({});

    const tableResponse = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: `Table_${uniqueSuffix()}`, visibility: 'public' });
    const tableId = tableResponse.body.tableId;
    await request(app)
      .post(`/api/v1/tables/${tableId}/join`)
      .set(authHeader(other.id, 'user'))
      .send({ joinAs: 'player' });

    await pool.query(`UPDATE trailer_ref SET is_valid = FALSE`);
    const trailerAId = await seedTrailer(1980);
    const trailerBId = await seedTrailer(2020);

    await markSeatReadyDirect(tableId, owner.id);
    await markSeatReadyDirect(tableId, other.id);

    const startResponse = await request(app)
      .post(`/api/v1/tables/${tableId}/start`)
      .set(authHeader(owner.id, 'user'));
    const firstGameId = startResponse.body.gameId;
    const firstSessionId = startResponse.body.tableSessionId;

    const firstRound = await request(app)
      .post(`/api/v1/games/${firstGameId}/rounds`)
      .set(authHeader(owner.id, 'user'));
    const firstRoundId = firstRound.body.roundId;
    await waitForRoundStatus(owner.id, firstGameId, firstRoundId, ['resolved']);

    const firstRoundTrailerRow = await pool.query('SELECT trailer_id FROM round WHERE id = $1', [
      firstRoundId,
    ]);
    const firstTrailerId = firstRoundTrailerRow.rows[0].trailer_id;
    const secondTrailerId = firstTrailerId === trailerAId ? trailerBId : trailerAId;

    // End the match directly (win condition itself is Sprint 5's concern);
    // here we only care about "Neue Partie" starting a fresh game correctly.
    await pool.query(
      `UPDATE game SET status = 'finished', winner_user_id = $1, ended_at = NOW() WHERE id = $2`,
      [owner.id, firstGameId],
    );
    await pool.query(`UPDATE game_table SET state = 'finished' WHERE id = $1`, [tableId]);

    const newGameResponse = await request(app)
      .post(`/api/v1/tables/${tableId}/new-game`)
      .set(authHeader(owner.id, 'user'));
    expect(newGameResponse.status).toBe(200);
    expect(newGameResponse.body.tableSessionId).toBe(firstSessionId); // AK-011: same session
    expect(newGameResponse.body.gameId).not.toBe(firstGameId);

    const secondGameDetail = await request(app)
      .get(`/api/v1/games/${newGameResponse.body.gameId}`)
      .set(authHeader(owner.id, 'user'));
    // AK-009: same player composition, no re-join required.
    const playerIds = secondGameDetail.body.players.map((p: { userId: string }) => p.userId).sort();
    expect(playerIds).toEqual([owner.id, other.id].sort());

    // AK-011: the session already played firstTrailerId, so the only valid
    // candidate left in this session is the other seeded trailer.
    const secondRound = await request(app)
      .post(`/api/v1/games/${newGameResponse.body.gameId}/rounds`)
      .set(authHeader(owner.id, 'user'));
    expect(secondRound.status).toBe(201);
    const secondRoundTrailerRow = await pool.query('SELECT trailer_id FROM round WHERE id = $1', [
      secondRound.body.roundId,
    ]);
    expect(secondRoundTrailerRow.rows[0].trailer_id).toBe(secondTrailerId);

    await waitForRoundStatus(owner.id, newGameResponse.body.gameId, secondRound.body.roundId, [
      'resolved',
    ]);
  });
});

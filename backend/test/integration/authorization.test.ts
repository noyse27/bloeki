import request from 'supertest';
import { pool } from '../../src/db/pool';
import { authHeader, createUserDirect, markSeatReadyDirect, uniqueSuffix } from '../helpers/testUtils';

// Round timings: fast enough to reach 'guessing' quickly, but this suite
// only needs a round to exist and accept guesses - it never waits out a
// full resolve cycle (the guess window itself is left long).
process.env.ROUND_COUNTDOWN_MS = '50';
process.env.ROUND_TRAILER_DURATION_MS = '50';
process.env.ROUND_GUESS_WINDOW_MS = '60000';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createApp } = require('../../src/app');
const app = createApp();

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function seedTrailer(year: number): Promise<void> {
  await pool.query('UPDATE trailer_ref SET is_valid = FALSE');
  await pool.query(
    `INSERT INTO trailer_ref (imdb_id, title, year_value, clip_path)
     VALUES ($1, $2, $3, $4)`,
    [`tt_${uniqueSuffix()}`, `Trailer ${uniqueSuffix()}`, year, `/clips/${uniqueSuffix()}.mp4`],
  );
}

async function createRunningGame(): Promise<{
  tableId: string;
  gameId: string;
  joinCode: string | null;
  owner: { id: string };
  other: { id: string };
}> {
  const owner = await createUserDirect({});
  const other = await createUserDirect({});

  const tableResponse = await request(app)
    .post('/api/v1/tables')
    .set(authHeader(owner.id, 'user'))
    .send({ name: `Auth_${uniqueSuffix()}`, visibility: 'private' });
  const tableId = tableResponse.body.tableId;
  const joinCode = tableResponse.body.joinCode;

  await request(app)
    .post(`/api/v1/tables/${tableId}/join`)
    .set(authHeader(other.id, 'user'))
    .send({ joinAs: 'player', joinCode });

  await seedTrailer(1990);
  await markSeatReadyDirect(tableId, owner.id);
  await markSeatReadyDirect(tableId, other.id);

  const startResponse = await request(app)
    .post(`/api/v1/tables/${tableId}/start`)
    .set(authHeader(owner.id, 'user'));

  return { tableId, gameId: startResponse.body.gameId, joinCode, owner, other };
}

async function startRound(gameId: string, ownerId: string): Promise<string> {
  const response = await request(app)
    .post(`/api/v1/games/${gameId}/rounds`)
    .set(authHeader(ownerId, 'user'));
  return response.body.roundId;
}

afterAll(async () => {
  await pool.end();
});

describe('H-01: table detail requires membership', () => {
  it('hides full detail (incl. joinCode) from a logged-in non-member, but preview stays open', async () => {
    const { tableId, joinCode } = await createRunningGame();
    const stranger = await createUserDirect({});

    const full = await request(app).get(`/api/v1/tables/${tableId}`).set(authHeader(stranger.id, 'user'));
    expect(full.status).toBe(404);

    const preview = await request(app).get(`/api/v1/tables/${tableId}/preview`).set(authHeader(stranger.id, 'user'));
    expect(preview.status).toBe(200);
    expect(preview.body).not.toHaveProperty('joinCode');
    expect(preview.body).not.toHaveProperty('seats');
    expect(preview.body).not.toHaveProperty('latestGameId');
    expect(joinCode).not.toBeNull();
  });

  it('returns full detail (incl. joinCode) to an actual member', async () => {
    const { tableId, owner } = await createRunningGame();
    const full = await request(app).get(`/api/v1/tables/${tableId}`).set(authHeader(owner.id, 'user'));
    expect(full.status).toBe(200);
    expect(full.body).toHaveProperty('joinCode');
  });

  it('404s a nonexistent table the same way as a real one a stranger cant see', async () => {
    const stranger = await createUserDirect({});
    const response = await request(app)
      .get('/api/v1/tables/00000000-0000-0000-0000-000000000000')
      .set(authHeader(stranger.id, 'user'));
    expect(response.status).toBe(404);
  });
});

describe('H-01: game/round detail requires membership', () => {
  it('hides game detail and state from a non-member', async () => {
    const { gameId } = await createRunningGame();
    const stranger = await createUserDirect({});

    const detail = await request(app).get(`/api/v1/games/${gameId}`).set(authHeader(stranger.id, 'user'));
    expect(detail.status).toBe(404);

    const state = await request(app).get(`/api/v1/games/${gameId}/state`).set(authHeader(stranger.id, 'user'));
    expect(state.status).toBe(404);
  });

  it('hides round detail from a non-member and rejects a roundId from a different game', async () => {
    const { gameId, owner } = await createRunningGame();
    const roundId = await startRound(gameId, owner.id);
    const stranger = await createUserDirect({});

    const asStranger = await request(app)
      .get(`/api/v1/games/${gameId}/rounds/${roundId}`)
      .set(authHeader(stranger.id, 'user'));
    expect(asStranger.status).toBe(404);

    const otherGame = await createRunningGame();
    const crossGame = await request(app)
      .get(`/api/v1/games/${otherGame.gameId}/rounds/${roundId}`)
      .set(authHeader(otherGame.owner.id, 'user'));
    expect(crossGame.status).toBe(404);
  });
});

describe('H-03: only active players may guess for a round', () => {
  it('rejects a guess from a logged-in non-participant without changing round state', async () => {
    const { gameId, owner } = await createRunningGame();
    const roundId = await startRound(gameId, owner.id);
    await wait(150); // past ROUND_COUNTDOWN_MS + ROUND_TRAILER_DURATION_MS, now 'guessing'

    const stranger = await createUserDirect({});
    const response = await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${roundId}/guess`)
      .set(authHeader(stranger.id, 'user'))
      .send({ value: 0 });
    expect(response.status).toBe(403);

    const guessRow = await pool.query('SELECT id FROM guess WHERE round_id = $1 AND user_id = $2', [
      roundId,
      stranger.id,
    ]);
    expect(guessRow.rowCount).toBe(0);
  });

  // removed: bloeki has no token/buzzer mechanic (no token_usage table, no
  // /token-claim route - see roundEngine.ts/roundReady.ts and the initial
  // schema migration's comment), so the two token-claim authorization tests
  // that used to live here (rejecting a claim from a non-participant, and
  // rejecting a cross-game roundId/gameId pair on the claim route) test a
  // feature that doesn't exist in this product. The cross-game guess case
  // is still covered above by "hides round detail ... and rejects a
  // roundId from a different game".

  it('still allows an actual active player to guess normally', async () => {
    const { gameId, owner } = await createRunningGame();
    const roundId = await startRound(gameId, owner.id);
    await wait(150); // past ROUND_COUNTDOWN_MS + ROUND_TRAILER_DURATION_MS, now 'guessing'

    const response = await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${roundId}/guess`)
      .set(authHeader(owner.id, 'user'))
      .send({ value: 0 });
    expect(response.status).toBe(200);
  });
});

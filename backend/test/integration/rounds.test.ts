import request from 'supertest';
import { pool } from '../../src/db/pool';
import { authHeader, createUserDirect, markSeatReadyDirect, uniqueSuffix } from '../helpers/testUtils';

// Round timings are read from these env vars once, at module import time,
// so they must be set before requiring the app (a plain require, not an
// ES import, so it isn't hoisted above these assignments). This lets the
// full countdown -> playing -> guessing -> resolved cycle (see
// roundConfig.ts/roundEngine.ts) run in milliseconds instead of the real
// 3s + 25s + 10s, keeping the suite fast and deterministic.
process.env.ROUND_COUNTDOWN_MS = '150';
process.env.ROUND_TRAILER_DURATION_MS = '200';
process.env.ROUND_GUESS_WINDOW_MS = '200';

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

// Polling instead of a fixed wait() avoids flakiness from real request
// overhead racing the background setTimeout transitions in roundEngine.ts.
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

async function setTimeline(gameId: string, userId: string, years: number[]): Promise<void> {
  await pool.query('DELETE FROM timeline_card WHERE game_id = $1 AND user_id = $2', [gameId, userId]);
  for (let i = 0; i < years.length; i += 1) {
    await pool.query(
      `INSERT INTO timeline_card (game_id, user_id, year_value, special_type, placed_position)
       VALUES ($1, $2, $3, 'normal', $4)`,
      [gameId, userId, years[i], i],
    );
  }
}

async function createRunningGame(): Promise<{ tableId: string; gameId: string; owner: { id: string }; other: { id: string } }> {
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

  // trailer_ref is one global library shared by every integration test
  // file; invalidate whatever another suite left behind so the trailer
  // seeded next is deterministically the one drawn (this test asserts on
  // its year) - the round-selection pool is fixed once at session start
  // (see trailerBatch.ts/tableStart.ts), so this must happen BEFORE /start,
  // not after.
  await pool.query('UPDATE trailer_ref SET is_valid = FALSE');
  await seedTrailer(1990);

  await markSeatReadyDirect(tableId, owner.id);
  await markSeatReadyDirect(tableId, other.id);

  const startResponse = await request(app)
    .post(`/api/v1/tables/${tableId}/start`)
    .set(authHeader(owner.id, 'user'));

  return { tableId, gameId: startResponse.body.gameId, owner, other };
}

afterAll(async () => {
  await pool.end();
});

describe('table start seeds a starting timeline (FR-023)', () => {
  it('refuses to start a table with no trailers in the library', async () => {
    // trailer_ref is a single global library shared by every test file;
    // other suites (or earlier tests in this run) may have already seeded
    // trailers, so force an empty library for this specific assertion.
    // CASCADE only reaches round-derived tables (round/guess/timeline_card/
    // session_trailer_history/table_session_trailer_pool), not
    // tables/games/users from other suites.
    await pool.query('TRUNCATE TABLE trailer_ref CASCADE');

    const owner = await createUserDirect({});
    const other = await createUserDirect({});
    const tableResponse = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: `Empty_${uniqueSuffix()}`, visibility: 'public' });
    await request(app)
      .post(`/api/v1/tables/${tableResponse.body.tableId}/join`)
      .set(authHeader(other.id, 'user'))
      .send({ joinAs: 'player' });

    await markSeatReadyDirect(tableResponse.body.tableId, owner.id);
    await markSeatReadyDirect(tableResponse.body.tableId, other.id);

    const startResponse = await request(app)
      .post(`/api/v1/tables/${tableResponse.body.tableId}/start`)
      .set(authHeader(owner.id, 'user'));

    // tableStart.ts surfaces loadTrailerBatch's NO_TRAILERS_AVAILABLE as a
    // 409 (round-engine-style error code), not a generic 400.
    expect(startResponse.status).toBe(409);
    expect(startResponse.body.error).toBe('NO_TRAILERS_AVAILABLE');
  });

  it('gives each active player 2 start blocks', async () => {
    const { gameId, owner } = await createRunningGame();

    // H-01: game detail requires an active seat at the table - use a
    // participant (the owner) rather than an unrelated fresh account.
    const detail = await request(app).get(`/api/v1/games/${gameId}`).set(authHeader(owner.id, 'user'));
    expect(detail.status).toBe(200);
    expect(detail.body.players).toHaveLength(2);
    for (const player of detail.body.players) {
      expect(player.cardCount).toBe(2);
    }
  });
});

describe('round lifecycle (FR-021/022/025/026)', () => {

  it('runs countdown -> playing -> guessing -> resolved deterministically and scores placements correctly', async () => {
    const { gameId, owner, other } = await createRunningGame();

    await setTimeline(gameId, owner.id, [1980, 2000]);
    await setTimeline(gameId, other.id, [1980, 2000]);

    const startRound = await request(app)
      .post(`/api/v1/games/${gameId}/rounds`)
      .set(authHeader(owner.id, 'user'));
    expect(startRound.status).toBe(201);
    expect(startRound.body.status).toBe('countdown');
    const roundId = startRound.body.roundId;

    const guessDuringCountdown = await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${roundId}/guess`)
      .set(authHeader(owner.id, 'user'))
      .send({ value: 1 });
    expect(guessDuringCountdown.status).toBe(409);

    const midRound = await waitForRoundStatus(owner.id, gameId, roundId, ['playing']);
    expect(midRound.status).toBe('playing');
    expect(midRound.trailerYear).toBeNull(); // not revealed before resolution

    // Unlike songster's mid-song-only guessing, bloeki also accepts a
    // guess already during 'playing' (the timeline is visible on wide
    // screens by then - see roundEngine.ts's submitGuess comment), not
    // just in the dedicated 'guessing' window after the trailer ends. A
    // later click simply replaces an earlier one (ORDER BY submitted_at
    // DESC in resolveRound).
    //
    // Trailer year is 1990: index 1 (between 1980 and 2000) is correct for
    // owner's [1980, 2000] timeline; index 0 is wrong for other's.
    const correctGuess = await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${roundId}/guess`)
      .set(authHeader(owner.id, 'user'))
      .send({ value: 1 });
    expect(correctGuess.status).toBe(200);

    const guessingRound = await waitForRoundStatus(owner.id, gameId, roundId, ['guessing']);
    expect(guessingRound.status).toBe('guessing');

    const wrongGuess = await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${roundId}/guess`)
      .set(authHeader(other.id, 'user'))
      .send({ value: 0 });
    expect(wrongGuess.status).toBe(200);

    const resolved = await waitForRoundStatus(owner.id, gameId, roundId, ['resolved']);
    expect(resolved.status).toBe('resolved');
    expect(resolved.trailerYear).toBe(1990);

    const lateGuess = await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${roundId}/guess`)
      .set(authHeader(owner.id, 'user'))
      .send({ value: 1 });
    expect(lateGuess.status).toBe(409);

    const ownerResult = resolved.results.find((r: { userId: string }) => r.userId === owner.id);
    const otherResult = resolved.results.find((r: { userId: string }) => r.userId === other.id);
    expect(ownerResult.correct).toBe(true);
    expect(otherResult.correct).toBe(false);

    const gameDetail = await request(app)
      .get(`/api/v1/games/${gameId}`)
      .set(authHeader(owner.id, 'user'));
    const ownerPlayer = gameDetail.body.players.find((p: { userId: string }) => p.userId === owner.id);
    const otherPlayer = gameDetail.body.players.find((p: { userId: string }) => p.userId === other.id);
    expect(ownerPlayer.cardCount).toBe(3); // gained the correctly placed card
    expect(otherPlayer.cardCount).toBe(2); // wrong guess, no card awarded
  });

  it('refuses to start a round for a non-owner and blocks a second concurrent round', async () => {
    const { gameId, owner, other } = await createRunningGame();

    const forbidden = await request(app)
      .post(`/api/v1/games/${gameId}/rounds`)
      .set(authHeader(other.id, 'user'));
    expect(forbidden.status).toBe(403);

    const first = await request(app)
      .post(`/api/v1/games/${gameId}/rounds`)
      .set(authHeader(owner.id, 'user'));
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/v1/games/${gameId}/rounds`)
      .set(authHeader(owner.id, 'user'));
    expect(second.status).toBe(409);

    await wait(700); // let the round resolve before pool.end() runs (past 150+200+200ms)
  });
});

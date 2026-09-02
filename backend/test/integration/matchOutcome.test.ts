import request from 'supertest';
import { pool } from '../../src/db/pool';
import { authHeader, createUserDirect, markSeatReadyDirect, uniqueSuffix } from '../helpers/testUtils';

// See rounds.test.ts for why these are set here (before the deferred
// require) rather than via a normal import.
process.env.ROUND_COUNTDOWN_MS = '100';
process.env.ROUND_TRAILER_DURATION_MS = '100';
process.env.ROUND_GUESS_WINDOW_MS = '100';
process.env.REJOIN_GRACE_MS = '300';
process.env.MATCH_AUTO_CLOSE_MS = '300';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createApp } = require('../../src/app');
const app = createApp();

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function invalidateAllTrailers(): Promise<void> {
  await pool.query(`UPDATE trailer_ref SET is_valid = FALSE`);
}

// The round-selection pool (table_session_trailer_pool) is drawn once at
// session start from whatever's valid *then* (see trailerBatch.ts /
// tableStart.ts) and never grows afterwards - so a trailer must already
// have been seeded before /start to ever be selectable for this game.
// is_valid itself, though, is rechecked fresh on every draw
// (trailerPool.ts's fetchCandidates), so toggling it after start still
// works to force which already-seeded pool member gets picked next.
async function restrictToTrailer(trailerId: string): Promise<void> {
  await pool.query(`UPDATE trailer_ref SET is_valid = (id = $1)`, [trailerId]);
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

// extraYears: every trailer year this test's whole scenario will ever
// need to draw, beyond the base one that only exists to satisfy
// computeYearRange for start-block generation - all of them must be
// seeded here, before /start (see restrictToTrailer's comment above).
async function createRunningGame(extraYears: number[] = [2000]): Promise<{
  tableId: string;
  gameId: string;
  owner: { id: string };
  other: { id: string };
  trailerIds: Record<number, string>;
}> {
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

  // trailer_ref is shared globally across every integration test file;
  // invalidate whatever another suite left behind so this game's session
  // pool ends up containing exactly the trailers seeded below.
  await invalidateAllTrailers();
  const trailerIds: Record<number, string> = {};
  trailerIds[1950] = await seedTrailer(1950); // just needs to exist for start-block generation
  for (const year of extraYears) {
    trailerIds[year] = await seedTrailer(year);
  }

  await markSeatReadyDirect(tableId, owner.id);
  await markSeatReadyDirect(tableId, other.id);

  const startResponse = await request(app)
    .post(`/api/v1/tables/${tableId}/start`)
    .set(authHeader(owner.id, 'user'));

  return { tableId, gameId: startResponse.body.gameId, owner, other, trailerIds };
}

// Drives `winner` to a match win via a single guessed round - shared setup
// for the restart/auto-close tests below, which only care about table
// state once the match is over, not how it got there (already covered by
// the "winning the match" tests).
async function winMatch(gameId: string, winnerId: string, trailerId: string): Promise<void> {
  await setTimeline(gameId, winnerId, [1900, 1901, 1902, 1903, 1904, 1905, 1906, 1907, 1908]);
  await restrictToTrailer(trailerId);

  const startRound = await request(app).post(`/api/v1/games/${gameId}/rounds`).set(authHeader(winnerId, 'user'));
  const roundId = startRound.body.roundId;
  await waitForRoundStatus(winnerId, gameId, roundId, ['guessing']);
  await request(app)
    .post(`/api/v1/games/${gameId}/rounds/${roundId}/guess`)
    .set(authHeader(winnerId, 'user'))
    .send({ value: 9 });
  await waitForRoundStatus(winnerId, gameId, roundId, ['resolved']);
}

afterAll(async () => {
  await wait(500);
  await pool.end();
});

describe('winning the match (FR-040/042/043)', () => {
  it('declares a winner at 10 cards, scores, and credits completion karma to everyone', async () => {
    const { gameId, owner, other, trailerIds } = await createRunningGame();

    await setTimeline(
      gameId,
      owner.id,
      [1900, 1901, 1902, 1903, 1904, 1905, 1906, 1907, 1908],
    );
    await restrictToTrailer(trailerIds[2000]);

    const startRound = await request(app)
      .post(`/api/v1/games/${gameId}/rounds`)
      .set(authHeader(owner.id, 'user'));
    const roundId = startRound.body.roundId;
    await waitForRoundStatus(owner.id, gameId, roundId, ['guessing']);

    const guess = await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${roundId}/guess`)
      .set(authHeader(owner.id, 'user'))
      .send({ value: 9 });
    expect(guess.status).toBe(200);

    await waitForRoundStatus(owner.id, gameId, roundId, ['resolved']);

    const gameDetail = await request(app)
      .get(`/api/v1/games/${gameId}`)
      .set(authHeader(owner.id, 'user'));
    expect(gameDetail.body.status).toBe('finished');
    expect(gameDetail.body.winnerUserId).toBe(owner.id);

    // 1 win point + 1 per opponent (FR-042); a 2-player game -> 2.
    const scoreRow = await pool.query(
      `SELECT delta FROM score_ledger WHERE user_id = $1 AND game_id = $2`,
      [owner.id, gameId],
    );
    expect(scoreRow.rows[0].delta).toBe(2);

    const ownerKarma = await pool.query(
      `SELECT delta FROM karma_ledger WHERE user_id = $1 AND game_id = $2 AND reason = 'match_completed'`,
      [owner.id, gameId],
    );
    const otherKarma = await pool.query(
      `SELECT delta FROM karma_ledger WHERE user_id = $1 AND game_id = $2 AND reason = 'match_completed'`,
      [other.id, gameId],
    );
    expect(ownerKarma.rows[0].delta).toBe(5);
    expect(otherKarma.rows[0].delta).toBe(5); // FR-043: everyone who completed the match

    const ownerUser = await pool.query('SELECT score_points, karma_points FROM app_user WHERE id = $1', [
      owner.id,
    ]);
    expect(ownerUser.rows[0].score_points).toBe(2);
    expect(ownerUser.rows[0].karma_points).toBe(5);

    const tableRow = await pool.query('SELECT state FROM game_table WHERE id = $1', [
      gameDetail.body.tableId,
    ]);
    expect(tableRow.rows[0].state).toBe('finished');

    // games_played only counts someone who actually submitted a guess in
    // this game - "other" was seated the whole match but never played a
    // round (only "owner" guessed the single round that ended it).
    const ownerGamesPlayed = await pool.query('SELECT games_played FROM app_user WHERE id = $1', [owner.id]);
    const otherGamesPlayed = await pool.query('SELECT games_played FROM app_user WHERE id = $1', [other.id]);
    expect(ownerGamesPlayed.rows[0].games_played).toBe(1);
    expect(otherGamesPlayed.rows[0].games_played).toBe(0);
  });
});

// removed: bloeki has no bonus-round/Stichsong tie-break mechanic - that
// was part of songster's token/buzzer mechanic, deliberately not ported
// (see the initial schema migration's comment and matchOutcome.ts, which
// simply lets play continue normally on a tie at the win threshold instead
// of starting an exact-year bonus round). The three tests that used to
// live here ('starts a Stichsong bonus round...', 'awards the win to the
// closest... guess', 'rejects a bonus guess from a player who is not
// tied') all drove /rounds/:id/guess with guess_type 'exact_year' and
// expected a round with `mode: 'bonus'`, neither of which exist in
// bloeki's schema (guess.guess_type CHECK only allows 'position') or API.

describe('early-leave karma penalty (FR-044/045)', () => {
  it('penalizes a player who leaves mid-match and does not rejoin within the grace window', async () => {
    const { gameId, tableId, other } = await createRunningGame();

    const leaveResponse = await request(app)
      .post(`/api/v1/tables/${tableId}/leave`)
      .set(authHeader(other.id, 'user'));
    expect(leaveResponse.status).toBe(200);

    await wait(500); // past REJOIN_GRACE_MS=300

    const penaltyRow = await pool.query(
      `SELECT delta FROM karma_ledger WHERE user_id = $1 AND game_id = $2 AND reason = 'early_leave'`,
      [other.id, gameId],
    );
    expect(penaltyRow.rows).toHaveLength(1);
    // FR-044: base -5, plus -1 per other player still seated (owner is
    // still there) -> -6.
    expect(penaltyRow.rows[0].delta).toBe(-6);

    const otherUser = await pool.query('SELECT karma_points FROM app_user WHERE id = $1', [other.id]);
    expect(otherUser.rows[0].karma_points).toBe(penaltyRow.rows[0].delta);
  });

  it('applies no penalty if the player rejoins within the grace window', async () => {
    const { tableId, gameId, owner, other } = await createRunningGame();

    await request(app).post(`/api/v1/tables/${tableId}/leave`).set(authHeader(other.id, 'user'));
    await request(app)
      .post(`/api/v1/tables/${tableId}/join`)
      .set(authHeader(other.id, 'user'))
      .send({ joinAs: 'player' });

    await wait(500); // past REJOIN_GRACE_MS=300

    const penaltyRow = await pool.query(
      `SELECT id FROM karma_ledger WHERE user_id = $1 AND game_id = $2 AND reason = 'early_leave'`,
      [other.id, gameId],
    );
    expect(penaltyRow.rows).toHaveLength(0);

    const ownerStillThere = await pool.query(
      `SELECT id FROM table_seat WHERE table_id = $1 AND user_id = $2 AND left_at IS NULL`,
      [tableId, owner.id],
    );
    expect(ownerStillThere.rows).toHaveLength(1);
  });
});

describe('rematch and auto-close after a finished match', () => {
  it('lets a seated player restart the table, resetting it to open with readiness cleared', async () => {
    const { tableId, gameId, owner, other, trailerIds } = await createRunningGame();
    await winMatch(gameId, owner.id, trailerIds[2000]);

    const restart = await request(app).post(`/api/v1/tables/${tableId}/restart`).set(authHeader(other.id, 'user'));
    expect(restart.status).toBe(200);

    const tableRow = await pool.query('SELECT state, match_ended_at FROM game_table WHERE id = $1', [tableId]);
    expect(tableRow.rows[0].state).toBe('open');
    expect(tableRow.rows[0].match_ended_at).toBeNull();

    const seatRows = await pool.query(
      `SELECT ready FROM table_seat WHERE table_id = $1 AND left_at IS NULL`,
      [tableId],
    );
    expect(seatRows.rows.every((r) => r.ready === false)).toBe(true);

    // Restarting doesn't just silently vanish the seats a moment later -
    // the auto-close window that would otherwise fire is cancelled.
    await wait(500); // past MATCH_AUTO_CLOSE_MS=300
    const stillSeated = await pool.query(
      `SELECT id FROM table_seat WHERE table_id = $1 AND user_id = $2 AND left_at IS NULL`,
      [tableId, owner.id],
    );
    expect(stillSeated.rows).toHaveLength(1);
  });

  it('rejects a restart from someone not seated at the table', async () => {
    const { tableId, gameId, owner, trailerIds } = await createRunningGame();
    await winMatch(gameId, owner.id, trailerIds[2000]);

    const outsider = await createUserDirect({});
    const restart = await request(app)
      .post(`/api/v1/tables/${tableId}/restart`)
      .set(authHeader(outsider.id, 'user'));
    expect(restart.status).toBe(403);
  });

  it('rejects a restart on a table that is not finished', async () => {
    const { tableId, owner } = await createRunningGame();

    const restart = await request(app).post(`/api/v1/tables/${tableId}/restart`).set(authHeader(owner.id, 'user'));
    expect(restart.status).toBe(409);
  });

  it('auto-closes the table (evicts every seat) if nobody restarts within the window', async () => {
    const { tableId, gameId, owner, trailerIds } = await createRunningGame();
    await winMatch(gameId, owner.id, trailerIds[2000]);

    await wait(500); // past MATCH_AUTO_CLOSE_MS=300

    const seatRows = await pool.query(
      `SELECT user_id FROM table_seat WHERE table_id = $1 AND left_at IS NULL`,
      [tableId],
    );
    expect(seatRows.rows).toHaveLength(0);

    const tableRow = await pool.query('SELECT state FROM game_table WHERE id = $1', [tableId]);
    expect(tableRow.rows[0].state).toBe('finished'); // stays finished, just vacated - not a restart
  });
});

describe('leaderboard and karma-ledger endpoints', () => {
  it('lists users by score and exposes a karma ledger entry after a completed match', async () => {
    const { gameId, owner, trailerIds } = await createRunningGame();
    await setTimeline(gameId, owner.id, [1900, 1901, 1902, 1903, 1904, 1905, 1906, 1907, 1908]);
    await restrictToTrailer(trailerIds[2000]);

    const beforeStats = await request(app)
      .get('/api/v1/stats/games-played')
      .set(authHeader(owner.id, 'user'));
    expect(beforeStats.status).toBe(200);
    const gamesPlayedBefore = beforeStats.body.gamesPlayed;

    const round = await request(app)
      .post(`/api/v1/games/${gameId}/rounds`)
      .set(authHeader(owner.id, 'user'));
    const roundId = round.body.roundId;
    await waitForRoundStatus(owner.id, gameId, roundId, ['guessing']);
    await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${roundId}/guess`)
      .set(authHeader(owner.id, 'user'))
      .send({ value: 9 });
    await waitForRoundStatus(owner.id, gameId, roundId, ['resolved']);

    const leaderboard = await request(app)
      .get('/api/v1/leaderboard')
      .set(authHeader(owner.id, 'user'));
    expect(leaderboard.status).toBe(200);
    const ownerEntry = leaderboard.body.leaderboard.find((e: { userId: string }) => e.userId === owner.id);
    expect(ownerEntry.scorePoints).toBeGreaterThanOrEqual(2);

    const ledger = await request(app)
      .get(`/api/v1/users/${owner.id}/karma-ledger`)
      .set(authHeader(owner.id, 'user'));
    expect(ledger.status).toBe(200);
    expect(ledger.body.entries.some((e: { reason: string }) => e.reason === 'match_completed')).toBe(true);

    // Server-wide finished-match count (home screen stat) ticks up by
    // exactly one for this one completed match - not once per player.
    const afterStats = await request(app)
      .get('/api/v1/stats/games-played')
      .set(authHeader(owner.id, 'user'));
    expect(afterStats.body.gamesPlayed).toBe(gamesPlayedBefore + 1);
  });
});

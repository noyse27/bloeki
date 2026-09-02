import request from 'supertest';
import { pool } from '../../src/db/pool';
import { authHeader, createUserDirect, markSeatReadyDirect, uniqueSuffix } from '../helpers/testUtils';

// See rounds.test.ts's comment: these are read once at module import time,
// so they must be set before requiring the app.
process.env.ROUND_COUNTDOWN_MS = '100';
process.env.ROUND_TRAILER_DURATION_MS = '150';
process.env.ROUND_GUESS_WINDOW_MS = '100';
process.env.ROUND_READY_WINDOW_MS = '200';
process.env.AUTO_READY_GRACE_MS = '400';

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

async function createRunningGame(): Promise<{
  tableId: string;
  gameId: string;
  owner: { id: string };
  other: { id: string };
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

  await pool.query('UPDATE trailer_ref SET is_valid = FALSE');
  await seedTrailer(1990);
  await seedTrailer(2005);

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

describe('per-round readiness (30s ready window, sit-outs)', () => {
  it('auto-starts the round once every active player is ready', async () => {
    const { gameId, owner, other } = await createRunningGame();

    const first = await request(app)
      .post(`/api/v1/games/${gameId}/ready`)
      .set(authHeader(owner.id, 'user'))
      .send({ ready: true });
    expect(first.status).toBe(200);

    const stateAfterFirst = await request(app)
      .get(`/api/v1/games/${gameId}/state`)
      .set(authHeader(owner.id, 'user'));
    expect(stateAfterFirst.body.currentRound).toBeNull();
    expect(stateAfterFirst.body.roundReadyPhase.readyUserIds).toContain(owner.id);

    const second = await request(app)
      .post(`/api/v1/games/${gameId}/ready`)
      .set(authHeader(other.id, 'user'))
      .send({ ready: true });
    expect(second.status).toBe(200);

    const stateAfterSecond = await request(app)
      .get(`/api/v1/games/${gameId}/state`)
      .set(authHeader(owner.id, 'user'));
    expect(stateAfterSecond.body.currentRound).not.toBeNull();
    expect(stateAfterSecond.body.currentRound.status).toBe('countdown');
    expect(stateAfterSecond.body.currentRound.sitOutUserIds).toEqual([]);
  });

  it('starts the round after the ready window with stragglers sitting it out, and rejects their guess', async () => {
    const { gameId, owner, other } = await createRunningGame();

    await request(app)
      .post(`/api/v1/games/${gameId}/ready`)
      .set(authHeader(owner.id, 'user'))
      .send({ ready: true });
    // other never readies up.

    await wait(500); // comfortably past ROUND_READY_WINDOW_MS=200

    const state = await request(app)
      .get(`/api/v1/games/${gameId}/state`)
      .set(authHeader(owner.id, 'user'));
    expect(state.body.currentRound).not.toBeNull();
    expect(state.body.currentRound.sitOutUserIds).toEqual([other.id]);

    const roundId = state.body.currentRound.roundId;
    // Guessing only opens in its own 'guessing' window after the trailer
    // plays (see roundEngine.ts) - wait for it rather than for 'playing'.
    await waitForRoundStatus(owner.id, gameId, roundId, ['guessing']);

    const guessAttempt = await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${roundId}/guess`)
      .set(authHeader(other.id, 'user'))
      .send({ type: 'position', value: 0 });
    expect(guessAttempt.status).toBe(403);
    expect(guessAttempt.body.error).toBe('SITTING_OUT');

    const ownerGuess = await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${roundId}/guess`)
      .set(authHeader(owner.id, 'user'))
      .send({ type: 'position', value: 0 });
    expect(ownerGuess.status).toBe(200);
  });

  it('refuses to mark ready while a round is already in progress', async () => {
    const { gameId, owner, other } = await createRunningGame();

    await request(app)
      .post(`/api/v1/games/${gameId}/ready`)
      .set(authHeader(owner.id, 'user'))
      .send({ ready: true });
    await request(app)
      .post(`/api/v1/games/${gameId}/ready`)
      .set(authHeader(other.id, 'user'))
      .send({ ready: true });

    const lateReady = await request(app)
      .post(`/api/v1/games/${gameId}/ready`)
      .set(authHeader(owner.id, 'user'))
      .send({ ready: true });
    expect(lateReady.status).toBe(409);
    expect(lateReady.body.error).toBe('ROUND_ALREADY_ACTIVE');
  });
});

describe('"Auto bereit" (round_ready_pref)', () => {
  it('locks in auto-ready for future windows and applies it the instant the next one opens', async () => {
    const { gameId, owner, other } = await createRunningGame();

    // Locked in before any window is open yet - just a standing preference,
    // no round_ready row for owner should exist yet.
    const lockResponse = await request(app)
      .post(`/api/v1/games/${gameId}/ready/auto`)
      .set(authHeader(owner.id, 'user'))
      .send({ autoReady: true });
    expect(lockResponse.status).toBe(200);

    const stateAfterLock = await request(app)
      .get(`/api/v1/games/${gameId}/state`)
      .set(authHeader(owner.id, 'user'));
    expect(stateAfterLock.body.autoReadyUserIds).toEqual([owner.id]);
    expect(stateAfterLock.body.roundReadyPhase.readyUserIds).toEqual([]);

    // "other" is the only one who actually clicks ready - this arms the
    // window, which should immediately auto-ready the owner too (no 30s
    // wait, no second click). "other"'s click is itself a *manual* ready
    // click and, being the one that completes the group, starts the round
    // right away same as before - AUTO_READY_GRACE_MS only holds back a
    // round start that would otherwise be triggered by auto-ready alone
    // (see the next test's "instant start" isn't exercised here at all).
    const otherReady = await request(app)
      .post(`/api/v1/games/${gameId}/ready`)
      .set(authHeader(other.id, 'user'))
      .send({ ready: true });
    expect(otherReady.status).toBe(200);

    const stateAfterOtherReady = await request(app)
      .get(`/api/v1/games/${gameId}/state`)
      .set(authHeader(owner.id, 'user'));
    expect(stateAfterOtherReady.body.currentRound).not.toBeNull();
    expect(stateAfterOtherReady.body.currentRound.status).toBe('countdown');
    expect(stateAfterOtherReady.body.currentRound.sitOutUserIds).toEqual([]);
  });

  it('holds a fully auto-ready table\'s next round back for AUTO_READY_GRACE_MS instead of starting it the instant round 2\'s window auto-re-arms', async () => {
    const { gameId, owner, other } = await createRunningGame();

    // Get round 1 running the ordinary manual way first - the fix under
    // test is specifically about the *automatic* re-arm after a round
    // resolves (afterRoundResolved -> startReadyWindow, called with no
    // request/response cycle of its own to piggyback a completion check
    // on), not about this first window.
    await request(app)
      .post(`/api/v1/games/${gameId}/ready`)
      .set(authHeader(owner.id, 'user'))
      .send({ ready: true });
    await request(app)
      .post(`/api/v1/games/${gameId}/ready`)
      .set(authHeader(other.id, 'user'))
      .send({ ready: true });

    const stateAfterRound1Start = await request(app)
      .get(`/api/v1/games/${gameId}/state`)
      .set(authHeader(owner.id, 'user'));
    const round1Id = stateAfterRound1Start.body.currentRound.roundId;
    expect(round1Id).toBeTruthy();

    // Both lock in auto-ready while round 1 is in progress (round_ready was
    // already cleared when it started, so this is just a standing
    // preference for now, same as "locks in ... for future windows" above).
    await request(app)
      .post(`/api/v1/games/${gameId}/ready/auto`)
      .set(authHeader(owner.id, 'user'))
      .send({ autoReady: true });
    await request(app)
      .post(`/api/v1/games/${gameId}/ready/auto`)
      .set(authHeader(other.id, 'user'))
      .send({ autoReady: true });

    // Round 1 auto-resolves at ROUND_COUNTDOWN_MS + ROUND_TRAILER_DURATION_MS
    // + ROUND_GUESS_WINDOW_MS = 100 + 150 + 100 = 350ms after it started,
    // which re-arms round 2's window automatically and (via
    // applyAutoReadyOnWindowOpen) marks both ready right away since both
    // are auto-ready - but must not start round 2 until AUTO_READY_GRACE_MS
    // (400ms) after that, i.e. not before the 750ms mark. Checked at 500ms:
    // comfortably past round 1's 350ms resolve, comfortably before the
    // 750ms start - it only needs to still be round 1 by now.
    await wait(500);
    const stateBeforeGrace = await request(app)
      .get(`/api/v1/games/${gameId}/state`)
      .set(authHeader(owner.id, 'user'));
    expect(stateBeforeGrace.body.currentRound.roundId).toBe(round1Id);

    // Comfortably past round 1's resolve (350) + the grace period (400) =
    // 750ms mark, with a wide margin for CI jitter.
    await wait(600);
    const stateAfterGrace = await request(app)
      .get(`/api/v1/games/${gameId}/state`)
      .set(authHeader(owner.id, 'user'));
    expect(stateAfterGrace.body.currentRound).not.toBeNull();
    expect(stateAfterGrace.body.currentRound.roundId).not.toBe(round1Id);
    expect(stateAfterGrace.body.currentRound.sitOutUserIds).toEqual([]);
  });

  it('locking in auto-ready while a window is already open applies it to that window too', async () => {
    const { gameId, owner, other } = await createRunningGame();

    // "other" readies up first, arming the window; owner has not locked in
    // auto-ready yet, so nothing starts.
    await request(app)
      .post(`/api/v1/games/${gameId}/ready`)
      .set(authHeader(other.id, 'user'))
      .send({ ready: true });

    const stateBeforeLock = await request(app)
      .get(`/api/v1/games/${gameId}/state`)
      .set(authHeader(owner.id, 'user'));
    expect(stateBeforeLock.body.currentRound).toBeNull();
    expect(stateBeforeLock.body.roundReadyPhase.startedAt).not.toBeNull();

    // Owner locks in auto-ready mid-window (Variante A) - should count as
    // ready for *this* window immediately, no separate confirmation.
    const lockResponse = await request(app)
      .post(`/api/v1/games/${gameId}/ready/auto`)
      .set(authHeader(owner.id, 'user'))
      .send({ autoReady: true });
    expect(lockResponse.status).toBe(200);

    const stateAfterLock = await request(app)
      .get(`/api/v1/games/${gameId}/state`)
      .set(authHeader(owner.id, 'user'));
    expect(stateAfterLock.body.currentRound).not.toBeNull();
    expect(stateAfterLock.body.currentRound.status).toBe('countdown');
    expect(stateAfterLock.body.currentRound.sitOutUserIds).toEqual([]);
  });

  it('rejects a non-boolean autoReady value', async () => {
    const { gameId, owner } = await createRunningGame();

    const response = await request(app)
      .post(`/api/v1/games/${gameId}/ready/auto`)
      .set(authHeader(owner.id, 'user'))
      .send({ autoReady: 'yes' });
    expect(response.status).toBe(400);
  });
});

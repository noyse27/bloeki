import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db/pool';
import { authHeader, createUserDirect, markSeatReadyDirect, uniqueSuffix } from '../helpers/testUtils';

const app = createApp();

async function createTable(
  ownerId: string,
  overrides: Partial<{
    visibility: 'public' | 'private';
    allowSpectators: boolean;
    maxPlayers: number;
    maxSpectators: number;
  }> = {},
) {
  const response = await request(app)
    .post('/api/v1/tables')
    .set(authHeader(ownerId, 'user'))
    .send({
      name: `Table_${uniqueSuffix()}`,
      visibility: overrides.visibility ?? 'public',
      allowSpectators: overrides.allowSpectators ?? true,
      maxPlayers: overrides.maxPlayers ?? 5,
      maxSpectators: overrides.maxSpectators ?? 10,
    });
  return response.body as { tableId: string; joinCode: string | null };
}

afterAll(async () => {
  await pool.end();
});

describe('table join/leave capacity rules', () => {
  it('blocks further active players once the table is full', async () => {
    const owner = await createUserDirect({});
    const table = await createTable(owner.id, { maxPlayers: 2 });

    const second = await createUserDirect({});
    const joinSecond = await request(app)
      .post(`/api/v1/tables/${table.tableId}/join`)
      .set(authHeader(second.id, 'user'))
      .send({ joinAs: 'player' });
    expect(joinSecond.status).toBe(200);

    const third = await createUserDirect({});
    const joinThird = await request(app)
      .post(`/api/v1/tables/${table.tableId}/join`)
      .set(authHeader(third.id, 'user'))
      .send({ joinAs: 'player' });
    expect(joinThird.status).toBe(409);
    expect(joinThird.body.error).toBe('TABLE_FULL');
  });

  it('rejects spectators when spectating is disabled', async () => {
    const owner = await createUserDirect({});
    const table = await createTable(owner.id, { allowSpectators: false });

    const spectator = await createUserDirect({});
    const response = await request(app)
      .post(`/api/v1/tables/${table.tableId}/join`)
      .set(authHeader(spectator.id, 'user'))
      .send({ joinAs: 'spectator' });

    expect(response.status).toBe(409);
  });

  it('requires the correct join code for private tables', async () => {
    const owner = await createUserDirect({});
    const table = await createTable(owner.id, { visibility: 'private' });

    const joiner = await createUserDirect({});
    const wrongCode = await request(app)
      .post(`/api/v1/tables/${table.tableId}/join`)
      .set(authHeader(joiner.id, 'user'))
      .send({ joinAs: 'player', joinCode: 'WRONG' });
    expect(wrongCode.status).toBe(403);

    const rightCode = await request(app)
      .post(`/api/v1/tables/${table.tableId}/join`)
      .set(authHeader(joiner.id, 'user'))
      .send({ joinAs: 'player', joinCode: table.joinCode });
    expect(rightCode.status).toBe(200);
  });
});

describe('table admin handover (FR-016)', () => {
  it('hands over to the longest-present active player after the reconnect window elapses', async () => {
    const owner = await createUserDirect({});
    const table = await createTable(owner.id);

    const otherPlayer = await createUserDirect({});
    await request(app)
      .post(`/api/v1/tables/${table.tableId}/join`)
      .set(authHeader(otherPlayer.id, 'user'))
      .send({ joinAs: 'player' });

    const leaveResponse = await request(app)
      .post(`/api/v1/tables/${table.tableId}/leave`)
      .set(authHeader(owner.id, 'user'));
    expect(leaveResponse.status).toBe(200);
    expect(leaveResponse.body.ownerReconnectWindowStarted).toBe(true);

    // Simulate the 60s window having elapsed instead of sleeping in the test.
    await pool.query(
      `UPDATE game_table SET owner_left_at = NOW() - INTERVAL '61 seconds' WHERE id = $1`,
      [table.tableId],
    );

    const detail = await request(app)
      .get(`/api/v1/tables/${table.tableId}`)
      .set(authHeader(otherPlayer.id, 'user'));

    expect(detail.status).toBe(200);
    expect(detail.body.ownerUserId).toBe(otherPlayer.id);
    expect(detail.body.ownerReconnectDeadlinePending).toBe(false);
  });

  it('cancels the handover if the owner rejoins within the window', async () => {
    const owner = await createUserDirect({});
    const table = await createTable(owner.id);

    const otherPlayer = await createUserDirect({});
    await request(app)
      .post(`/api/v1/tables/${table.tableId}/join`)
      .set(authHeader(otherPlayer.id, 'user'))
      .send({ joinAs: 'player' });

    await request(app)
      .post(`/api/v1/tables/${table.tableId}/leave`)
      .set(authHeader(owner.id, 'user'));

    const rejoin = await request(app)
      .post(`/api/v1/tables/${table.tableId}/join`)
      .set(authHeader(owner.id, 'user'))
      .send({ joinAs: 'player' });
    expect(rejoin.status).toBe(200);

    const detail = await request(app)
      .get(`/api/v1/tables/${table.tableId}`)
      .set(authHeader(owner.id, 'user'));

    expect(detail.body.ownerUserId).toBe(owner.id);
    expect(detail.body.ownerReconnectDeadlinePending).toBe(false);
  });
});

describe('table start conditions (FR-020)', () => {

  it('refuses to start with fewer than 2 active players', async () => {
    const owner = await createUserDirect({});
    const table = await createTable(owner.id);

    const response = await request(app)
      .post(`/api/v1/tables/${table.tableId}/start`)
      .set(authHeader(owner.id, 'user'));

    expect(response.status).toBe(400);
  });

  it('refuses to let a non-owner start the table', async () => {
    const owner = await createUserDirect({});
    const table = await createTable(owner.id);
    const otherPlayer = await createUserDirect({});
    await request(app)
      .post(`/api/v1/tables/${table.tableId}/join`)
      .set(authHeader(otherPlayer.id, 'user'))
      .send({ joinAs: 'player' });

    const response = await request(app)
      .post(`/api/v1/tables/${table.tableId}/start`)
      .set(authHeader(otherPlayer.id, 'user'));

    expect(response.status).toBe(403);
  });

  it('starts the game with 2 active players and moves the table to running', async () => {
    const owner = await createUserDirect({});
    const table = await createTable(owner.id);
    const otherPlayer = await createUserDirect({});
    await request(app)
      .post(`/api/v1/tables/${table.tableId}/join`)
      .set(authHeader(otherPlayer.id, 'user'))
      .send({ joinAs: 'player' });

    await markSeatReadyDirect(table.tableId, owner.id);
    await markSeatReadyDirect(table.tableId, otherPlayer.id);

    const startResponse = await request(app)
      .post(`/api/v1/tables/${table.tableId}/start`)
      .set(authHeader(owner.id, 'user'));

    expect(startResponse.status).toBe(200);
    expect(startResponse.body).toHaveProperty('gameId');
    expect(startResponse.body).toHaveProperty('tableSessionId');

    const detail = await request(app)
      .get(`/api/v1/tables/${table.tableId}`)
      .set(authHeader(owner.id, 'user'));
    expect(detail.body.state).toBe('running');

    const lateJoiner = await createUserDirect({});
    const lateJoin = await request(app)
      .post(`/api/v1/tables/${table.tableId}/join`)
      .set(authHeader(lateJoiner.id, 'user'))
      .send({ joinAs: 'player' });
    expect(lateJoin.status).toBe(409);
  });
});

describe('table start readiness gate', () => {
  it('refuses to start via POST /start if not every seated player is ready', async () => {
    const owner = await createUserDirect({});
    const table = await createTable(owner.id, { maxPlayers: 3 });
    const otherPlayer = await createUserDirect({});
    await request(app)
      .post(`/api/v1/tables/${table.tableId}/join`)
      .set(authHeader(otherPlayer.id, 'user'))
      .send({ joinAs: 'player' });

    await markSeatReadyDirect(table.tableId, owner.id);
    // otherPlayer never marked ready.

    const response = await request(app)
      .post(`/api/v1/tables/${table.tableId}/start`)
      .set(authHeader(owner.id, 'user'));

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('NOT_ALL_PLAYERS_READY');
  });

  it('lets the admin force an early start once everyone seated is ready, below the configured max', async () => {
    const owner = await createUserDirect({});
    const table = await createTable(owner.id, { maxPlayers: 4 });
    const otherPlayer = await createUserDirect({});
    await request(app)
      .post(`/api/v1/tables/${table.tableId}/join`)
      .set(authHeader(otherPlayer.id, 'user'))
      .send({ joinAs: 'player' });

    await markSeatReadyDirect(table.tableId, owner.id);
    await markSeatReadyDirect(table.tableId, otherPlayer.id);

    const response = await request(app)
      .post(`/api/v1/tables/${table.tableId}/start`)
      .set(authHeader(owner.id, 'user'));

    expect(response.status).toBe(200);
  });

  it('auto-starts via POST /ready once the configured player count is reached and everyone is ready', async () => {
    const owner = await createUserDirect({});
    const table = await createTable(owner.id, { maxPlayers: 2 });
    const otherPlayer = await createUserDirect({});
    await request(app)
      .post(`/api/v1/tables/${table.tableId}/join`)
      .set(authHeader(otherPlayer.id, 'user'))
      .send({ joinAs: 'player' });

    const firstReady = await request(app)
      .post(`/api/v1/tables/${table.tableId}/ready`)
      .set(authHeader(owner.id, 'user'))
      .send({ ready: true });
    expect(firstReady.status).toBe(200);
    expect(firstReady.body.started).toBe(false);

    const secondReady = await request(app)
      .post(`/api/v1/tables/${table.tableId}/ready`)
      .set(authHeader(otherPlayer.id, 'user'))
      .send({ ready: true });
    expect(secondReady.status).toBe(200);
    expect(secondReady.body.started).toBe(true);
    expect(secondReady.body).toHaveProperty('gameId');

    const detail = await request(app)
      .get(`/api/v1/tables/${table.tableId}`)
      .set(authHeader(owner.id, 'user'));
    expect(detail.body.state).toBe('running');
  });
});

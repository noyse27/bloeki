import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db/pool';
import { authHeader, createUserDirect, uniqueSuffix } from '../helpers/testUtils';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

describe('table creation and lobby listing', () => {
  it('creates a public table and seats the creator as a player', async () => {
    const owner = await createUserDirect({});

    const response = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: `Freitagsrunde_${uniqueSuffix()}`, visibility: 'public' });

    expect(response.status).toBe(201);
    expect(response.body.joinCode).toBeNull();

    const seat = await pool.query(
      'SELECT seat_type FROM table_seat WHERE table_id = $1 AND user_id = $2',
      [response.body.tableId, owner.id],
    );
    expect(seat.rows[0].seat_type).toBe('player');
  });

  it('lists open public tables in the lobby but not private ones', async () => {
    const owner = await createUserDirect({});
    const publicName = `PublicTable_${uniqueSuffix()}`;
    const privateName = `PrivateTable_${uniqueSuffix()}`;

    await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: publicName, visibility: 'public' });

    const privateResponse = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: privateName, visibility: 'private' });

    expect(privateResponse.body.joinCode).not.toBeNull();

    const lobby = await request(app)
      .get('/api/v1/tables/lobby')
      .set(authHeader(owner.id, 'user'));

    const names = lobby.body.tables.map((t: { name: string }) => t.name);
    expect(names).toContain(publicName);
    expect(names).not.toContain(privateName);

    const publicEntry = lobby.body.tables.find((t: { name: string }) => t.name === publicName);
    expect(publicEntry.activePlayers).toBe(1);
  });

  it('rejects an invalid visibility value', async () => {
    const owner = await createUserDirect({});

    const response = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: 'Bad table', visibility: 'nonsense' });

    expect(response.status).toBe(400);
  });

  it('rejects a negative minKarmaPoints/minScorePoints/minGamesPlayed', async () => {
    const owner = await createUserDirect({});

    const response = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: `Table_${uniqueSuffix()}`, visibility: 'public', minKarmaPoints: -1 });

    expect(response.status).toBe(400);
  });

  it('persists player-join requirements set at creation', async () => {
    const owner = await createUserDirect({});

    const response = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({
        name: `Table_${uniqueSuffix()}`,
        visibility: 'public',
        minKarmaPoints: 10,
        minScorePoints: 20,
        minGamesPlayed: 3,
      });

    expect(response.status).toBe(201);
    const row = await pool.query(
      'SELECT min_karma_points, min_score_points, min_games_played FROM game_table WHERE id = $1',
      [response.body.tableId],
    );
    expect(row.rows[0]).toEqual({ min_karma_points: 10, min_score_points: 20, min_games_played: 3 });
  });
});

describe('player-join requirements (min karma/score/games)', () => {
  it('defaults to no requirement (null), not zero - a brand-new player can join any table', async () => {
    const owner = await createUserDirect({});
    const newcomer = await createUserDirect({}); // karma_points/score_points/games_played all default to 0

    const table = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: `Table_${uniqueSuffix()}`, visibility: 'public' });
    const tableId = table.body.tableId;

    const row = await pool.query(
      'SELECT min_karma_points, min_score_points, min_games_played FROM game_table WHERE id = $1',
      [tableId],
    );
    expect(row.rows[0]).toEqual({ min_karma_points: null, min_score_points: null, min_games_played: null });

    const playerJoin = await request(app)
      .post(`/api/v1/tables/${tableId}/join`)
      .set(authHeader(newcomer.id, 'user'))
      .send({ joinAs: 'player' });
    expect(playerJoin.status).toBe(200);
    expect(playerJoin.body.seatType).toBe('player');
  });

  it('rejects a player join below the table minimums but still allows spectating', async () => {
    const owner = await createUserDirect({});
    const applicant = await createUserDirect({});

    const table = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: `Table_${uniqueSuffix()}`, visibility: 'public', minKarmaPoints: 50 });
    const tableId = table.body.tableId;

    const playerJoin = await request(app)
      .post(`/api/v1/tables/${tableId}/join`)
      .set(authHeader(applicant.id, 'user'))
      .send({ joinAs: 'player' });
    expect(playerJoin.status).toBe(403);
    expect(playerJoin.body.error).toBe('PLAYER_REQUIREMENTS_NOT_MET');

    const spectatorJoin = await request(app)
      .post(`/api/v1/tables/${tableId}/join`)
      .set(authHeader(applicant.id, 'user'))
      .send({ joinAs: 'spectator' });
    expect(spectatorJoin.status).toBe(200);
    expect(spectatorJoin.body.seatType).toBe('spectator');
  });

  it('allows a player join once the minimums are met', async () => {
    const owner = await createUserDirect({});
    const applicant = await createUserDirect({});
    await pool.query('UPDATE app_user SET karma_points = 50, score_points = 20, games_played = 3 WHERE id = $1', [
      applicant.id,
    ]);

    const table = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({
        name: `Table_${uniqueSuffix()}`,
        visibility: 'public',
        minKarmaPoints: 50,
        minScorePoints: 20,
        minGamesPlayed: 3,
      });
    const tableId = table.body.tableId;

    const playerJoin = await request(app)
      .post(`/api/v1/tables/${tableId}/join`)
      .set(authHeader(applicant.id, 'user'))
      .send({ joinAs: 'player' });
    expect(playerJoin.status).toBe(200);
    expect(playerJoin.body.seatType).toBe('player');
  });
});

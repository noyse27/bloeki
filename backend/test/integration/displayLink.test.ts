import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db/pool';
import { authHeader, createUserDirect, uniqueSuffix } from '../helpers/testUtils';

const app = createApp();

async function createTable(ownerId: string, visibility: 'private' | 'public' = 'private') {
  const response = await request(app)
    .post('/api/v1/tables')
    .set(authHeader(ownerId, 'user'))
    .send({ name: `Table_${uniqueSuffix()}`, visibility });
  return response.body as { tableId: string; joinCode: string };
}

afterAll(async () => {
  await pool.end();
});

describe('Hostmodus display link', () => {
  it('lets a seated player mint a display token and read the table through it without a login', async () => {
    const owner = await createUserDirect({});
    const table = await createTable(owner.id);

    const issue = await request(app)
      .post(`/api/v1/tables/${table.tableId}/display-link`)
      .set(authHeader(owner.id, 'user'));
    expect(issue.status).toBe(200);
    const { displayToken } = issue.body as { displayToken: string };
    expect(typeof displayToken).toBe('string');

    // No Authorization header at all - this is the whole point: the display
    // device is not logged in as anyone.
    const read = await request(app).get(`/api/v1/tables/display/${displayToken}`);
    expect(read.status).toBe(200);
    expect(read.body.tableId).toBe(table.tableId);
    expect(read.body.joinCode).toBe(table.joinCode);
  });

  it('rejects minting a display link for someone not seated at the table', async () => {
    const owner = await createUserDirect({});
    const table = await createTable(owner.id);
    const stranger = await createUserDirect({});

    const issue = await request(app)
      .post(`/api/v1/tables/${table.tableId}/display-link`)
      .set(authHeader(stranger.id, 'user'));
    expect(issue.status).toBe(403);
  });

  it('rejects minting a display link for a seated player who is not the owner', async () => {
    const owner = await createUserDirect({});
    const table = await createTable(owner.id, 'private');
    const player = await createUserDirect({});

    await request(app)
      .post(`/api/v1/tables/${table.tableId}/join`)
      .set(authHeader(player.id, 'user'))
      .send({ joinAs: 'player', joinCode: table.joinCode });

    const issue = await request(app)
      .post(`/api/v1/tables/${table.tableId}/display-link`)
      .set(authHeader(player.id, 'user'));
    expect(issue.status).toBe(403);
  });

  it('rejects minting a display link for a public table, even for its owner', async () => {
    const owner = await createUserDirect({});
    const table = await createTable(owner.id, 'public');

    const issue = await request(app)
      .post(`/api/v1/tables/${table.tableId}/display-link`)
      .set(authHeader(owner.id, 'user'));
    expect(issue.status).toBe(403);
  });

  it('rejects a garbage or expired-looking display token on the read endpoint', async () => {
    const read = await request(app).get('/api/v1/tables/display/not-a-real-token');
    expect(read.status).toBe(401);
  });

  it('does not disturb a concurrent player session on the same table (the original bug this replaces)', async () => {
    const owner = await createUserDirect({});
    const table = await createTable(owner.id);

    const issue = await request(app)
      .post(`/api/v1/tables/${table.tableId}/display-link`)
      .set(authHeader(owner.id, 'user'));
    const { displayToken } = issue.body as { displayToken: string };

    // Minting/using the display token must not touch app_user.session_version
    // (see socketServer.ts's io.use branch) - the owner's own normal
    // Bearer token must keep working exactly as before.
    await request(app).get(`/api/v1/tables/display/${displayToken}`);

    const ownerStillWorks = await request(app)
      .get(`/api/v1/tables/${table.tableId}`)
      .set(authHeader(owner.id, 'user'));
    expect(ownerStillWorks.status).toBe(200);
  });
});

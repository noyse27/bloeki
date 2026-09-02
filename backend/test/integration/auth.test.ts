import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db/pool';

const app = createApp();

async function createInvite(): Promise<{ code: string }> {
  const adminResult = await pool.query(
    `INSERT INTO app_user (username, email, password_hash, role)
     VALUES ($1, $2, 'x', 'admin')
     RETURNING id`,
    [`admin_${Date.now()}`, `admin_${Date.now()}@example.test`],
  );
  const adminId = adminResult.rows[0].id;

  const code = `invite_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await pool.query(
    `INSERT INTO invite_token (code, created_by, max_uses)
     VALUES ($1, $2, 1)`,
    [code, adminId],
  );

  return { code };
}

describe('POST /api/v1/auth/register', () => {
  it('rejects registration with an unknown invite code', async () => {
    const response = await request(app).post('/api/v1/auth/register').send({
      username: 'someone',
      email: 'someone@example.test',
      password: 'correct horse battery staple',
      inviteCode: 'does-not-exist',
    });

    expect(response.status).toBe(400);
  });

  it('creates a user and consumes the invite on valid registration', async () => {
    const { code } = await createInvite();

    const response = await request(app).post('/api/v1/auth/register').send({
      username: `player_${Date.now()}`,
      email: `player_${Date.now()}@example.test`,
      password: 'correct horse battery staple',
      inviteCode: code,
    });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('userId');

    const inviteRow = await pool.query('SELECT used_count FROM invite_token WHERE code = $1', [code]);
    expect(inviteRow.rows[0].used_count).toBe(1);
  });

  it('rejects a second registration attempt on an exhausted invite', async () => {
    const { code } = await createInvite();

    await request(app).post('/api/v1/auth/register').send({
      username: `first_${Date.now()}`,
      email: `first_${Date.now()}@example.test`,
      password: 'correct horse battery staple',
      inviteCode: code,
    });

    const secondResponse = await request(app).post('/api/v1/auth/register').send({
      username: `second_${Date.now()}`,
      email: `second_${Date.now()}@example.test`,
      password: 'correct horse battery staple',
      inviteCode: code,
    });

    expect(secondResponse.status).toBe(400);
  });
});

describe('POST /api/v1/auth/login (single-active-session)', () => {
  afterAll(async () => {
    await pool.end();
  });

  async function registerAndReturnCredentials(): Promise<{ username: string; password: string }> {
    const { code } = await createInvite();
    const username = `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const password = 'correct horse battery staple';
    await request(app).post('/api/v1/auth/register').send({
      username,
      email: `${username}@example.test`,
      password,
      inviteCode: code,
    });
    return { username, password };
  }

  it('invalidates the previous device\'s token as soon as a second login happens', async () => {
    const { username, password } = await registerAndReturnCredentials();

    const firstLogin = await request(app).post('/api/v1/auth/login').send({ usernameOrEmail: username, password });
    const firstToken = firstLogin.body.accessToken;

    // The first token works until a second login happens.
    const beforeSecondLogin = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${firstToken}`);
    expect(beforeSecondLogin.status).toBe(200);

    const secondLogin = await request(app).post('/api/v1/auth/login').send({ usernameOrEmail: username, password });
    const secondToken = secondLogin.body.accessToken;
    expect(secondToken).not.toBe(firstToken);

    // FR: only one active session per player - the first device's token is
    // now treated the same as an expired one.
    const afterSecondLogin = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${firstToken}`);
    expect(afterSecondLogin.status).toBe(401);

    // The new device's token works normally.
    const withSecondToken = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${secondToken}`);
    expect(withSecondToken.status).toBe(200);
  });

  it('still allows logging in again even though a previous session was never cleanly logged out (rejoin after a dead device)', async () => {
    const { username, password } = await registerAndReturnCredentials();

    await request(app).post('/api/v1/auth/login').send({ usernameOrEmail: username, password });
    // Simulates the original device going dark (crashed/lost) rather than
    // logging out - a second, then third login must still succeed and work,
    // so nobody is permanently locked out of their own account.
    const thirdLogin = await request(app).post('/api/v1/auth/login').send({ usernameOrEmail: username, password });
    expect(thirdLogin.status).toBe(200);

    const meResponse = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${thirdLogin.body.accessToken}`);
    expect(meResponse.status).toBe(200);
  });
});

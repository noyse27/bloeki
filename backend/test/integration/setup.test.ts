import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db/pool';
import { uniqueSuffix } from '../helpers/testUtils';
import { getSetupTokenForTests } from '../../src/services/setupToken';

const app = createApp();

describe('POST /api/v1/setup/bootstrap', () => {
  beforeAll(async () => {
    // Runs order-independent of other integration test files: force a
    // clean slate for the single-admin invariant this endpoint enforces.
    await pool.query('TRUNCATE TABLE app_user RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('rejects bootstrap without a valid setup token', async () => {
    const suffix = uniqueSuffix();
    const response = await request(app).post('/api/v1/setup/bootstrap').send({
      username: `admin_${suffix}`,
      email: `admin_${suffix}@example.test`,
      password: 'correct horse battery staple',
      setupToken: 'not-the-real-token',
    });

    expect(response.status).toBe(403);
  });

  it('creates the first admin account with the correct setup token', async () => {
    const suffix = uniqueSuffix();
    const response = await request(app).post('/api/v1/setup/bootstrap').send({
      username: `admin_${suffix}`,
      email: `admin_${suffix}@example.test`,
      password: 'correct horse battery staple',
      setupToken: getSetupTokenForTests(),
    });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('userId');

    const row = await pool.query('SELECT role, can_create_invites FROM app_user WHERE id = $1', [
      response.body.userId,
    ]);
    expect(row.rows[0].role).toBe('admin');
    expect(row.rows[0].can_create_invites).toBe(true);
  });

  it('refuses to bootstrap a second admin - the setup token is single-use', async () => {
    const suffix = uniqueSuffix();
    const response = await request(app).post('/api/v1/setup/bootstrap').send({
      username: `second_admin_${suffix}`,
      email: `second_admin_${suffix}@example.test`,
      password: 'correct horse battery staple',
    });

    expect(response.status).toBe(403);
  });
});

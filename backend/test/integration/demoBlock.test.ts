import request from 'supertest';
import { pool } from '../../src/db/pool';
import { authHeader, createUserDirect } from '../helpers/testUtils';

// DEMO_MODE (config/demoMode.ts) is read once at module load, same
// convention as JWT_SECRET - so the app under test here must be built
// inside jest.isolateModules with the env var already set, in a registry
// separate from every other integration test file (which run with
// DEMO_MODE unset).
function buildDemoApp() {
  let app: import('express').Express;
  jest.isolateModules(() => {
    process.env.DEMO_MODE = 'true';
    // Needs the isolated module registry jest.isolateModules just created -
    // a static import would use the already-cached (DEMO_MODE-less) module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createApp } = require('../../src/app');
    app = createApp();
  });
  delete process.env.DEMO_MODE;
  return app!;
}

describe('demo mode blocks destructive admin actions', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('blocks revoking a user\'s invite permission', async () => {
    const app = buildDemoApp();
    const admin = await createUserDirect({ role: 'admin' });
    const target = await createUserDirect({});

    const response = await request(app)
      .post(`/api/v1/admin/users/${target.id}/invite-permission`)
      .set(authHeader(admin.id, 'admin'))
      .send({ canCreateInvites: true });

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/disabled in demo mode/);
  });

  it('blocks deleting a table', async () => {
    const app = buildDemoApp();
    const admin = await createUserDirect({ role: 'admin' });
    const owner = await createUserDirect({});
    const table = await pool.query(
      `INSERT INTO game_table (owner_user_id, name, visibility) VALUES ($1, 'Demo table', 'public') RETURNING id`,
      [owner.id],
    );

    const response = await request(app)
      .delete(`/api/v1/admin/tables/${table.rows[0].id}`)
      .set(authHeader(admin.id, 'admin'));

    expect(response.status).toBe(403);
  });

  it('still allows read-only admin endpoints', async () => {
    const app = buildDemoApp();
    const admin = await createUserDirect({ role: 'admin' });

    const response = await request(app).get('/api/v1/admin/users').set(authHeader(admin.id, 'admin'));

    expect(response.status).toBe(200);
  });

  it('reports itself as active on the public demo status endpoint', async () => {
    const app = buildDemoApp();

    const response = await request(app).get('/api/v1/demo/status');

    expect(response.status).toBe(200);
    expect(response.body.active).toBe(true);
    expect(response.body).toHaveProperty('standingInviteCode');
  });
});

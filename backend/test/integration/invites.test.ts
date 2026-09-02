import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db/pool';
import { authHeader, createUserDirect } from '../helpers/testUtils';

const app = createApp();

describe('invite creation and quota rules', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('lets an admin create invites without a quota limit', async () => {
    const admin = await createUserDirect({ role: 'admin' });

    for (let i = 0; i < 5; i += 1) {
      const response = await request(app)
        .post('/api/v1/invites')
        .set(authHeader(admin.id, 'admin'))
        .send({});
      expect(response.status).toBe(201);
    }
  });

  it('rejects invite creation for a user without the delegated right', async () => {
    const plainUser = await createUserDirect({ canCreateInvites: false });

    const response = await request(app)
      .post('/api/v1/invites')
      .set(authHeader(plainUser.id, 'user'))
      .send({});

    expect(response.status).toBe(403);
  });

  it('caps a delegated user at 3 invites per month', async () => {
    const delegatedUser = await createUserDirect({ canCreateInvites: true });

    for (let i = 0; i < 3; i += 1) {
      const response = await request(app)
        .post('/api/v1/invites')
        .set(authHeader(delegatedUser.id, 'user'))
        .send({});
      expect(response.status).toBe(201);
    }

    const fourthResponse = await request(app)
      .post('/api/v1/invites')
      .set(authHeader(delegatedUser.id, 'user'))
      .send({});

    expect(fourthResponse.status).toBe(429);
  });

  it('scopes GET /invites to own invites for non-admins', async () => {
    const admin = await createUserDirect({ role: 'admin' });
    const delegatedUser = await createUserDirect({ canCreateInvites: true });

    await request(app).post('/api/v1/invites').set(authHeader(admin.id, 'admin')).send({});
    await request(app)
      .post('/api/v1/invites')
      .set(authHeader(delegatedUser.id, 'user'))
      .send({});

    const userView = await request(app)
      .get('/api/v1/invites')
      .set(authHeader(delegatedUser.id, 'user'));

    expect(userView.status).toBe(200);
    expect(
      userView.body.invites.every((inv: { createdByUsername: string }) =>
        inv.createdByUsername === delegatedUser.username,
      ),
    ).toBe(true);
  });

  it('lets the creator disable their own invite but not someone else\'s', async () => {
    const ownerUser = await createUserDirect({ canCreateInvites: true });
    const otherUser = await createUserDirect({ canCreateInvites: true });

    const createResponse = await request(app)
      .post('/api/v1/invites')
      .set(authHeader(ownerUser.id, 'user'))
      .send({});
    const inviteId = createResponse.body.inviteId;

    const forbiddenDisable = await request(app)
      .post(`/api/v1/invites/${inviteId}/disable`)
      .set(authHeader(otherUser.id, 'user'));
    expect(forbiddenDisable.status).toBe(404);

    const ownDisable = await request(app)
      .post(`/api/v1/invites/${inviteId}/disable`)
      .set(authHeader(ownerUser.id, 'user'));
    expect(ownDisable.status).toBe(200);
  });
});

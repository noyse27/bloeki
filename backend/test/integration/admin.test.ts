import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db/pool';
import { authHeader, createInviteDirect, createUserDirect } from '../helpers/testUtils';

const app = createApp();

describe('admin invite management', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('blocks non-admins from admin routes', async () => {
    const plainUser = await createUserDirect({});

    const response = await request(app)
      .post(`/api/v1/admin/users/${plainUser.id}/invite-permission`)
      .set(authHeader(plainUser.id, 'user'))
      .send({ canCreateInvites: true });

    expect(response.status).toBe(403);
  });

  it('grants and revokes the invite-creation right', async () => {
    const admin = await createUserDirect({ role: 'admin' });
    const targetUser = await createUserDirect({});

    const grantResponse = await request(app)
      .post(`/api/v1/admin/users/${targetUser.id}/invite-permission`)
      .set(authHeader(admin.id, 'admin'))
      .send({ canCreateInvites: true });
    expect(grantResponse.status).toBe(200);
    expect(grantResponse.body.canCreateInvites).toBe(true);

    const revokeResponse = await request(app)
      .post(`/api/v1/admin/users/${targetUser.id}/invite-permission`)
      .set(authHeader(admin.id, 'admin'))
      .send({ canCreateInvites: false });
    expect(revokeResponse.status).toBe(200);
    expect(revokeResponse.body.canCreateInvites).toBe(false);
  });

  it('cascades revoke to invalidate invites and deactivate registered users', async () => {
    const admin = await createUserDirect({ role: 'admin' });
    const delegatedUser = await createUserDirect({ canCreateInvites: true });
    const invite = await createInviteDirect(delegatedUser.id);

    const registeredUser = await createUserDirect({});
    await pool.query('UPDATE app_user SET registered_via_invite_id = $1 WHERE id = $2', [
      invite.id,
      registeredUser.id,
    ]);

    const response = await request(app)
      .post(`/api/v1/admin/users/${delegatedUser.id}/revoke-invites`)
      .set(authHeader(admin.id, 'admin'))
      .send({ invalidateCreatedInvites: true, deactivateRegisteredUsers: true });

    expect(response.status).toBe(200);
    expect(response.body.invalidatedInviteCount).toBe(1);
    expect(response.body.deactivatedUserCount).toBe(1);

    const inviteRow = await pool.query('SELECT disabled_at FROM invite_token WHERE id = $1', [
      invite.id,
    ]);
    expect(inviteRow.rows[0].disabled_at).not.toBeNull();

    const userRow = await pool.query('SELECT status FROM app_user WHERE id = $1', [
      registeredUser.id,
    ]);
    expect(userRow.rows[0].status).toBe('blocked');
  });

  it('resets a user\'s monthly invite quota', async () => {
    const admin = await createUserDirect({ role: 'admin' });
    const delegatedUser = await createUserDirect({ canCreateInvites: true });

    for (let i = 0; i < 3; i += 1) {
      await request(app).post('/api/v1/invites').set(authHeader(delegatedUser.id, 'user')).send({});
    }
    const exhausted = await request(app)
      .post('/api/v1/invites')
      .set(authHeader(delegatedUser.id, 'user'))
      .send({});
    expect(exhausted.status).toBe(429);

    const resetResponse = await request(app)
      .post(`/api/v1/admin/users/${delegatedUser.id}/reset-invite-quota`)
      .set(authHeader(admin.id, 'admin'));
    expect(resetResponse.status).toBe(200);

    const afterReset = await request(app)
      .post('/api/v1/invites')
      .set(authHeader(delegatedUser.id, 'user'))
      .send({});
    expect(afterReset.status).toBe(201);
  });

  it('lists invites with creator and registered users in the admin log', async () => {
    const admin = await createUserDirect({ role: 'admin' });
    const delegatedUser = await createUserDirect({ canCreateInvites: true });
    const invite = await createInviteDirect(delegatedUser.id);

    const registeredUser = await createUserDirect({});
    await pool.query('UPDATE app_user SET registered_via_invite_id = $1 WHERE id = $2', [
      invite.id,
      registeredUser.id,
    ]);

    const response = await request(app)
      .get('/api/v1/admin/invites/log')
      .set(authHeader(admin.id, 'admin'));

    expect(response.status).toBe(200);
    const entry = response.body.entries.find(
      (e: { inviteId: string }) => e.inviteId === invite.id,
    );
    expect(entry).toBeDefined();
    expect(entry.creatorUsername).toBe(delegatedUser.username);
    expect(entry.registeredUsernames).toContain(registeredUser.username);
  });

  // removed: bloeki has no Adolar playlist integration (no game_playlist
  // table, no /admin/playlists/search route) - trailers come from a local
  // scan (see trailerScan.ts), there is nothing to suggest by id prefix.
});

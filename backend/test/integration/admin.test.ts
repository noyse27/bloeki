import request from 'supertest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
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

  it('stores and immediately scans an editable trailer library path', async () => {
    const admin = await createUserDirect({ role: 'admin' });
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bloeki-trailers-'));
    const clip = path.join(directory, 'trailer-Testfilm (1981) {imdb-id tt1234567}.mp4');
    await fs.writeFile(clip, 'test');
    await pool.query(`DELETE FROM system_setting WHERE key = 'trailer_clip_dir'`);

    try {
      const response = await request(app)
        .put('/api/v1/admin/trailers/library')
        .set(authHeader(admin.id, 'admin'))
        .send({ path: directory });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        configured: true,
        path: directory,
        hostPath: null,
        source: 'database',
        editable: true,
        readable: true,
      });
      expect(response.body.scan.scanned).toBe(1);

      const trailer = await pool.query(`SELECT clip_path FROM trailer_ref WHERE imdb_id = 'tt1234567'`);
      expect(trailer.rows[0].clip_path).toBe(clip);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
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

  it('finds a trailer playlist by id prefix and returns its played trailers', async () => {
    const admin = await createUserDirect({ role: 'admin' });
    const playlist = await pool.query(
      `INSERT INTO game_trailer_playlist (table_id, table_name, game_id)
       VALUES (gen_random_uuid(), 'Testkino', gen_random_uuid()) RETURNING id`,
    );
    await pool.query(
      `INSERT INTO game_trailer_playlist_item
         (playlist_id, position, imdb_id, title, year_value)
       VALUES ($1, 1, 'tt9669176', 'Accident Man - Hitman''s Holiday', 2022)`,
      [playlist.rows[0].id],
    );
    const prefix = String(playlist.rows[0].id).slice(0, 8);

    const suggestions = await request(app)
      .get(`/api/v1/admin/trailer-playlists/search?prefix=${prefix}`)
      .set(authHeader(admin.id, 'admin'));
    expect(suggestions.status).toBe(200);
    expect(suggestions.body.playlists).toEqual(expect.arrayContaining([
      expect.objectContaining({ playlistId: playlist.rows[0].id, tableName: 'Testkino' }),
    ]));

    const details = await request(app)
      .get(`/api/v1/admin/trailer-playlists/${playlist.rows[0].id}`)
      .set(authHeader(admin.id, 'admin'));
    expect(details.status).toBe(200);
    expect(details.body.trailers).toEqual([
      expect.objectContaining({ position: 1, imdbId: 'tt9669176', title: "Accident Man - Hitman's Holiday", year: 2022 }),
    ]);
  });
});

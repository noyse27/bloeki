import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db/pool';
import { authHeader, createUserDirect, uniqueSuffix } from '../helpers/testUtils';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

describe('player communication', () => {
  it('lets only admins configure filtering, emoticons and phase reactions', async () => {
    const admin = await createUserDirect({ role: 'admin' });
    const user = await createUserDirect({});
    const initial = await request(app)
      .get('/api/v1/admin/communication-settings')
      .set(authHeader(admin.id, 'admin'));
    expect(initial.status).toBe(200);
    expect(initial.body.catalog.some((asset: { id: string }) => asset.id === 'dance')).toBe(true);
    expect(initial.body.reactions.waiting.length).toBeLessThanOrEqual(8);

    const forbidden = await request(app)
      .get('/api/v1/admin/communication-settings')
      .set(authHeader(user.id, 'user'));
    expect(forbidden.status).toBe(403);

    const configured = await request(app)
      .put('/api/v1/admin/communication-settings')
      .set(authHeader(admin.id, 'admin'))
      .send({
        textChat: { autoConvertEmoticons: true, blockedWords: ['Mist'] },
        reactions: initial.body.reactions,
      });
    expect(configured.status).toBe(200);

    const message = await request(app)
      .post('/api/v1/communications/lobby/messages')
      .set(authHeader(user.id, 'user'))
      .send({ body: 'So ein Mist :D' });
    expect(message.status).toBe(201);
    expect(message.body.message.body).toBe('So ein *piep* 😄');

    await request(app)
      .put('/api/v1/admin/communication-settings')
      .set(authHeader(admin.id, 'admin'))
      .send({
        textChat: { autoConvertEmoticons: false, blockedWords: [] },
        reactions: initial.body.defaultReactions,
      });
  });

  it('stores and returns lobby messages without exposing markup as a separate field', async () => {
    const sender = await createUserDirect({});
    const body = '<img src=x onerror=alert(1)> Hallo';

    const created = await request(app)
      .post('/api/v1/communications/lobby/messages')
      .set(authHeader(sender.id, 'user'))
      .send({ body });

    expect(created.status).toBe(201);
    expect(created.body.message).toMatchObject({
      scope: 'lobby',
      tableId: null,
      senderUserId: sender.id,
      senderUsername: sender.username,
      body,
    });

    const history = await request(app)
      .get('/api/v1/communications/lobby/messages')
      .set(authHeader(sender.id, 'user'));
    expect(history.status).toBe(200);
    expect(history.body.messages.some((message: { id: string }) => message.id === created.body.message.id)).toBe(true);
  });

  it('rejects empty and oversized chat messages', async () => {
    const sender = await createUserDirect({});
    const empty = await request(app)
      .post('/api/v1/communications/lobby/messages')
      .set(authHeader(sender.id, 'user'))
      .send({ body: '   ' });
    const oversized = await request(app)
      .post('/api/v1/communications/lobby/messages')
      .set(authHeader(sender.id, 'user'))
      .send({ body: 'x'.repeat(501) });

    expect(empty.status).toBe(400);
    expect(oversized.status).toBe(400);
  });

  it('keeps table chat private to active players and spectators', async () => {
    const owner = await createUserDirect({});
    const spectator = await createUserDirect({});
    const stranger = await createUserDirect({});
    const tableResponse = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: `Chat_${uniqueSuffix()}`, visibility: 'public' });
    const tableId = tableResponse.body.tableId as string;

    await request(app)
      .post(`/api/v1/tables/${tableId}/join`)
      .set(authHeader(spectator.id, 'user'))
      .send({ joinAs: 'spectator' });

    const created = await request(app)
      .post(`/api/v1/tables/${tableId}/messages`)
      .set(authHeader(owner.id, 'user'))
      .send({ body: 'Nur für unseren Tisch' });
    expect(created.status).toBe(201);

    const spectatorHistory = await request(app)
      .get(`/api/v1/tables/${tableId}/messages`)
      .set(authHeader(spectator.id, 'user'));
    expect(spectatorHistory.status).toBe(200);
    expect(spectatorHistory.body.messages).toHaveLength(1);

    const strangerRead = await request(app)
      .get(`/api/v1/tables/${tableId}/messages`)
      .set(authHeader(stranger.id, 'user'));
    const strangerWrite = await request(app)
      .post(`/api/v1/tables/${tableId}/messages`)
      .set(authHeader(stranger.id, 'user'))
      .send({ body: 'Ich gehöre nicht hierher' });
    expect(strangerRead.status).toBe(404);
    expect(strangerWrite.status).toBe(404);
  });

  it('hides messages older than the 30-minute retention window', async () => {
    const sender = await createUserDirect({});
    await pool.query(
      `INSERT INTO chat_message (scope, sender_user_id, body, created_at)
       VALUES ('lobby', $1, 'zu alt', NOW() - INTERVAL '31 minutes')`,
      [sender.id],
    );

    const history = await request(app)
      .get('/api/v1/communications/lobby/messages')
      .set(authHeader(sender.id, 'user'));
    expect(history.status).toBe(200);
    expect(history.body.messages.some((message: { body: string }) => message.body === 'zu alt')).toBe(false);
  });
});

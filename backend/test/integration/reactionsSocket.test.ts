import { createServer, Server as HttpServer } from 'http';
import { AddressInfo } from 'net';
import { io as createClient, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db/pool';
import { createSocketServer } from '../../src/realtime/socketServer';
import { authHeader, createUserDirect, signToken, uniqueSuffix } from '../helpers/testUtils';

const app = createApp();
let httpServer: HttpServer;
let baseUrl: string;
const clients: ClientSocket[] = [];

beforeAll(async () => {
  httpServer = createServer(app);
  createSocketServer(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  for (const client of clients) client.disconnect();
  await new Promise<void>((resolve, reject) => httpServer.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

async function connect(userId: string): Promise<ClientSocket> {
  const socket = createClient(baseUrl, {
    auth: { token: signToken(userId, 'user') },
    transports: ['websocket'],
    forceNew: true,
  });
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

function emitReaction(socket: ClientSocket, gameId: string, reactionId: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => socket.emit('game:reaction', { gameId, reactionId }, resolve));
}

describe('game reaction sockets', () => {
  it('broadcasts catalog reactions to the game room and rejects non-players', async () => {
    const owner = await createUserDirect({});
    const spectator = await createUserDirect({});
    const tableResponse = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: `Reaction_${uniqueSuffix()}`, visibility: 'public' });
    const tableId = tableResponse.body.tableId as string;
    await request(app)
      .post(`/api/v1/tables/${tableId}/join`)
      .set(authHeader(spectator.id, 'user'))
      .send({ joinAs: 'spectator' });

    const session = await pool.query(`INSERT INTO table_session (table_id) VALUES ($1) RETURNING id`, [tableId]);
    const game = await pool.query(
      `INSERT INTO game (table_id, table_session_id, status) VALUES ($1, $2, 'active') RETURNING id`,
      [tableId, session.rows[0].id],
    );
    const gameId = game.rows[0].id as string;

    const ownerSocket = await connect(owner.id);
    const spectatorSocket = await connect(spectator.id);
    await new Promise<void>((resolve) => ownerSocket.emit('game:join-room', gameId, () => resolve()));

    const received = new Promise<{ userId: string; reactionId: string }>((resolve) => {
      ownerSocket.once('game:reaction', resolve);
    });
    expect(await emitReaction(ownerSocket, gameId, 'hello')).toEqual({ ok: true });
    expect(await received).toMatchObject({ userId: owner.id, reactionId: 'hello' });

    expect(await emitReaction(spectatorSocket, gameId, 'hello')).toEqual({ ok: false, error: 'forbidden' });
    expect(await emitReaction(ownerSocket, gameId, 'invented')).toEqual({ ok: false, error: 'invalid payload' });
  });

  it('applies the per-socket cooldown', async () => {
    const owner = await createUserDirect({});
    const tableResponse = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: `Cooldown_${uniqueSuffix()}`, visibility: 'public' });
    const tableId = tableResponse.body.tableId as string;
    const session = await pool.query(`INSERT INTO table_session (table_id) VALUES ($1) RETURNING id`, [tableId]);
    const game = await pool.query(
      `INSERT INTO game (table_id, table_session_id, status) VALUES ($1, $2, 'active') RETURNING id`,
      [tableId, session.rows[0].id],
    );
    const socket = await connect(owner.id);

    expect(await emitReaction(socket, game.rows[0].id, 'hello')).toEqual({ ok: true });
    expect(await emitReaction(socket, game.rows[0].id, 'like')).toEqual({ ok: false, error: 'reaction rate limited' });
  });
});

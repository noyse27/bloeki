import { io, Socket } from 'socket.io-client';
import { flushClientDebugEvents, logClientEvent } from '../debugLogging';

let socket: Socket | null = null;
let socketToken: string | null = null;

/** One shared connection for the whole app; reused across pages, torn down
 * and recreated only if the auth token changes (login/logout). Same-origin
 * by default - dev goes through the Vite proxy, prod through nginx.conf,
 * both forwarding /socket.io to the backend (mirrors the /api proxy). */
export function getSocket(token: string): Socket {
  if (socket && socketToken === token) return socket;
  socket?.disconnect();
  socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
  socket.on('connect', () => {
    logClientEvent({ eventType: 'socket_connect', payload: { socketId: socket?.id, transport: socket?.io.engine.transport.name } });
  });
  socket.on('disconnect', (reason) => {
    logClientEvent({ eventType: 'socket_disconnect', payload: { reason } });
    void flushClientDebugEvents();
  });
  socket.on('connect_error', (err) => {
    logClientEvent({ eventType: 'socket_connect_error', payload: { message: err.message } });
    void flushClientDebugEvents(true);
  });
  socketToken = token;
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
  socketToken = null;
}

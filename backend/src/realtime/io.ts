import { Server } from 'socket.io';

// Module-level singleton rather than threading `io` through every route
// module: tables.ts (REST) needs to broadcast after DB mutations, but
// isn't constructed with access to the socket server. Unit tests that call
// createApp() directly (supertest, no real http.Server) never initialize
// this, so getIO() returning null must be handled at every call site -
// broadcasting is a nice-to-have on top of the REST response, never a
// dependency of it.
let io: Server | null = null;

export function setIO(instance: Server): void {
  io = instance;
}

export function getIO(): Server | null {
  return io;
}

export function lobbyRoom(): string {
  return 'lobby';
}

export function tableRoom(tableId: string): string {
  return `table:${tableId}`;
}

export function gameRoom(gameId: string): string {
  return `game:${gameId}`;
}

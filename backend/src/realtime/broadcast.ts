import { getIO, lobbyRoom, tableRoom, gameRoom } from './io';
import { fetchLobbyTables, loadTableDetail } from '../services/tableQueries';
import { loadGameState } from '../services/gameState';
import { COUNTDOWN_MS, GUESS_WINDOW_MS, TRAILER_DURATION_MS } from '../services/roundConfig';
import { ChatMessage, ReactionConfig } from '../services/communication';
import { logBetaDebug, storeGameEvent } from '../services/debugLogging';

/** Re-broadcasts the whole public/open table list. Table counts are small
 * (private-group scale, see FR-013), so a full refetch+broadcast on every
 * lobby-relevant mutation is simpler and safer than diffing individual
 * rows client-side. */
export async function broadcastLobby(): Promise<void> {
  const io = getIO();
  if (!io) return; // no live socket server (e.g. unit tests via supertest)
  const tables = await fetchLobbyTables();
  io.to(lobbyRoom()).emit('lobby:tables', { tables });
}

/** Re-broadcasts one table's detail (seats, state, latest game) to
 * everyone currently viewing that table's room. */
export async function broadcastTable(tableId: string): Promise<void> {
  const io = getIO();
  if (!io) return;
  const detail = await loadTableDetail(tableId);
  if (!detail) return;
  io.to(tableRoom(tableId)).emit('table:update', detail);
}

/** Re-broadcasts full game state (players, timelines, current round) to
 * everyone in that game's room. Called after every round-lifecycle
 * transition in roundEngine.ts, including the ones that fire from a
 * setTimeout rather than a request (e.g. countdown -> playing), which
 * otherwise have no way to tell a connected client anything changed. */
export async function broadcastGame(gameId: string): Promise<void> {
  const io = getIO();
  if (!io) return;
  const state = await loadGameState(gameId, COUNTDOWN_MS, TRAILER_DURATION_MS, GUESS_WINDOW_MS);
  if (!state) return;
  const room = gameRoom(gameId);
  const recipientSocketCount = io.sockets.adapter.rooms.get(room)?.size ?? 0;
  const payload = {
    gameId,
    tableId: state.tableId,
    roundId: state.currentRound?.roundId ?? null,
    roundIndex: state.currentRound?.indexNo ?? null,
    status: state.currentRound?.status ?? null,
    recipientSocketCount,
  };
  logBetaDebug('socket_game_update_broadcast', payload);
  void storeGameEvent({
    eventType: 'socket_game_update_broadcast',
    tableId: state.tableId,
    gameId,
    roundId: state.currentRound?.roundId ?? null,
    roundIndex: state.currentRound?.indexNo ?? null,
    payload,
  });
  io.to(room).emit('game:update', state);
}

/** Chat is persisted through REST, then fanned out through the same rooms
 * clients already authorize and subscribe to for lobby/table updates. */
export function emitChatMessage(message: ChatMessage): void {
  const io = getIO();
  if (!io) return;
  const room = message.scope === 'lobby' ? lobbyRoom() : tableRoom(message.tableId as string);
  io.to(room).emit('chat:message', message);
}

/** Communication settings are non-secret except for the word-filter list,
 * which is deliberately not part of this payload. Every connected player
 * and display can switch its reaction bar without a page reload. */
export function broadcastReactionConfig(reactions: ReactionConfig): void {
  getIO()?.emit('communication:config-updated', { reactions });
}

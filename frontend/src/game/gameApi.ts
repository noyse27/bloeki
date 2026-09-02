import { apiFetch } from '../api';
import { GameState } from './types';

export function fetchGameState(gameId: string, token: string): Promise<GameState> {
  return apiFetch<GameState>(`/games/${gameId}/state`, { token });
}

export function setRoundReady(gameId: string, token: string, ready = true): Promise<{ accepted: true }> {
  return apiFetch(`/games/${gameId}/ready`, { method: 'POST', body: { ready }, token });
}

export function setAutoReady(gameId: string, token: string, autoReady: boolean): Promise<{ accepted: true }> {
  return apiFetch(`/games/${gameId}/ready/auto`, { method: 'POST', body: { autoReady }, token });
}

// Anders als bei songster (wo waehrend des Songs geraten wurde) wird bei
// bloeki erst NACH dem Trailer geraten - siehe roundEngine.ts's
// 'guessing'-Status.
export function submitPositionGuess(gameId: string, roundId: string, token: string, index: number): Promise<{ accepted: true }> {
  return apiFetch(`/games/${gameId}/rounds/${roundId}/guess`, {
    method: 'POST',
    body: { value: index },
    token,
  });
}

export function restartTable(tableId: string, token: string): Promise<{ tableId: string }> {
  return apiFetch(`/tables/${tableId}/restart`, { method: 'POST', token });
}

export function keepTableAlive(tableId: string, token: string): Promise<{ tableId: string }> {
  return apiFetch(`/tables/${tableId}/keep-alive`, { method: 'POST', token });
}

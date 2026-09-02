import { GameState, RoundStatus } from './types';

const ROUND_STATUS_RANK: Record<RoundStatus, number> = {
  countdown: 1,
  playing: 2,
  guessing: 3,
  resolved: 4,
};

export function gameStateSequence(state: GameState): number {
  if (state.status === 'finished') return Number.MAX_SAFE_INTEGER;

  const round = state.currentRound;
  if (!round) return 0;

  return round.indexNo * 10 + ROUND_STATUS_RANK[round.status];
}

export function keepNewestGameState(current: GameState | null, next: GameState): GameState {
  if (!current) return next;
  return gameStateSequence(next) < gameStateSequence(current) ? current : next;
}

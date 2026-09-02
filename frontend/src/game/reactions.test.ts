import { describe, expect, it } from 'vitest';
import { communicationPhase, ReactionConfig } from './reactions';
import { GameState } from './types';

const emptyReactions: ReactionConfig = {
  waiting: [], countdown: [], playing: [], guessing: [], resolved: [], finished: [],
};

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: 'game',
    tableId: 'table',
    status: 'active',
    winnerUserId: null,
    matchEndedAt: null,
    matchCloseWindowMs: 30_000,
    players: [],
    currentRound: null,
    roundReadyPhase: null,
    autoReadyUserIds: [],
    displayAnchorPresent: false,
    reactionConfig: emptyReactions,
    ...overrides,
  };
}

describe('Playboard reactions', () => {
  it('derives waiting and finished phases from game state', () => {
    expect(communicationPhase(state())).toBe('waiting');
    expect(communicationPhase(state({ status: 'finished' }))).toBe('finished');
  });

  it('keeps six independently configurable reaction phases', () => {
    expect(Object.keys(emptyReactions)).toEqual(['waiting', 'countdown', 'playing', 'guessing', 'resolved', 'finished']);
  });
});

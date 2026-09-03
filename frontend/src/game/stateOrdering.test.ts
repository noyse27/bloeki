import { describe, expect, it } from 'vitest';
import { GamePlayerState } from './types';
import { orderPlayersForPersonalBoard } from './stateOrdering';

function player(userId: string, username: string): GamePlayerState {
  return {
    userId,
    username,
    timeline: [],
    scorePoints: 0,
    karmaPoints: 0,
    gamesPlayed: 0,
    globalRank: 0,
  };
}

describe('orderPlayersForPersonalBoard', () => {
  it('keeps the current player first and sorts everyone else by name', () => {
    const ordered = orderPlayersForPersonalBoard(
      [player('b', 'Berta'), player('z', 'Zoe'), player('a', 'Anton')],
      'z',
    );

    expect(ordered.map((p) => p.username)).toEqual(['Zoe', 'Anton', 'Berta']);
  });

  it('falls back to name sorting without a current player', () => {
    const ordered = orderPlayersForPersonalBoard(
      [player('b', 'Berta'), player('z', 'Zoe'), player('a', 'Anton')],
      null,
    );

    expect(ordered.map((p) => p.username)).toEqual(['Anton', 'Berta', 'Zoe']);
  });
});

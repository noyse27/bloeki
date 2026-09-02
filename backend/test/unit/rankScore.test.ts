import { computeRankScore } from '../../src/services/rankScore';

describe('computeRankScore', () => {
  it('damps a brand-new player behind an experienced one with the same raw total', () => {
    const newcomer = computeRankScore(20, 0, 0); // one lucky match, no track record
    const veteran = computeRankScore(20, 0, 49); // same total, built up over many games

    expect(newcomer).toBeGreaterThan(veteran);
    // but not by an unbounded amount - sqrt(1) vs sqrt(50) is a ~7x gap, not infinite
    expect(newcomer / veteran).toBeCloseTo(Math.sqrt(50), 5);
  });

  it('treats negative karma as a malus that pulls the score below zero', () => {
    expect(computeRankScore(10, -20, 0)).toBe(-10);
  });

  it('is a pure ratio of (score+karma) to sqrt(games+1)', () => {
    expect(computeRankScore(30, 10, 3)).toBeCloseTo(40 / Math.sqrt(4), 10);
  });
});

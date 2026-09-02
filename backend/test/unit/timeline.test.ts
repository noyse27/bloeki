import { computeYearRange, generateStartBlocks, isPlacementCorrect, TimelineEntry } from '../../src/services/timeline';

describe('isPlacementCorrect (FR-026/FR-027)', () => {
  const timeline: TimelineEntry[] = [
    { yearValue: 1980 },
    { yearValue: 1995 },
    { yearValue: 2010 },
  ];

  it('accepts a year correctly placed before the first card', () => {
    expect(isPlacementCorrect(timeline, 0, 1970)).toBe(true);
  });

  it('rejects a year that belongs before the first card but was placed later', () => {
    expect(isPlacementCorrect(timeline, 1, 1970)).toBe(false);
  });

  it('accepts a year correctly placed between two neighbors', () => {
    expect(isPlacementCorrect(timeline, 1, 1990)).toBe(true);
  });

  it('rejects a year placed between the wrong neighbors', () => {
    expect(isPlacementCorrect(timeline, 2, 1990)).toBe(false);
  });

  it('accepts a year correctly placed after the last card', () => {
    expect(isPlacementCorrect(timeline, 3, 2020)).toBe(true);
  });

  it('rejects a year placed after the last card when it belongs earlier', () => {
    expect(isPlacementCorrect(timeline, 3, 1990)).toBe(false);
  });

  it('treats an equal-year boundary as correct on both sides (FR-027)', () => {
    expect(isPlacementCorrect(timeline, 1, 1980)).toBe(true);
    expect(isPlacementCorrect(timeline, 2, 1995)).toBe(true);
  });

  it('accepts any index on an empty timeline', () => {
    expect(isPlacementCorrect([], 0, 2000)).toBe(true);
  });
});

describe('computeYearRange', () => {
  function mockClient(minYear: number, maxYear: number) {
    return { query: jest.fn().mockResolvedValue({ rows: [{ min_year: minYear, max_year: maxYear }] }) } as never;
  }

  beforeAll(() => {
    // Fixed "now" so the upper-bound cap is deterministic regardless of
    // when the test suite actually runs.
    jest.useFakeTimers().setSystemTime(new Date('2026-06-15T00:00:00Z'));
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it('caps the upper bound at the current year even when the newest song + 10 would exceed it', async () => {
    // Regression: this previously used Math.max, so a playlist whose
    // newest song was recent (e.g. 2022 + 10 = 2032) could hand out a
    // starter/drawn year up to 2032 - years that haven't happened yet.
    const range = await computeYearRange(mockClient(1980, 2022));
    expect(range).toEqual({ lower: 1970, upper: 2026 });
  });

  it('does not artificially extend the upper bound up to the current year when the pool is older', async () => {
    const range = await computeYearRange(mockClient(1970, 2000));
    expect(range).toEqual({ lower: 1960, upper: 2010 });
  });
});

describe('generateStartBlocks (FR-023: no duplicate start years)', () => {
  it('retries the draw so the two start years are never identical, even when the RNG initially repeats', async () => {
    // Narrow range [2000, 2001]: only two possible years, so a naive
    // independent draw has a 50% chance of landing on the same year twice
    // (the bug this replaces - see the game-summary PDF regression where
    // both players started with two 1971 cards).
    const insertedYears: number[] = [];
    const client = {
      query: jest.fn().mockImplementation((sql: string, params: unknown[]) => {
        if (sql.includes('MIN(year_value)')) {
          return Promise.resolve({ rows: [{ min_year: 2010, max_year: 1991 }] });
        }
        insertedYears.push(params[2] as number);
        return Promise.resolve({ rows: [] });
      }),
    } as never;

    // Force Math.random to return the same value twice (both would draw
    // 2000) before returning a value that draws 2001 - proving the retry
    // loop rejects the repeat instead of accepting it.
    const randomSpy = jest.spyOn(Math, 'random');
    randomSpy.mockReturnValueOnce(0.1).mockReturnValueOnce(0.1).mockReturnValueOnce(0.9);

    await generateStartBlocks(client, 'game-1', ['user-1']);
    randomSpy.mockRestore();

    expect(insertedYears).toEqual([2000, 2001]);
  });
});

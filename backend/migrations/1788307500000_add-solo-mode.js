/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// Solo mode: a single player plays alone against the trailer library, with
// no opponent. is_solo relaxes max_players down to exactly 1 for such a
// table (the existing CHECK only ever allowed 2-5); everywhere else that
// assumed ">= 2 active players means a real match" - tableStart.ts,
// POST /tables/:id/new-game, matchOutcome.ts's score/karma/games_played
// awards, trailerPool.ts's last_played_at bump - reads this flag instead of
// a bare player-count check. See those files for why: in short, solo must
// never earn leaderboard-affecting score/karma/games_played (trivial,
// risk-free "wins" against no one), and must never advance the shared
// last_played_at trailer rotation either, or heavy solo play would deplete
// fresh trailers for every other (multiplayer) table too.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE game_table DROP CONSTRAINT game_table_max_players_check;
    ALTER TABLE game_table ADD COLUMN is_solo BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE game_table ADD CONSTRAINT game_table_max_players_check
      CHECK ((is_solo AND max_players = 1) OR (NOT is_solo AND max_players BETWEEN 2 AND 5));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE game_table DROP CONSTRAINT game_table_max_players_check;
    ALTER TABLE game_table DROP COLUMN is_solo;
    ALTER TABLE game_table ADD CONSTRAINT game_table_max_players_check
      CHECK (max_players BETWEEN 2 AND 5);
  `);
};

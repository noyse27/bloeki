// Combines match performance (score_points), community standing
// (karma_points - negative acts as a malus, positive as a bonus) and
// experience (games_played) into one comparable skill number. Dividing by
// sqrt(games_played + 1) dampens a brand-new player's first lucky match
// from immediately outranking someone with a long track record, without
// needing an arbitrary minimum-games cutoff - the same damping trick used
// by Bayesian/Wilson-style ranking systems. Used for the global leaderboard
// order (routes/leaderboard.ts), the profile's own rank, and each seated
// player's live "Rang" in gameState.ts/PlayerRow's tooltip.
export const RANK_SCORE_SQL = '(score_points + karma_points)::float8 / sqrt(games_played + 1)';

export function computeRankScore(scorePoints: number, karmaPoints: number, gamesPlayed: number): number {
  return (scorePoints + karmaPoints) / Math.sqrt(gamesPlayed + 1);
}

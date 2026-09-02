import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { RANK_SCORE_SQL } from '../services/rankScore';

export const leaderboardRouter = Router();

leaderboardRouter.get('/leaderboard', requireAuth, async (_req, res) => {
  const result = await pool.query(
    `SELECT id, username, score_points, karma_points, games_played, ${RANK_SCORE_SQL} AS rank_score
     FROM app_user
     ORDER BY rank_score DESC, username ASC
     LIMIT 100`,
  );

  res.status(200).json({
    leaderboard: result.rows.map((row) => ({
      userId: row.id,
      username: row.username,
      scorePoints: row.score_points,
      karmaPoints: row.karma_points,
      gamesPlayed: row.games_played,
      rankScore: Number(row.rank_score),
    })),
  });
});

// Backs the "bisher insgesamt gespielte Spiele auf dem Server" line on the
// post-login home screen. A dedicated counter (see the
// persistent-games-played-counter migration and matchOutcome.ts's
// finishGame), not a live COUNT(*) of finished games - game.table_id
// cascades away whenever tableCleanup.ts hard-deletes an inactive table, so
// counting the game table directly would silently lose history an hour
// after every match.
leaderboardRouter.get('/stats/games-played', requireAuth, async (_req, res) => {
  const result = await pool.query(`SELECT value FROM system_setting WHERE key = 'total_games_finished'`);
  res.status(200).json({ gamesPlayed: result.rows[0] ? Number(result.rows[0].value) : 0 });
});

leaderboardRouter.get('/users/:userId/karma-ledger', requireAuth, async (req, res) => {
  const { userId } = req.params;

  const userResult = await pool.query(`SELECT id, karma_points FROM app_user WHERE id = $1`, [userId]);
  if (userResult.rowCount === 0) {
    res.status(404).json({ error: 'user not found' });
    return;
  }

  const ledgerResult = await pool.query(
    `SELECT id, game_id, delta, reason, created_at
     FROM karma_ledger WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );

  res.status(200).json({
    userId,
    karmaPoints: userResult.rows[0].karma_points,
    entries: ledgerResult.rows.map((row) => ({
      entryId: row.id,
      gameId: row.game_id,
      delta: row.delta,
      reason: row.reason,
      createdAt: row.created_at,
    })),
  });
});

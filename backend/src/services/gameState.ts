import { pool } from '../db/pool';
import { fetchTimeline } from './timeline';
import { ROUND_READY_WINDOW_MS } from './roundConfig';
import { AUTO_CLOSE_MS } from './tableRestart';
import { RANK_SCORE_SQL } from './rankScore';
import { loadReactionConfig, ReactionConfig } from './communication';

export interface GamePlayerState {
  userId: string;
  username: string;
  timeline: number[];
  scorePoints: number;
  karmaPoints: number;
  gamesPlayed: number;
  // Globaler Skill-Rang ueber alle app_user (siehe rankScore.ts), keine
  // Tisch-/Match-Platzierung - der Playboard-Tooltip zeigt das als "Rang".
  globalRank: number;
}

export interface CurrentRoundState {
  roundId: string;
  indexNo: number;
  status: 'countdown' | 'playing' | 'guessing' | 'resolved';
  startedAt: string;
  countdownMs: number;
  trailerMs: number;
  guessWindowMs: number;
  sitOutUserIds: string[];
  // Der Trailer selbst ist unbedenklich, sobald eine Runde ueberhaupt einen
  // Trailer hat (countdown/playing/guessing) - das Anschauen ist der ganze
  // Sinn der Raterunde. Zeigt auf GET /trailers/:id/stream, nie die rohe
  // trailer_ref-id/-jahr/-titel.
  trailerStreamPath: string | null;
  // Nur befuellt, sobald status === 'resolved' - nie frueher, das wuerde
  // den Trailer fuer alle noch Ratenden verraten.
  trailerTitle: string | null;
  trailerYear: number | null;
  results: {
    userId: string;
    submitted: boolean;
    correct: boolean;
    guessedIndex: number | null;
  }[];
}

export interface RoundReadyPhase {
  startedAt: string | null;
  windowMs: number;
  readyUserIds: string[];
}

export interface GameState {
  gameId: string;
  tableId: string;
  status: string;
  winnerUserId: string | null;
  // Ab Spielende gesetzt (matchOutcome.ts's finishGame) - treibt den
  // client-seitig synchronisierten "schliesst in Xs"-Countdown auf dem
  // Gewinner-Screen.
  matchEndedAt: string | null;
  matchCloseWindowMs: number;
  players: GamePlayerState[];
  currentRound: CurrentRoundState | null;
  roundReadyPhase: RoundReadyPhase | null;
  autoReadyUserIds: string[];
  // Hostmodus (gemeinsames Anzeigegeraet): true, solange ein
  // Display-Token-Socket fuer diesen Tisch verbunden ist.
  displayAnchorPresent: boolean;
  reactionConfig: ReactionConfig;
}

export async function loadGameState(
  gameId: string,
  countdownMs: number,
  trailerMs: number,
  guessWindowMs: number,
): Promise<GameState | null> {
  const gameResult = await pool.query(
    `SELECT g.id, g.table_id, g.status, g.winner_user_id, t.match_ended_at,
            t.display_connected_at IS NOT NULL AS display_anchor_present
     FROM game g
     JOIN game_table t ON t.id = g.table_id
     WHERE g.id = $1`,
    [gameId],
  );
  if (gameResult.rowCount === 0) return null;
  const game = gameResult.rows[0];

  const seatsResult = await pool.query(
    `SELECT u.id AS user_id, u.username, u.score_points, u.karma_points, u.games_played
     FROM table_seat s
     JOIN app_user u ON u.id = s.user_id
     WHERE s.table_id = $1 AND s.seat_type = 'player' AND s.left_at IS NULL
     ORDER BY s.joined_at ASC`,
    [game.table_id],
  );

  const globalRankResult = await pool.query(
    `WITH ranked AS (
       SELECT id, RANK() OVER (ORDER BY ${RANK_SCORE_SQL} DESC) AS global_rank FROM app_user
     )
     SELECT id, global_rank FROM ranked WHERE id = ANY($1::uuid[])`,
    [seatsResult.rows.map((row) => row.user_id)],
  );
  const globalRankByUserId = new Map<string, number>(
    globalRankResult.rows.map((row) => [row.id, Number(row.global_rank)]),
  );

  const players: GamePlayerState[] = [];
  for (const seat of seatsResult.rows) {
    const timeline = await fetchTimeline(pool, gameId, seat.user_id);
    players.push({
      userId: seat.user_id,
      username: seat.username,
      timeline: timeline.map((t) => t.yearValue),
      scorePoints: seat.score_points,
      karmaPoints: seat.karma_points,
      gamesPlayed: seat.games_played,
      globalRank: globalRankByUserId.get(seat.user_id) ?? 0,
    });
  }

  const roundResult = await pool.query(
    `SELECT r.id, r.index_no, r.status, r.started_at, r.trailer_id,
            CASE WHEN r.status = 'resolved' THEN tr.title ELSE NULL END AS trailer_title,
            CASE WHEN r.status = 'resolved' THEN tr.year_value ELSE NULL END AS trailer_year
     FROM round r
     JOIN trailer_ref tr ON tr.id = r.trailer_id
     WHERE r.game_id = $1
     ORDER BY r.index_no DESC
     LIMIT 1`,
    [gameId],
  );

  let currentRound: CurrentRoundState | null = null;
  if ((roundResult.rowCount ?? 0) > 0) {
    const round = roundResult.rows[0];

    let results: CurrentRoundState['results'] = [];
    if (round.status === 'resolved') {
      const guessResult = await pool.query(
        `SELECT DISTINCT ON (user_id) user_id, is_correct, value_number
         FROM guess WHERE round_id = $1 AND guess_type = 'position'
         ORDER BY user_id, submitted_at DESC`,
        [round.id],
      );
      const submittedIds = new Set(guessResult.rows.map((r) => r.user_id));
      results = players.map((p) => {
        const row = guessResult.rows.find((r) => r.user_id === p.userId);
        return {
          userId: p.userId,
          submitted: submittedIds.has(p.userId),
          correct: row?.is_correct ?? false,
          guessedIndex: row ? row.value_number : null,
        };
      });
    }

    const sitOutResult = await pool.query(`SELECT user_id FROM round_sitout WHERE round_id = $1`, [round.id]);

    currentRound = {
      roundId: round.id,
      indexNo: round.index_no,
      status: round.status,
      startedAt: round.started_at,
      countdownMs,
      trailerMs,
      guessWindowMs,
      sitOutUserIds: sitOutResult.rows.map((r) => r.user_id),
      trailerStreamPath: `/trailers/${round.trailer_id}/stream`,
      trailerTitle: round.trailer_title,
      trailerYear: round.trailer_year,
      results,
    };
  }

  // Nur zwischen Runden aussagekraeftig (noch keine Runde, oder die letzte
  // ist aufgeloest) - waehrend einer aktiven Runde ist round_ready leer
  // (bei Start geleert, siehe roundReady.ts).
  let roundReadyPhase: RoundReadyPhase | null = null;
  if (!currentRound || currentRound.status === 'resolved') {
    const readyGameResult = await pool.query(`SELECT round_ready_started_at FROM game WHERE id = $1`, [gameId]);
    const readyResult = await pool.query(`SELECT user_id FROM round_ready WHERE game_id = $1 AND ready = TRUE`, [
      gameId,
    ]);
    roundReadyPhase = {
      startedAt: readyGameResult.rows[0]?.round_ready_started_at ?? null,
      windowMs: ROUND_READY_WINDOW_MS,
      readyUserIds: readyResult.rows.map((r) => r.user_id),
    };
  }

  const autoReadyResult = await pool.query(
    `SELECT user_id FROM round_ready_pref WHERE game_id = $1 AND auto_ready = TRUE`,
    [gameId],
  );

  return {
    gameId: game.id,
    tableId: game.table_id,
    status: game.status,
    winnerUserId: game.winner_user_id,
    matchEndedAt: game.match_ended_at,
    matchCloseWindowMs: AUTO_CLOSE_MS,
    players,
    currentRound,
    roundReadyPhase,
    autoReadyUserIds: autoReadyResult.rows.map((r) => r.user_id),
    displayAnchorPresent: game.display_anchor_present,
    reactionConfig: await loadReactionConfig(),
  };
}

import { Response, Router } from 'express';
import { pool } from '../db/pool';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth';
import { RoundEngineError } from '../services/errors';
import { startRound, submitGuess } from '../services/roundEngine';
import { setAutoReady, setRoundReady } from '../services/roundReady';
import { loadGameState } from '../services/gameState';
import { touchTableActivityForGame } from '../services/tableActivity';
import { COUNTDOWN_MS, GUESS_WINDOW_MS, TRAILER_DURATION_MS } from '../services/roundConfig';
import { verifyDisplayToken } from '../services/displayToken';
import { isHostDisplayTokenActive } from '../services/hostDevices';
import { authorizeGameViewer } from '../services/tableAuthorization';
import { storeGameEvent } from '../services/debugLogging';
import { RequestWithId } from '../middleware/requestId';

export const roundsRouter = Router();

const STATUS_BY_ERROR_CODE: Record<string, number> = {
  GAME_NOT_FOUND: 404,
  GAME_NOT_ACTIVE: 409,
  FORBIDDEN: 403,
  ROUND_ALREADY_ACTIVE: 409,
  NO_TRAILERS_AVAILABLE: 409,
  ROUND_NOT_FOUND: 404,
  ROUND_LOCKED: 409,
  INVALID_GUESS: 400,
  SITTING_OUT: 403,
};

function handleEngineError(err: unknown, res: Response): boolean {
  if (err instanceof RoundEngineError) {
    const status = STATUS_BY_ERROR_CODE[err.code] ?? 400;
    res.status(status).json({ error: err.code, message: err.message });
    return true;
  }
  return false;
}

// Erfordert einen aktiven Sitz (Spieler oder Zuschauer) an diesem
// Spiel-Tisch - eine blosse Anmeldung reicht nicht.
roundsRouter.get('/games/:gameId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { gameId } = req.params;

  const access = await authorizeGameViewer(gameId, req.userId as string);
  if (!access) {
    res.status(404).json({ error: 'game not found' });
    return;
  }

  const gameResult = await pool.query(
    `SELECT id, table_id, table_session_id, status, started_at, ended_at, winner_user_id
     FROM game WHERE id = $1`,
    [gameId],
  );
  if (gameResult.rowCount === 0) {
    res.status(404).json({ error: 'game not found' });
    return;
  }
  const game = gameResult.rows[0];

  const playersResult = await pool.query(
    `SELECT u.id AS user_id, u.username, COUNT(tc.id)::int AS card_count
     FROM table_seat s
     JOIN app_user u ON u.id = s.user_id
     LEFT JOIN timeline_card tc ON tc.game_id = $1 AND tc.user_id = s.user_id
     WHERE s.table_id = $2 AND s.seat_type = 'player' AND s.left_at IS NULL
     GROUP BY u.id, u.username`,
    [gameId, game.table_id],
  );

  res.status(200).json({
    gameId: game.id,
    tableId: game.table_id,
    tableSessionId: game.table_session_id,
    status: game.status,
    startedAt: game.started_at,
    endedAt: game.ended_at,
    winnerUserId: game.winner_user_id,
    players: playersResult.rows.map((row) => ({
      userId: row.user_id,
      username: row.username,
      cardCount: row.card_count,
    })),
  });
});

// Konsolidierter Snapshot fuer den Playboard-Client (Spieler + volle
// Zeitleisten + aktuelle Runde inkl. Aufloesung) - dasselbe, was der
// Socket-Broadcaster (broadcastGame) bei jeder Statusaenderung auch sendet.
roundsRouter.get('/games/:gameId/state', requireAuth, async (req: AuthenticatedRequest, res) => {
  const access = await authorizeGameViewer(req.params.gameId, req.userId as string);
  if (!access) {
    res.status(404).json({ error: 'game not found' });
    return;
  }

  const state = await loadGameState(req.params.gameId, COUNTDOWN_MS, TRAILER_DURATION_MS, GUESS_WINDOW_MS);
  if (!state) {
    res.status(404).json({ error: 'game not found' });
    return;
  }
  res.status(200).json(state);
});

// Anzeigegeraet-Variante des State-Snapshots oben, per Display-Token
// authentifiziert statt per normaler Session.
roundsRouter.get('/games/display/:token/:gameId', async (req, res) => {
  const verified = verifyDisplayToken(req.params.token);
  if (!verified || (verified.hostDeviceId && !(await isHostDisplayTokenActive(verified.hostDeviceId)))) {
    res.status(401).json({ error: 'invalid or expired display token' });
    return;
  }

  const gameResult = await pool.query(`SELECT table_id FROM game WHERE id = $1`, [req.params.gameId]);
  if (gameResult.rowCount === 0 || gameResult.rows[0].table_id !== verified.tableId) {
    res.status(404).json({ error: 'game not found' });
    return;
  }

  const state = await loadGameState(req.params.gameId, COUNTDOWN_MS, TRAILER_DURATION_MS, GUESS_WINDOW_MS);
  res.status(200).json(state);
});

// Selbstbedienende Pro-Runde-Bereitschaft (siehe roundReady.ts).
roundsRouter.post('/games/:gameId/ready', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { ready = true } = req.body ?? {};
  if (typeof ready !== 'boolean') {
    res.status(400).json({ error: 'ready must be a boolean' });
    return;
  }
  try {
    await setRoundReady(req.params.gameId, req.userId as string, ready);
    await touchTableActivityForGame(req.params.gameId);
    void storeGameEvent({
      eventType: 'player_ready_changed',
      gameId: req.params.gameId,
      userId: req.userId as string,
      requestId: (req as RequestWithId).requestId,
      payload: { ready },
    });
    res.status(200).json({ accepted: true });
  } catch (err) {
    if (!handleEngineError(err, res)) throw err;
  }
});

// "Auto bereit"-Lock (siehe roundReady.ts's setAutoReady).
roundsRouter.post('/games/:gameId/ready/auto', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { autoReady } = req.body ?? {};
  if (typeof autoReady !== 'boolean') {
    res.status(400).json({ error: 'autoReady must be a boolean' });
    return;
  }
  try {
    await setAutoReady(req.params.gameId, req.userId as string, autoReady);
    await touchTableActivityForGame(req.params.gameId);
    void storeGameEvent({
      eventType: 'player_auto_ready_changed',
      gameId: req.params.gameId,
      userId: req.userId as string,
      requestId: (req as RequestWithId).requestId,
      payload: { autoReady },
    });
    res.status(200).json({ accepted: true });
  } catch (err) {
    if (!handleEngineError(err, res)) throw err;
  }
});

// Manueller/Admin-Override - der normale Spielablauf laeuft ueber
// POST /games/:id/ready.
roundsRouter.post('/games/:gameId/rounds', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const round = await startRound(req.params.gameId, req.userId as string, req.userRole);
    await touchTableActivityForGame(req.params.gameId);
    res.status(201).json(round);
  } catch (err) {
    if (!handleEngineError(err, res)) throw err;
  }
});

roundsRouter.get('/games/:gameId/rounds/:roundId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { gameId, roundId } = req.params;

  const access = await authorizeGameViewer(gameId, req.userId as string);
  if (!access) {
    res.status(404).json({ error: 'game not found' });
    return;
  }

  const roundResult = await pool.query(
    `SELECT r.id, r.index_no, r.status, r.started_at, r.ended_at,
            CASE WHEN r.status = 'resolved' THEN tr.year_value ELSE NULL END AS trailer_year
     FROM round r
     JOIN trailer_ref tr ON tr.id = r.trailer_id
     WHERE r.id = $1 AND r.game_id = $2`,
    [roundId, gameId],
  );
  if (roundResult.rowCount === 0) {
    res.status(404).json({ error: 'round not found' });
    return;
  }
  const round = roundResult.rows[0];

  let results: Array<{ userId: string; value: number; correct: boolean }> = [];
  if (round.status === 'resolved') {
    const guessResult = await pool.query(
      `SELECT DISTINCT ON (user_id) user_id, value_number, is_correct
       FROM guess WHERE round_id = $1 AND guess_type = 'position'
       ORDER BY user_id, submitted_at DESC`,
      [roundId],
    );
    results = guessResult.rows.map((row) => ({
      userId: row.user_id,
      value: row.value_number,
      correct: row.is_correct,
    }));
  }

  res.status(200).json({
    roundId: round.id,
    indexNo: round.index_no,
    status: round.status,
    startedAt: round.started_at,
    endedAt: round.ended_at,
    trailerYear: round.trailer_year,
    results,
  });
});

// Anders als bei songster wird erst nach dem Trailer geraten (status
// 'guessing'), nicht mehr waehrend der Wiedergabe.
roundsRouter.post(
  '/games/:gameId/rounds/:roundId/guess',
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const { value } = req.body ?? {};

    try {
      const result = await submitGuess(req.params.gameId, req.params.roundId, req.userId as string, Number(value));
      await touchTableActivityForGame(req.params.gameId);
      res.status(200).json(result);
    } catch (err) {
      if (!handleEngineError(err, res)) throw err;
    }
  },
);

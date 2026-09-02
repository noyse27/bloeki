import { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { RoundEngineError } from './errors';
import { checkForWinOrTie, finishGame } from './matchOutcome';
import { selectTrailerForGame } from './trailerPool';
import { fetchTimeline, insertCardAndReindex, isPlacementCorrect } from './timeline';
import { broadcastGame } from '../realtime/broadcast';
import { startReadyWindow } from './roundReadyWindow';
import { scheduleAutoClose } from './tableRestart';
import { storeGameEvent } from './debugLogging';
import { COUNTDOWN_MS, GUESS_WINDOW_MS, TRAILER_DURATION_MS } from './roundConfig';

export { COUNTDOWN_MS, GUESS_WINDOW_MS, TRAILER_DURATION_MS };

// Kein 'token_solo'/'token_others' wie bei songster - bloeki kennt nur
// countdown -> playing -> guessing -> resolved (siehe roundConfig.ts's
// GUESS_WINDOW_MS-Kommentar: geraten wird erst NACH dem Trailer, nicht
// waehrend).
const ACTIVE_ROUND_STATUSES = ['countdown', 'playing', 'guessing'];

// Nach jeder Runde, die einen Spieler ueber die Gewinnschwelle bringen
// koennte, aufgerufen (innerhalb derselben Transaktion wie die
// Kartenvergabe). Ein alleiniger Fuehrender beendet das Spiel; ein
// Gleichstand wird - anders als bei songster - einfach mit weiteren
// normalen Runden fortgesetzt (siehe matchOutcome.ts).
async function checkForGameEnd(client: PoolClient, gameId: string): Promise<void> {
  const outcome = await checkForWinOrTie(client, gameId);
  if ('winnerUserId' in outcome) {
    await finishGame(client, gameId, outcome.winnerUserId);
  }
}

// Einmal aufgerufen, direkt nachdem eine Rundenaufloesung committed wurde.
// Entweder ist das Spiel noch aktiv - dann bewaffnet sich das naechste
// Bereitschaftsfenster automatisch (siehe roundReadyWindow.ts) - oder
// checkForGameEnd() hat die Partie gerade beendet, dann startet der Tisch
// seinen 60s Auto-Close-Countdown (siehe tableRestart.ts).
async function afterRoundResolved(gameId: string): Promise<void> {
  const result = await pool.query(`SELECT status, table_id FROM game WHERE id = $1`, [gameId]);
  if (result.rowCount === 0) return;
  const { status, table_id: tableId } = result.rows[0];
  if (status === 'finished') {
    scheduleAutoClose(tableId);
  } else {
    await startReadyWindow(gameId);
  }
}

export interface RoundGuessResult {
  userId: string;
  submitted: boolean;
  correct: boolean;
}

interface StartRoundAuth {
  requesterId: string;
  requesterRole?: string;
}

async function runStartRound(gameId: string, sitOutUserIds: string[], auth?: StartRoundAuth) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const gameResult = await client.query(
      `SELECT id, table_id, table_session_id, status FROM game WHERE id = $1 FOR UPDATE`,
      [gameId],
    );
    if (gameResult.rowCount === 0) {
      throw new RoundEngineError('GAME_NOT_FOUND', 'game not found');
    }
    const game = gameResult.rows[0];
    if (game.status !== 'active') {
      throw new RoundEngineError('GAME_NOT_ACTIVE', 'game is not active');
    }

    // Manueller/Admin-Trigger (POST /games/:id/rounds) ist owner-gated; der
    // selbstbedienende Bereitschafts-Trigger (POST /games/:id/ready, siehe
    // roundReady.ts) hat kein `auth` - er feuert nur, wenn die
    // Bereitschaftsbedingung fuer alle bereits erfuellt ist.
    if (auth) {
      const tableResult = await client.query(`SELECT owner_user_id FROM game_table WHERE id = $1`, [
        game.table_id,
      ]);
      const table = tableResult.rows[0];
      if (table.owner_user_id !== auth.requesterId && auth.requesterRole !== 'admin') {
        throw new RoundEngineError('FORBIDDEN', 'only the table admin can start a round');
      }
    }

    const activeRoundResult = await client.query(
      `SELECT id FROM round WHERE game_id = $1 AND status = ANY($2::text[]) LIMIT 1`,
      [gameId, ACTIVE_ROUND_STATUSES],
    );
    if ((activeRoundResult.rowCount ?? 0) > 0) {
      throw new RoundEngineError('ROUND_ALREADY_ACTIVE', 'a round is already in progress');
    }

    const trailer = await selectTrailerForGame(client, gameId, game.table_session_id);

    const nextIndexResult = await client.query(
      `SELECT COALESCE(MAX(index_no), 0) + 1 AS next_index FROM round WHERE game_id = $1`,
      [gameId],
    );
    const indexNo = nextIndexResult.rows[0].next_index;

    const roundResult = await client.query(
      `INSERT INTO round (game_id, index_no, trailer_id, status, started_at)
       VALUES ($1, $2, $3, 'countdown', NOW())
       RETURNING id, index_no`,
      [gameId, indexNo, trailer.id],
    );
    const round = roundResult.rows[0];

    // Pro-Runde-Bereitschaft (siehe roundReady.ts): wer im 30s-Fenster
    // nicht bereit war, setzt genau diese Runde aus.
    for (const userId of sitOutUserIds) {
      await client.query(
        `INSERT INTO round_sitout (round_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [round.id, userId],
      );
    }

    await client.query(
      `INSERT INTO session_trailer_history (table_session_id, trailer_ref_id, first_played_round_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (table_session_id, trailer_ref_id)
       DO UPDATE SET play_count = session_trailer_history.play_count + 1`,
      [game.table_session_id, trailer.id, round.id],
    );

    await client.query('COMMIT');
    void storeGameEvent({
      eventType: 'round_started',
      tableId: game.table_id,
      gameId,
      roundId: round.id,
      roundIndex: round.index_no,
      payload: { trailerId: trailer.id, sitOutCount: sitOutUserIds.length, sitOutUserIds },
    });
    await broadcastGame(gameId);

    scheduleRoundTransitions(round.id, gameId);

    return {
      roundId: round.id as string,
      indexNo: round.index_no as number,
      status: 'countdown' as const,
      trailerTitle: trailer.title,
      countdownSeconds: COUNTDOWN_MS / 1000,
      trailerSeconds: TRAILER_DURATION_MS / 1000,
      guessWindowSeconds: GUESS_WINDOW_MS / 1000,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Manueller/Admin-Override - siehe startRoundAuto's Kommentar. Der normale
// Spielablauf laeuft ueber POST /games/:id/ready.
export async function startRound(gameId: string, requesterId: string, requesterRole?: string) {
  return runStartRound(gameId, [], { requesterId, requesterRole });
}

// Systemgesteuerter Start, sobald die Pro-Runde-Bereitschaft erfuellt ist
// (alle bereit, oder das 30s-Fenster abgelaufen) - siehe roundReady.ts.
export async function startRoundAuto(gameId: string, sitOutUserIds: string[]) {
  return runStartRound(gameId, sitOutUserIds);
}

function scheduleRoundTransitions(roundId: string, gameId: string): void {
  setTimeout(() => {
    pool
      .query(`UPDATE round SET status = 'playing' WHERE id = $1 AND status = 'countdown'`, [roundId])
      .then((result) => {
        if ((result.rowCount ?? 0) > 0) {
          void storeGameEvent({ eventType: 'round_playing', gameId, roundId });
        }
        return broadcastGame(gameId);
      })
      .catch((err) => {
        console.error('failed to transition round to playing', err);
      });
  }, COUNTDOWN_MS);

  // Nach dem Trailer folgt das eigene Ratefenster ('guessing') - erst
  // danach wird aufgeloest. Das ist der wichtigste Unterschied zu songster,
  // wo waehrend des Songs selbst geraten wurde.
  setTimeout(() => {
    pool
      .query(`UPDATE round SET status = 'guessing' WHERE id = $1 AND status = 'playing'`, [roundId])
      .then((result) => {
        if ((result.rowCount ?? 0) > 0) {
          void storeGameEvent({ eventType: 'round_guessing', gameId, roundId });
        }
        return broadcastGame(gameId);
      })
      .catch((err) => {
        console.error('failed to transition round to guessing', err);
      });
  }, COUNTDOWN_MS + TRAILER_DURATION_MS);

  setTimeout(() => {
    resolveRound(roundId).catch((err) => {
      console.error('failed to resolve round', err);
    });
  }, COUNTDOWN_MS + TRAILER_DURATION_MS + GUESS_WINDOW_MS);
}

async function assertNotSittingOut(roundId: string, userId: string): Promise<void> {
  const sitoutResult = await pool.query(
    `SELECT 1 FROM round_sitout WHERE round_id = $1 AND user_id = $2`,
    [roundId, userId],
  );
  if ((sitoutResult.rowCount ?? 0) > 0) {
    throw new RoundEngineError('SITTING_OUT', 'you did not ready up in time and are sitting this round out');
  }
}

interface AuthorizedRound {
  id: string;
  gameId: string;
  status: string;
  trailerId: string;
  tableId: string;
}

// Jede spielerausgeloeste Rundenmutation (nur noch der Ratewurf) braucht
// beides, geprueft innerhalb derselben Transaktion wie die Mutation selbst:
//  1. roundId gehoert wirklich zur gameId aus dem URL-Pfad.
//  2. der Anfragende haelt gerade einen aktiven Spieler-Sitz an diesem
//     Tisch.
async function loadAuthorizedRound(
  client: PoolClient,
  gameId: string,
  roundId: string,
  userId: string,
): Promise<AuthorizedRound> {
  const result = await client.query(
    `SELECT r.id, r.game_id, r.status, r.trailer_id, g.table_id
     FROM round r
     JOIN game g ON g.id = r.game_id
     WHERE r.id = $1
     FOR UPDATE OF r`,
    [roundId],
  );
  if (result.rowCount === 0 || result.rows[0].game_id !== gameId) {
    throw new RoundEngineError('ROUND_NOT_FOUND', 'round not found');
  }
  const round = result.rows[0];

  const seatResult = await client.query(
    `SELECT 1 FROM table_seat WHERE table_id = $1 AND user_id = $2 AND seat_type = 'player' AND left_at IS NULL`,
    [round.table_id, userId],
  );
  if (seatResult.rowCount === 0) {
    throw new RoundEngineError('FORBIDDEN', 'you are not an active player at this table');
  }

  return {
    id: round.id,
    gameId: round.game_id,
    status: round.status,
    trailerId: round.trailer_id,
    tableId: round.table_id,
  };
}

// Die Zeitleiste ist auf breiten Bildschirmen schon waehrend 'playing'
// sichtbar (siehe LiveGameBoard.tsx) - dort soll man dann auch schon
// platzieren koennen, nicht erst im eigenen 'guessing'-Fenster danach. Ein
// spaeterer Klick ersetzt einen frueheren einfach (siehe die
// "ORDER BY submitted_at DESC LIMIT 1"-Auswertung in resolveRound), das
// eigene 'guessing'-Fenster nach dem Trailer bleibt vor allem fuer
// Ansichten, die die Zeitleiste erst danach einblenden (z.B. Mobilgeraete
// mit zu wenig Platz fuer Video + Zeitleiste gleichzeitig).
export async function submitGuess(
  gameId: string,
  roundId: string,
  userId: string,
  index: number,
): Promise<{ accepted: true }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const round = await loadAuthorizedRound(client, gameId, roundId, userId);
    if (round.status !== 'playing' && round.status !== 'guessing') {
      throw new RoundEngineError('ROUND_LOCKED', 'round is not currently accepting guesses');
    }

    await assertNotSittingOut(roundId, userId);

    const timeline = await fetchTimeline(client, round.gameId, userId);
    if (!Number.isInteger(index) || index < 0 || index > timeline.length) {
      throw new RoundEngineError('INVALID_GUESS', 'index out of range for the current timeline');
    }

    await client.query(
      `INSERT INTO guess (round_id, user_id, guess_type, value_number) VALUES ($1, $2, 'position', $3)`,
      [roundId, userId, index],
    );

    await client.query('COMMIT');
    void storeGameEvent({
      eventType: 'guess_submitted',
      tableId: round.tableId,
      gameId: round.gameId,
      roundId,
      userId,
      payload: { index },
    });
    return { accepted: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function resolveRound(
  roundId: string,
): Promise<{ roundId: string; trailerYear: number; results: RoundGuessResult[] } | undefined> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const roundResult = await client.query(
      `SELECT id, game_id, trailer_id, status FROM round WHERE id = $1 FOR UPDATE`,
      [roundId],
    );
    if (roundResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return undefined;
    }
    const round = roundResult.rows[0];
    if (round.status !== 'guessing') {
      // Bereits aufgeloest (oder abgebrochen) - keine Doppelverarbeitung
      // bei Wiederholung/Race.
      await client.query('ROLLBACK');
      return undefined;
    }

    const trailerResult = await client.query(`SELECT year_value FROM trailer_ref WHERE id = $1`, [
      round.trailer_id,
    ]);
    const trailerYear = trailerResult.rows[0].year_value as number;

    const gameResult = await client.query(`SELECT table_id FROM game WHERE id = $1`, [round.game_id]);
    const tableId = gameResult.rows[0].table_id;

    const participantsResult = await client.query(
      `SELECT user_id FROM table_seat
       WHERE table_id = $1 AND seat_type = 'player' AND left_at IS NULL
         AND user_id NOT IN (SELECT user_id FROM round_sitout WHERE round_id = $2)`,
      [tableId, roundId],
    );

    const results: RoundGuessResult[] = [];
    for (const participant of participantsResult.rows) {
      const userId = participant.user_id as string;
      const guessResult = await client.query(
        `SELECT id, value_number FROM guess WHERE round_id = $1 AND user_id = $2
         ORDER BY submitted_at DESC LIMIT 1`,
        [roundId, userId],
      );

      if (guessResult.rowCount === 0) {
        results.push({ userId, submitted: false, correct: false });
        continue;
      }

      const guessId = guessResult.rows[0].id;
      const index = guessResult.rows[0].value_number as number;
      const timeline = await fetchTimeline(client, round.game_id, userId);
      const correct = isPlacementCorrect(timeline, index, trailerYear);

      await client.query(`UPDATE guess SET is_correct = $1 WHERE id = $2`, [correct, guessId]);

      if (correct) {
        await insertCardAndReindex(client, {
          gameId: round.game_id,
          userId,
          sourceRoundId: roundId,
          trailerYear,
          index,
        });
      }

      results.push({ userId, submitted: true, correct });
    }

    await client.query(`UPDATE round SET status = 'resolved', ended_at = NOW() WHERE id = $1`, [roundId]);

    await checkForGameEnd(client, round.game_id);

    await client.query('COMMIT');
    void storeGameEvent({
      eventType: 'round_resolved',
      tableId,
      gameId: round.game_id,
      roundId,
      payload: {
        trailerId: round.trailer_id,
        trailerYear,
        submittedCount: results.filter((r) => r.submitted).length,
        correctCount: results.filter((r) => r.correct).length,
        participantCount: participantsResult.rowCount ?? 0,
      },
    });
    await broadcastGame(round.game_id);
    // Ab Runde 2 oeffnet das naechste Bereitschaftsfenster automatisch,
    // sobald diese Runde aufgeloest ist (no-op, falls die Partie gerade
    // endete).
    await afterRoundResolved(round.game_id);
    return { roundId, trailerYear, results };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

import { PoolClient } from 'pg';
import { pool } from '../db/pool';

type Queryable = PoolClient | typeof pool;

// Erster mit 10 richtigen Karten gewinnt.
export const WIN_CARD_THRESHOLD = 10;

export interface CardStanding {
  userId: string;
  cardCount: number;
}

async function fetchStandings(client: Queryable, gameId: string, tableId: string): Promise<CardStanding[]> {
  const result = await client.query(
    `SELECT s.user_id, COUNT(tc.id)::int AS card_count
     FROM table_seat s
     LEFT JOIN timeline_card tc ON tc.game_id = $1 AND tc.user_id = s.user_id
     WHERE s.table_id = $2 AND s.seat_type = 'player' AND s.left_at IS NULL
     GROUP BY s.user_id`,
    [gameId, tableId],
  );
  return result.rows.map((row) => ({ userId: row.user_id, cardCount: row.card_count }));
}

// Nach jeder Runde, die eine Karte vergeben kann: prueft, ob jemand (oder
// mehrere gleichzeitig) die Gewinnschwelle erreicht hat. Anders als songster
// (das bei einem Gleichstand eine eigene Stichrunden-/Bonusrunden-Mechanik
// mit exaktem Jahresraten startet - Teil der hier bewusst entfernten
// Token-Mechanik) spielt bloeki bei einem Gleichstand auf der
// Gewinnschwelle einfach normal weiter: das Spiel endet erst, wenn genau
// ein Spieler die meisten Karten haelt und mindestens WIN_CARD_THRESHOLD
// erreicht hat.
export async function checkForWinOrTie(
  client: Queryable,
  gameId: string,
): Promise<{ winnerUserId: string } | { tiedUserIds: string[] } | { none: true }> {
  const gameResult = await client.query(`SELECT table_id FROM game WHERE id = $1`, [gameId]);
  const tableId = gameResult.rows[0].table_id;

  const standings = await fetchStandings(client, gameId, tableId);
  const maxCards = Math.max(0, ...standings.map((s) => s.cardCount));
  if (maxCards < WIN_CARD_THRESHOLD) {
    return { none: true };
  }

  const leaders = standings.filter((s) => s.cardCount === maxCards);
  if (leaders.length === 1) {
    return { winnerUserId: leaders[0].userId };
  }
  return { tiedUserIds: leaders.map((l) => l.userId) };
}

// Punktet den Gewinner, gutschreibt +5 Karma an jeden, der die Partie
// beendet hat, und schliesst Spiel und Tisch ab.
export async function finishGame(
  client: Queryable,
  gameId: string,
  winnerUserId: string,
): Promise<void> {
  const gameResult = await client.query(`SELECT table_id FROM game WHERE id = $1`, [gameId]);
  const tableId = gameResult.rows[0].table_id;

  const standings = await fetchStandings(client, gameId, tableId);
  const opponentCount = Math.max(0, standings.length - 1);
  const winPoints = 1 + opponentCount;

  await client.query(
    `INSERT INTO score_ledger (user_id, game_id, delta, reason) VALUES ($1, $2, $3, 'match_win')`,
    [winnerUserId, gameId, winPoints],
  );
  await client.query(`UPDATE app_user SET score_points = score_points + $1 WHERE id = $2`, [
    winPoints,
    winnerUserId,
  ]);

  for (const standing of standings) {
    await client.query(
      `INSERT INTO karma_ledger (user_id, game_id, delta, reason) VALUES ($1, $2, 5, 'match_completed')`,
      [standing.userId, gameId],
    );
    await client.query(`UPDATE app_user SET karma_points = karma_points + 5 WHERE id = $1`, [
      standing.userId,
    ]);

    // games_played zaehlt "am Tisch gesessen und mindestens eine Runde
    // gespielt" - eine guess-Zeile ist das eigentliche Signal dafuer, nicht
    // nur das Sitzen. Nur den bis zum Spielende aktiven Spielern
    // gutgeschrieben, konsistent mit applyEarlyLeavePenalty unten.
    const playedResult = await client.query(
      `SELECT EXISTS(
         SELECT 1 FROM guess g JOIN round r ON r.id = g.round_id
         WHERE r.game_id = $1 AND g.user_id = $2
       ) AS played`,
      [gameId, standing.userId],
    );
    if (playedResult.rows[0].played) {
      await client.query(`UPDATE app_user SET games_played = games_played + 1 WHERE id = $1`, [
        standing.userId,
      ]);
    }
  }

  await client.query(
    `UPDATE game SET status = 'finished', winner_user_id = $1, ended_at = NOW() WHERE id = $2`,
    [winnerUserId, gameId],
  );
  await client.query(`UPDATE game_table SET state = 'finished', match_ended_at = NOW() WHERE id = $1`, [tableId]);

  // Ueberlebt die Tisch-Bereinigung nach ~1h Inaktivitaet (siehe
  // tableCleanup.ts) - der "insgesamt gespielte Spiele"-Zaehler auf der
  // Startseite zaehlt sonst nicht mehr korrekt, sobald alte Tische
  // hart geloescht werden.
  await client.query(
    `INSERT INTO system_setting (key, value) VALUES ('total_games_finished', '1')
     ON CONFLICT (key) DO UPDATE SET value = (system_setting.value::int + 1)::text, updated_at = NOW()`,
  );
}

// Vorzeitiges Verlassen mitten in der Partie kostet -5, plus -1 pro
// weiterem noch sitzenden Spieler. Ueber das Ledger selbst dedupliziert, so
// dass ein wiederholt getriggerter Check niemanden doppelt bestraft.
export async function applyEarlyLeavePenalty(
  client: Queryable,
  gameId: string,
  tableId: string,
  userId: string,
): Promise<void> {
  const alreadyPenalizedResult = await client.query(
    `SELECT id FROM karma_ledger WHERE user_id = $1 AND game_id = $2 AND reason = 'early_leave'`,
    [userId, gameId],
  );
  if ((alreadyPenalizedResult.rowCount ?? 0) > 0) {
    return;
  }

  const remainingPlayersResult = await client.query(
    `SELECT COUNT(*)::int AS count FROM table_seat
     WHERE table_id = $1 AND seat_type = 'player' AND left_at IS NULL AND user_id != $2`,
    [tableId, userId],
  );
  const penalty = -5 - remainingPlayersResult.rows[0].count;

  await client.query(
    `INSERT INTO karma_ledger (user_id, game_id, delta, reason) VALUES ($1, $2, $3, 'early_leave')`,
    [userId, gameId, penalty],
  );
  await client.query(`UPDATE app_user SET karma_points = karma_points + $1 WHERE id = $2`, [
    penalty,
    userId,
  ]);
}

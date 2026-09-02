import { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { RoundEngineError } from './errors';

type Queryable = PoolClient | typeof pool;

export interface SelectedTrailer {
  id: string;
  title: string;
  yearValue: number;
}

// Portierung von songsters songPool.ts's selectSongForGame(): Kandidaten
// sind gueltige Trailer, die weder in dieser Partie noch in dieser
// Tisch-Session schon gezeigt wurden; einmal ausgeschoepft, wird der
// Session-Verlauf zurueckgesetzt, damit Wiederholungen wieder moeglich
// werden.
export async function selectTrailerForGame(
  client: Queryable,
  gameId: string,
  tableSessionId: string,
): Promise<SelectedTrailer> {
  const candidates = await fetchCandidates(client, gameId, tableSessionId);

  if (candidates.length > 0) {
    const trailer = pickRandom(candidates);
    await markPlayed(client, trailer.id);
    return trailer;
  }

  // Ein begrenzter Pool (siehe trailerBatch.ts) ist das "Total", gegen das
  // der Session-Verlauf auf Ausschoepfung geprueft wird - nicht die
  // gesamte trailer_ref-Bibliothek, sonst gilt eine Session mit
  // 50-Trailer-Batch nie als ausgeschoepft, solange andere Trailer noch in
  // der Bibliothek liegen.
  const totalValidResult = await client.query(
    `SELECT COUNT(*)::int AS count FROM trailer_ref tr
     WHERE tr.is_valid = TRUE AND tr.clip_status = 'ready'
       AND (
         NOT EXISTS (SELECT 1 FROM table_session_trailer_pool WHERE table_session_id = $1)
         OR tr.id IN (SELECT trailer_ref_id FROM table_session_trailer_pool WHERE table_session_id = $1)
       )`,
    [tableSessionId],
  );
  const historyCountResult = await client.query(
    `SELECT COUNT(*)::int AS count FROM session_trailer_history WHERE table_session_id = $1`,
    [tableSessionId],
  );
  const poolExhausted =
    totalValidResult.rows[0].count > 0 &&
    historyCountResult.rows[0].count >= totalValidResult.rows[0].count;

  if (poolExhausted) {
    await client.query(`DELETE FROM session_trailer_history WHERE table_session_id = $1`, [tableSessionId]);
    const candidatesAfterReset = await fetchCandidates(client, gameId, tableSessionId);
    if (candidatesAfterReset.length > 0) {
      const trailer = pickRandom(candidatesAfterReset);
      await markPlayed(client, trailer.id);
      return trailer;
    }
  }

  throw new RoundEngineError('NO_TRAILERS_AVAILABLE', 'no eligible trailers left in the library');
}

// Malus-/Wiederholungsvermeidungs-Buchfuehrung, unabhaengig vom
// clip_status. Nur bei tatsaechlicher Auswahl aktualisiert (nicht beim
// Batch-Einfuegen, siehe trailerBatch.ts).
async function markPlayed(client: Queryable, trailerId: string): Promise<void> {
  await client.query(`UPDATE trailer_ref SET last_played_at = NOW() WHERE id = $1`, [trailerId]);
}

async function fetchCandidates(
  client: Queryable,
  gameId: string,
  tableSessionId: string,
): Promise<SelectedTrailer[]> {
  const result = await client.query(
    `SELECT tr.id, tr.title, tr.year_value
     FROM trailer_ref tr
     WHERE tr.is_valid = TRUE AND tr.clip_status = 'ready'
       AND tr.id NOT IN (SELECT trailer_id FROM round WHERE game_id = $1)
       AND tr.id NOT IN (SELECT trailer_ref_id FROM session_trailer_history WHERE table_session_id = $2)
       AND (
         NOT EXISTS (SELECT 1 FROM table_session_trailer_pool WHERE table_session_id = $2)
         OR tr.id IN (SELECT trailer_ref_id FROM table_session_trailer_pool WHERE table_session_id = $2)
       )`,
    [gameId, tableSessionId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    yearValue: row.year_value,
  }));
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

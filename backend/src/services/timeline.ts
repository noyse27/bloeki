import { PoolClient } from 'pg';
import { pool } from '../db/pool';

type Queryable = PoolClient | typeof pool;

export interface TimelineEntry {
  yearValue: number;
}

// Jeder Spieler startet mit 2 Karten, gezogen aus einer Spanne abgeleitet
// aus den Jahren der aktuellen Trailer-Bibliothek/Session-Auswahl.
const START_BLOCKS_PER_PLAYER = 2;

export async function fetchTimeline(client: Queryable, gameId: string, userId: string): Promise<TimelineEntry[]> {
  const result = await client.query(
    `SELECT year_value FROM timeline_card
     WHERE game_id = $1 AND user_id = $2
     ORDER BY placed_position ASC`,
    [gameId, userId],
  );
  return result.rows.map((row) => ({ yearValue: row.year_value }));
}

// Richtig, wenn der geratene Einfuegepunkt die relative Reihenfolge zu den
// Nachbarkarten respektiert; gleiche Jahre an der Grenze zaehlen ebenfalls
// als richtig (durch <= auf beiden Seiten).
export function isPlacementCorrect(timeline: TimelineEntry[], index: number, trailerYear: number): boolean {
  const lower = index > 0 ? timeline[index - 1].yearValue : null;
  const upper = index < timeline.length ? timeline[index].yearValue : null;
  return (lower === null || lower <= trailerYear) && (upper === null || trailerYear <= upper);
}

export function findSortedInsertIndex(timeline: TimelineEntry[], year: number): number {
  return timeline.filter((entry) => entry.yearValue <= year).length;
}

export async function insertCardAndReindex(
  client: Queryable,
  opts: {
    gameId: string;
    userId: string;
    sourceRoundId: string | null;
    trailerYear: number;
    index: number;
  },
): Promise<void> {
  await client.query(
    `UPDATE timeline_card SET placed_position = placed_position + 1
     WHERE game_id = $1 AND user_id = $2 AND placed_position >= $3`,
    [opts.gameId, opts.userId, opts.index],
  );
  await client.query(
    `INSERT INTO timeline_card (game_id, user_id, source_round_id, year_value, special_type, placed_position)
     VALUES ($1, $2, $3, $4, 'normal', $5)`,
    [opts.gameId, opts.userId, opts.sourceRoundId, opts.trailerYear, opts.index],
  );
}

// Wenn tableSessionId gegeben ist und diese Session einen begrenzten Pool
// hat (table_session_trailer_pool - befuellt vom Batch-Zug bei
// Session-Start, siehe trailerBatch.ts), wird die Spanne nur aus diesem Pool
// abgeleitet statt aus der gesamten trailer_ref-Bibliothek. Eine Session
// ohne Pool-Zeilen faellt auf die gesamte Bibliothek zurueck.
export async function computeYearRange(
  client: Queryable,
  tableSessionId?: string,
): Promise<{ lower: number; upper: number } | null> {
  const result = tableSessionId
    ? await client.query(
        `SELECT MIN(tr.year_value) AS min_year, MAX(tr.year_value) AS max_year
         FROM trailer_ref tr
         WHERE tr.is_valid = TRUE AND tr.clip_status = 'ready'
           AND (
             NOT EXISTS (SELECT 1 FROM table_session_trailer_pool WHERE table_session_id = $1)
             OR tr.id IN (SELECT trailer_ref_id FROM table_session_trailer_pool WHERE table_session_id = $1)
           )`,
        [tableSessionId],
      )
    : await client.query(
        `SELECT MIN(year_value) AS min_year, MAX(year_value) AS max_year
         FROM trailer_ref WHERE is_valid = TRUE AND clip_status = 'ready'`,
      );
  const { min_year: minYear, max_year: maxYear } = result.rows[0];
  if (minYear === null || maxYear === null) {
    return null;
  }
  // Hoechstes Trailer-Jahr + 10, aber nie spaeter als heute - eine
  // Startkarte hat kein zukuenftiges Erscheinungsjahr verdient, nur weil der
  // neueste Trailer im Pool aktuell ist.
  const currentYear = new Date().getUTCFullYear();
  return {
    lower: minYear - 10,
    upper: Math.min(maxYear + 10, currentYear),
  };
}

function randomYearInRange(lower: number, upper: number): number {
  return lower + Math.floor(Math.random() * (upper - lower + 1));
}

export async function generateStartBlocks(
  client: Queryable,
  gameId: string,
  playerUserIds: string[],
  tableSessionId?: string,
): Promise<void> {
  const range = await computeYearRange(client, tableSessionId);
  if (!range) {
    throw new Error('cannot generate start blocks without any valid trailers in the library');
  }

  // Gleiche Startjahre fuer jeden Spieler, einmal gezogen - nicht ein
  // zufaelliges Paar pro Spieler. Ohne Wiederholung gezogen: zwei gleiche
  // Startjahre wuerden jedem Spieler zwei ununterscheidbare Startkarten
  // geben, was die Regeln nicht erlauben.
  const years: number[] = [];
  while (years.length < START_BLOCKS_PER_PLAYER) {
    const candidate = randomYearInRange(range.lower, range.upper);
    if (!years.includes(candidate)) {
      years.push(candidate);
    }
  }
  years.sort((a, b) => a - b);

  for (const userId of playerUserIds) {
    for (let position = 0; position < years.length; position += 1) {
      await client.query(
        `INSERT INTO timeline_card (game_id, user_id, source_round_id, year_value, special_type, placed_position)
         VALUES ($1, $2, NULL, $3, 'normal', $4)`,
        [gameId, userId, years[position], position],
      );
    }
  }
}

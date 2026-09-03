import { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { RoundEngineError } from './errors';

type Queryable = PoolClient | typeof pool;

// Portierung von adolar-songster/backend/src/services/adolarBatch.ts's
// selectBatch()/loadAdolarBatch() - dort wurde ein Adolar-Playlist-weiter
// Batch gezogen, hier die gesamte lokale trailer_ref-Bibliothek. Kein
// Artist-Dedupe-Aequivalent (Filme haben keinen "Artist"), sonst
// strukturell identisch: nach Dekade bucketen, per Round-Robin ueber die
// Dekaden-Buckets ziehen, MAX_PER_YEAR-Deckelung, laenger-nicht-gespielte
// Trailer zuerst.
//
// Anders als bei songster ist bloekis Bibliothek extrem schief verteilt
// (2020er ueber 1000x so viele Trailer wie die 1920er) - eine
// Gleichverteilung ueber Dekaden wuerde die winzigen, seltenen alten
// Jahrzehnte auf denselben Pool-Anteil wie die riesigen aktuellen heben.
// Deshalb bekommt jede Dekade eine Quote proportional zur Quadratwurzel
// ihrer verfuegbaren Trailerzahl (siehe computeDecadeQuotas) statt eines
// fixen 1-pro-Pass-Anteils - alte Klassiker bleiben vertreten, dominieren
// den Pool aber nicht mehr.
const BATCH_SIZE = 50;
const MAX_PER_YEAR = 2;

// Quadratwurzel statt linearer Anteil: daempft den Vorsprung der riesigen
// Dekaden (2010er/2020er), ohne sie auf Gleichstand mit den winzigen alten
// Dekaden zu druecken. Jede nicht-leere Dekade bekommt mindestens 1 Slot,
// damit gelegentlich noch ein echter Klassiker auftaucht.
function computeDecadeQuotas(bucketSizes: Map<number, number>, batchSize: number): Map<number, number> {
  const weights = new Map<number, number>();
  for (const [decade, size] of bucketSizes) weights.set(decade, Math.sqrt(size));
  const totalWeight = [...weights.values()].reduce((sum, w) => sum + w, 0);

  const quotas = new Map<number, number>();
  for (const [decade, weight] of weights) {
    const bucketSize = bucketSizes.get(decade) as number;
    const share = totalWeight > 0 ? Math.round((weight / totalWeight) * batchSize) : 0;
    quotas.set(decade, Math.max(1, Math.min(bucketSize, share)));
  }
  return quotas;
}

export interface TrailerBatchCandidate {
  trailerRefId: string;
  yearValue: number;
  lastPlayedAt: string | null;
}

export function selectBatch(candidates: TrailerBatchCandidate[]): TrailerBatchCandidate[] {
  const sorted = [...candidates].sort((a, b) => {
    if (a.lastPlayedAt === null && b.lastPlayedAt === null) return 0;
    if (a.lastPlayedAt === null) return -1;
    if (b.lastPlayedAt === null) return 1;
    return new Date(a.lastPlayedAt).getTime() - new Date(b.lastPlayedAt).getTime();
  });

  const buckets = new Map<number, TrailerBatchCandidate[]>();
  for (const candidate of sorted) {
    const decade = Math.floor(candidate.yearValue / 10) * 10;
    const bucket = buckets.get(decade);
    if (bucket) {
      bucket.push(candidate);
    } else {
      buckets.set(decade, [candidate]);
    }
  }
  const bucketKeys = [...buckets.keys()].sort((a, b) => a - b);
  const bucketSizes = new Map(bucketKeys.map((decade) => [decade, (buckets.get(decade) as TrailerBatchCandidate[]).length]));
  const quotas = computeDecadeQuotas(bucketSizes, BATCH_SIZE);

  const selected: TrailerBatchCandidate[] = [];
  const yearCounts = new Map<number, number>();
  const takenPerDecade = new Map<number, number>();

  function takeFrom(decade: number): boolean {
    const bucket = buckets.get(decade) as TrailerBatchCandidate[];
    const index = bucket.findIndex((candidate) => (yearCounts.get(candidate.yearValue) ?? 0) < MAX_PER_YEAR);
    if (index === -1) return false;
    const [candidate] = bucket.splice(index, 1);
    yearCounts.set(candidate.yearValue, (yearCounts.get(candidate.yearValue) ?? 0) + 1);
    takenPerDecade.set(decade, (takenPerDecade.get(decade) ?? 0) + 1);
    selected.push(candidate);
    return true;
  }

  // Erste Phase: Round-Robin ueber die Dekaden, aber jede Dekade stoppt an
  // ihrer eigenen Quote statt unbegrenzt weiterzuziehen.
  let remaining = true;
  while (selected.length < BATCH_SIZE && remaining) {
    remaining = false;
    for (const decade of bucketKeys) {
      if (selected.length >= BATCH_SIZE) break;
      if ((takenPerDecade.get(decade) ?? 0) >= (quotas.get(decade) as number)) continue;
      if (takeFrom(decade)) remaining = true;
    }
  }

  // Zweite Phase: Rundungsfehler bei den Quoten (oder eine Dekade, die
  // ihre eigene Quote nicht voll ausschoepfen konnte) sollen den Batch
  // nicht kleiner als noetig machen - mit dem auffuellen, was noch da ist.
  for (const decade of bucketKeys) {
    while (selected.length < BATCH_SIZE && takeFrom(decade)) {
      // no-op - takeFrom() macht die eigentliche Arbeit
    }
    if (selected.length >= BATCH_SIZE) break;
  }

  return selected;
}

// Gezogen einmalig bei Session-Start (siehe tableStart.ts), befuellt
// table_session_trailer_pool - die Session bleibt danach auf diesen Batch
// beschraenkt (siehe timeline.ts's computeYearRange und die
// Rundenauswahl unten).
export async function loadTrailerBatch(client: Queryable): Promise<string[]> {
  const result = await client.query(
    `SELECT id, year_value, last_played_at FROM trailer_ref
     WHERE is_valid = TRUE AND clip_status = 'ready'`,
  );

  if (result.rowCount === 0) {
    throw new RoundEngineError(
      'NO_TRAILERS_AVAILABLE',
      'no trailers found - run tools/snippet-cutter and wait for the next backend scan',
    );
  }

  const candidates: TrailerBatchCandidate[] = result.rows.map((row) => ({
    trailerRefId: row.id,
    yearValue: row.year_value,
    lastPlayedAt: row.last_played_at,
  }));

  const batch = selectBatch(candidates);
  return batch.map((candidate) => candidate.trailerRefId);
}

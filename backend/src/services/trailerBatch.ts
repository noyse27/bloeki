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
const BATCH_SIZE = 50;
const MAX_PER_YEAR = 2;

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

  const selected: TrailerBatchCandidate[] = [];
  const yearCounts = new Map<number, number>();
  let remaining = true;
  while (selected.length < BATCH_SIZE && remaining) {
    remaining = false;
    for (const decade of bucketKeys) {
      if (selected.length >= BATCH_SIZE) break;
      const bucket = buckets.get(decade) as TrailerBatchCandidate[];
      const index = bucket.findIndex(
        (candidate) => (yearCounts.get(candidate.yearValue) ?? 0) < MAX_PER_YEAR,
      );
      if (index === -1) continue;
      const [candidate] = bucket.splice(index, 1);
      yearCounts.set(candidate.yearValue, (yearCounts.get(candidate.yearValue) ?? 0) + 1);
      selected.push(candidate);
      remaining = true;
    }
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

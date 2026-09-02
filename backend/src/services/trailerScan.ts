import { promises as fs } from 'fs';
import path from 'path';
import cron from 'node-cron';
import { pool } from '../db/pool';

// Duplikat von shared/trailerFilename.ts (Repo-Root) - siehe dessen
// Kopf-Kommentar: kein echtes npm-Workspace-Package, weil tools/snippet-cutter
// bewusst keine Laufzeit-Abhaengigkeit zu diesem Backend haben soll. Bei
// einer Aenderung des Dateinamensmusters MUSS diese Kopie synchron mit
// shared/trailerFilename.ts und tools/snippet-cutter/src/trailerFilename.ts
// gehalten werden.
const TRAILER_FILENAME_PATTERN = /^trailer-(.+?)\s\((\d{4})\)\s\{imdb-id\s+(tt\d+)\}$/;

interface ParsedTrailerFilename {
  title: string;
  year: number;
  imdbId: string;
}

function parseTrailerFilename(basenameWithoutExt: string): ParsedTrailerFilename | null {
  const match = TRAILER_FILENAME_PATTERN.exec(basenameWithoutExt);
  if (!match) return null;
  const [, title, yearRaw, imdbId] = match;
  return { title, year: Number(yearRaw), imdbId };
}

// Der Snippet-Ordner (siehe tools/snippet-cutter), im Backend-Container z.B.
// unter /data/clips gemountet (read-only, siehe docker-compose.yml).
const CLIP_DIR = process.env.TRAILER_CLIP_DIR ?? '/data/clips';

// Alle 15 Minuten per Default - leichtgewichtig genug fuer die Synology
// (nur Dateisystem-Scan + DB-Upsert, KEIN ffmpeg/ffprobe hier - das
// rechenintensive Zuschneiden passiert ausschliesslich in
// tools/snippet-cutter auf dem staerkeren Windows-PC).
const SCAN_INTERVAL_CRON = process.env.TRAILER_SCAN_INTERVAL_CRON ?? '*/15 * * * *';

export interface TrailerScanResult {
  scanned: number;
  upserted: number;
  markedMissing: number;
  unmatched: string[];
}

async function listMp4Files(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    console.error(`[trailer-scan] cannot read clip dir ${dir}`, err);
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMp4Files(fullPath)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp4')) {
      files.push(fullPath);
    }
  }
  return files;
}

// Scannt den Snippet-Ordner, matcht jede .mp4 gegen dasselbe Namensmuster
// wie tools/snippet-cutter, und synct das Ergebnis idempotent nach
// trailer_ref (Upsert ueber imdb_id). Dateien, die aus dem Ordner
// verschwunden sind, werden NICHT geloescht, sondern auf
// is_valid=false/clip_status='missing' gesetzt - so bleibt die
// Spielhistorie (last_played_at etc.) erhalten, falls die Datei spaeter
// zurueckkommt (z.B. nach einem Freigabe-Hänger).
export async function scanTrailerClips(): Promise<TrailerScanResult> {
  const files = await listMp4Files(CLIP_DIR);
  const unmatched: string[] = [];
  const seenImdbIds: string[] = [];
  let upserted = 0;

  for (const filePath of files) {
    const basename = path.basename(filePath, path.extname(filePath));
    const parsed = parseTrailerFilename(basename);
    if (!parsed) {
      unmatched.push(path.basename(filePath));
      continue;
    }
    seenImdbIds.push(parsed.imdbId);
    await pool.query(
      `INSERT INTO trailer_ref (imdb_id, title, year_value, clip_path, clip_status, is_valid, updated_at)
       VALUES ($1, $2, $3, $4, 'ready', TRUE, NOW())
       ON CONFLICT (imdb_id) DO UPDATE SET
         title = EXCLUDED.title,
         year_value = EXCLUDED.year_value,
         clip_path = EXCLUDED.clip_path,
         clip_status = 'ready',
         is_valid = TRUE,
         updated_at = NOW()`,
      [parsed.imdbId, parsed.title, parsed.year, filePath],
    );
    upserted += 1;
  }

  const missingResult =
    seenImdbIds.length > 0
      ? await pool.query(
          `UPDATE trailer_ref SET clip_status = 'missing', is_valid = FALSE, updated_at = NOW()
           WHERE clip_status = 'ready' AND NOT (imdb_id = ANY($1::text[]))
           RETURNING id`,
          [seenImdbIds],
        )
      : await pool.query(
          `UPDATE trailer_ref SET clip_status = 'missing', is_valid = FALSE, updated_at = NOW()
           WHERE clip_status = 'ready'
           RETURNING id`,
        );

  if (unmatched.length > 0) {
    console.warn(`[trailer-scan] ${unmatched.length} file(s) did not match the trailer filename pattern`, unmatched);
  }

  return {
    scanned: files.length,
    upserted,
    markedMissing: missingResult.rowCount ?? 0,
    unmatched,
  };
}

export function startTrailerScanSchedule(): void {
  runScan('startup scan');
  cron.schedule(SCAN_INTERVAL_CRON, () => runScan('scheduled scan'));
}

function runScan(reason: string): void {
  scanTrailerClips()
    .then((result) => {
      console.log(
        `[trailer-scan] ${reason}: scanned ${result.scanned}, upserted ${result.upserted}, marked missing ${result.markedMissing}`,
      );
    })
    .catch((err) => {
      console.error(`[trailer-scan] ${reason} failed`, err);
    });
}

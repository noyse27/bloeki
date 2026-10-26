import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { scanTrailerClips } from '../services/trailerScan';
import { trailerFileCache } from '../services/trailerFileCache';
import { storeGameEvent } from '../services/debugLogging';
import {
  getTrailerLibraryConfig,
  inspectTrailerLibraryPath,
  restoreTrailerLibraryPath,
  saveTrailerLibraryPath,
} from '../services/trailerLibraryConfig';

export const trailersRouter = Router();

// Liefert die zugeschnittene Trailer-Datei mit Range-Header-Unterstuetzung
// direkt aus dem lokal gemounteten Snippet-Ordner - adaptiert von
// adolar-songster/backend/src/routes/songs.ts's Streaming-Pattern, das dort
// stattdessen zu Adolar proxyte. bloeki braucht keinen Proxy: die Datei
// liegt schon lokal (read-only Bind-Mount, siehe docker-compose.yml), also
// direktes fs.createReadStream mit eigenem Range-Parsing statt eines
// Upstream-fetch.
//
// Bewusst NICHT hinter requireAuth: ein <video src> kann keinen
// Authorization-Header mitschicken, und die URL traegt nur eine nicht
// erratbare trailer_ref-UUID (nie Titel/Jahr) - gleiche Abwaegung wie bei
// songsters Song-Stream-Route.
trailersRouter.get('/trailers/:trailerId/stream', async (req, res) => {
  const requestStartedAt = Date.now();
  const { trailerId } = req.params;
  const result = await pool.query(
    `SELECT clip_path, clip_status, imdb_id, title, year_value FROM trailer_ref WHERE id = $1`,
    [trailerId],
  );
  if (result.rowCount === 0) {
    res.status(404).json({ error: 'trailer not found' });
    return;
  }
  const trailer = result.rows[0];
  if (trailer.clip_status !== 'ready') {
    res.status(404).json({ error: 'trailer clip not available' });
    return;
  }

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(trailer.clip_path);
  } catch {
    res.status(404).json({ error: 'trailer clip file missing on disk' });
    return;
  }

  const fileSize = stat.size;
  const range = req.headers.range;
  res.setHeader('Cache-Control', 'private, max-age=3600, immutable');

  // Ein vorreservierter Trailer liegt normalerweise bereits im RAM. Falls
  // Browser-Prefetch und sichtbarer Player gleichzeitig anfragen, teilen sie
  // sich auch bei einem kalten Cache denselben Lesevorgang. Uebergrosse
  // Dateien werden weiterhin klassisch gestreamt.
  const cacheHit = trailerFileCache.has(trailer.clip_path, stat);
  const cached = await trailerFileCache.load(trailer.clip_path, stat);
  const requestedGameId = typeof req.query.gameId === 'string' && /^[0-9a-f-]{36}$/i.test(req.query.gameId)
    ? req.query.gameId
    : null;
  void storeGameEvent({
    eventType: 'trailer_stream_ready',
    gameId: requestedGameId,
    requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null,
    payload: {
      trailerId,
      imdbId: trailer.imdb_id,
      title: trailer.title,
      year: trailer.year_value,
      fileName: path.basename(trailer.clip_path),
      bytes: fileSize,
      range: range ?? null,
      cacheHit,
      servedFromMemory: Boolean(cached),
      elapsedMs: Date.now() - requestStartedAt,
      userAgent: req.headers['user-agent'] ?? null,
    },
  });

  if (!range) {
    res.status(200);
    res.setHeader('Content-Length', fileSize);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    if (cached) res.end(cached);
    else fs.createReadStream(trailer.clip_path).pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
    return;
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : fileSize - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= fileSize) {
    res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
    return;
  }

  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Length', end - start + 1);
  res.setHeader('Content-Type', 'video/mp4');
  if (cached) res.end(cached.subarray(start, end + 1));
  else fs.createReadStream(trailer.clip_path, { start, end }).pipe(res);
});

// Admin: manueller Scan-Trigger zusaetzlich zum zyklischen node-cron-Job
// (siehe services/trailerScan.ts) - z.B. direkt nachdem tools/snippet-cutter
// neue Trailer geschnitten hat, ohne bis zu 15 Minuten zu warten.
trailersRouter.post('/admin/trailers/scan', requireAuth, requireAdmin, async (_req, res) => {
  const result = await scanTrailerClips();
  res.status(200).json(result);
});

trailersRouter.get('/admin/trailers/library', requireAuth, requireAdmin, async (_req, res) => {
  const config = await getTrailerLibraryConfig();
  let readable = false;
  let error: string | null = null;
  if (config.path) {
    try {
      await inspectTrailerLibraryPath(config.path);
      readable = true;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Bibliothekspfad ist nicht lesbar.';
    }
  }
  res.status(200).json({ ...config, readable, error });
});

trailersRouter.put('/admin/trailers/library', requireAuth, requireAdmin, async (req, res) => {
  const current = await getTrailerLibraryConfig();
  if (!current.editable) {
    res.status(409).json({ error: 'Der Bibliothekspfad wird durch TRAILER_CLIP_DIR vorgegeben.' });
    return;
  }
  try {
    await saveTrailerLibraryPath(req.body?.path);
    const saved = await getTrailerLibraryConfig();
    if (!saved.path) throw new Error('Bibliothekspfad konnte nicht gespeichert werden.');
    try {
      await inspectTrailerLibraryPath(saved.path);
    } catch (err) {
      await restoreTrailerLibraryPath(current.path);
      throw err;
    }
    const scan = await scanTrailerClips();
    const config = await getTrailerLibraryConfig();
    res.status(200).json({ ...config, readable: true, error: null, scan });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Bibliothekspfad konnte nicht gespeichert werden.',
    });
  }
});

trailersRouter.get('/admin/trailers', requireAuth, requireAdmin, async (_req, res) => {
  const result = await pool.query(
    `SELECT id, imdb_id, title, year_value, clip_status, is_valid, last_played_at, updated_at
     FROM trailer_ref ORDER BY updated_at DESC`,
  );
  res.status(200).json({
    total: result.rowCount ?? 0,
    trailers: result.rows.map((row) => ({
      trailerId: row.id,
      imdbId: row.imdb_id,
      title: row.title,
      year: row.year_value,
      clipStatus: row.clip_status,
      isValid: row.is_valid,
      lastPlayedAt: row.last_played_at,
      updatedAt: row.updated_at,
    })),
  });
});

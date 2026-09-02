import { Router } from 'express';
import fs from 'fs';
import { pool } from '../db/pool';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { scanTrailerClips } from '../services/trailerScan';

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
  const { trailerId } = req.params;
  const result = await pool.query(
    `SELECT clip_path, clip_status FROM trailer_ref WHERE id = $1`,
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

  if (!range) {
    res.status(200);
    res.setHeader('Content-Length', fileSize);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    fs.createReadStream(trailer.clip_path).pipe(res);
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
  fs.createReadStream(trailer.clip_path, { start, end }).pipe(res);
});

// Admin: manueller Scan-Trigger zusaetzlich zum zyklischen node-cron-Job
// (siehe services/trailerScan.ts) - z.B. direkt nachdem tools/snippet-cutter
// neue Trailer geschnitten hat, ohne bis zu 15 Minuten zu warten.
trailersRouter.post('/admin/trailers/scan', requireAuth, requireAdmin, async (_req, res) => {
  const result = await scanTrailerClips();
  res.status(200).json(result);
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

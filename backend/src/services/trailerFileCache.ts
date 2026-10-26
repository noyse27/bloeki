import fs from 'fs';
import { pool } from '../db/pool';

const DEFAULT_MAX_CACHE_BYTES = 256 * 1024 * 1024;

interface CachedTrailer {
  buffer: Buffer;
  size: number;
  mtimeMs: number;
}

function configuredMaxBytes(): number {
  const configuredMb = Number(process.env.TRAILER_CACHE_MAX_MB ?? 256);
  if (!Number.isFinite(configuredMb) || configuredMb <= 0) return DEFAULT_MAX_CACHE_BYTES;
  return Math.floor(configuredMb * 1024 * 1024);
}

/**
 * Groessenbegrenzter LRU-Cache fuer Trailer-Dateien. Laufende Lesevorgaenge
 * werden pro Pfad geteilt, damit Browser-Prefetch und sichtbarer Player eine
 * kalte Datei nicht gleichzeitig zweimal vom Datentraeger lesen.
 */
export class TrailerFileCache {
  private readonly entries = new Map<string, CachedTrailer>();
  private readonly pending = new Map<string, Promise<Buffer | null>>();
  private usedBytes = 0;

  constructor(private readonly maxBytes: number) {}

  async load(filePath: string, stat: fs.Stats): Promise<Buffer | null> {
    if (stat.size > this.maxBytes) return null;

    const cached = this.entries.get(filePath);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
      // Map-Reihenfolge repraesentiert die LRU-Reihenfolge.
      this.entries.delete(filePath);
      this.entries.set(filePath, cached);
      return cached.buffer;
    }
    if (cached) this.remove(filePath, cached);

    const alreadyPending = this.pending.get(filePath);
    if (alreadyPending) return alreadyPending;

    const loading = fs.promises.readFile(filePath).then((buffer) => {
      // Die Datei koennte waehrend des Lesens ausgetauscht worden sein. Nur
      // den erwarteten Stand cachen; der Aufrufer darf den gelesenen Buffer
      // fuer diese eine Antwort trotzdem verwenden.
      if (buffer.length !== stat.size) return buffer;
      this.makeRoom(buffer.length);
      const entry = { buffer, size: stat.size, mtimeMs: stat.mtimeMs };
      this.entries.set(filePath, entry);
      this.usedBytes += buffer.length;
      return buffer;
    }).finally(() => {
      this.pending.delete(filePath);
    });

    this.pending.set(filePath, loading);
    return loading;
  }

  private makeRoom(bytes: number): void {
    while (this.usedBytes + bytes > this.maxBytes) {
      const oldest = this.entries.entries().next().value as [string, CachedTrailer] | undefined;
      if (!oldest) break;
      this.remove(oldest[0], oldest[1]);
    }
  }

  private remove(filePath: string, entry: CachedTrailer): void {
    this.entries.delete(filePath);
    this.usedBytes -= entry.buffer.length;
  }
}

export const trailerFileCache = new TrailerFileCache(configuredMaxBytes());

export async function warmTrailerFile(trailerId: string): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = await pool.query(
      `SELECT clip_path FROM trailer_ref WHERE id = $1 AND is_valid = TRUE AND clip_status = 'ready'`,
      [trailerId],
    );
    if (result.rowCount === 0) return;
    const filePath = result.rows[0].clip_path as string;
    const stat = await fs.promises.stat(filePath);
    const buffer = await trailerFileCache.load(filePath, stat);
    if (buffer) {
      console.info(`[trailer-cache] warmed ${trailerId}: ${buffer.length} bytes in ${Date.now() - startedAt}ms`);
    }
  } catch (err) {
    console.warn(`[trailer-cache] failed to warm ${trailerId}`, err);
  }
}

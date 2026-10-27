const DEFAULT_CHUNK_SIZE = 256 * 1024;
// Erfolgreiche 256-KB-Blöcke lagen in Heim- und Firmennetz deutlich unter
// einer Sekunde. Ein festhängender Proxy-Transfer erholte sich dagegen auch
// nach drei Sekunden nicht; 1,5 Sekunden geben langsamen Blöcken Reserve und
// starten den nachweislich wirksameren Retry trotzdem wesentlich früher.
const DEFAULT_TIMEOUT_MS = 1500;
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_TRAILER_BYTES = 128 * 1024 * 1024;

interface ChunkedFetchOptions {
  signal: AbortSignal;
  chunkSize?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  onRetry?: (details: { start: number; end: number; attempt: number; errorMessage: string }) => void;
}

export interface ChunkedTrailerBlob {
  blob: Blob;
  bytes: number;
  chunks: number;
  retries: number;
}

interface FetchedChunk {
  data: Uint8Array<ArrayBuffer>;
  end: number;
  total: number;
  contentType: string;
}

/**
 * Laedt einen Trailer bewusst in kleinen HTTP-Range-Antworten. Einige
 * Reverse-Proxies lassen grosse 200-Antworten kurz vor dem Ende bis zum
 * Keep-Alive-Timeout haengen; kleine, einzeln wiederholbare 206-Antworten
 * umgehen genau dieses Verhalten.
 */
export async function fetchTrailerBlobInChunks(
  url: string,
  options: ChunkedFetchOptions,
): Promise<ChunkedTrailerBlob> {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const fetchImpl = options.fetchImpl ?? fetch;
  if (chunkSize <= 0 || timeoutMs <= 0 || maxAttempts <= 0) throw new Error('Invalid chunked-fetch options');

  const parts: Uint8Array<ArrayBuffer>[] = [];
  let start = 0;
  let total: number | null = null;
  let contentType = 'video/mp4';
  let retries = 0;

  while (total === null || start < total) {
    // Nach dem ersten Block kennen wir die Gesamtgroesse. Das Backend lehnt
    // Ranges, deren Ende hinter der Datei liegt, standardkonform mit 416 ab;
    // daher muss gerade der letzte Block exakt am Dateiende enden.
    const requestedEnd = total === null
      ? start + chunkSize - 1
      : Math.min(start + chunkSize - 1, total - 1);
    let chunk: FetchedChunk | null = null;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (options.signal.aborted) throw abortError();
      try {
        chunk = await fetchChunk(fetchImpl, url, start, requestedEnd, timeoutMs, options.signal);
        break;
      } catch (err) {
        if (options.signal.aborted) throw abortError();
        lastError = err;
        if (attempt >= maxAttempts) break;
        retries += 1;
        options.onRetry?.({
          start,
          end: requestedEnd,
          attempt: attempt + 1,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (!chunk) throw lastError instanceof Error ? lastError : new Error(String(lastError));
    if (chunk.total > MAX_TRAILER_BYTES) throw new Error(`Trailer exceeds ${MAX_TRAILER_BYTES} bytes`);
    if (total !== null && chunk.total !== total) throw new Error('Trailer size changed during prefetch');
    total = chunk.total;
    contentType = chunk.contentType || contentType;
    parts.push(chunk.data);
    start = chunk.end + 1;
  }

  const blob = new Blob(parts, { type: contentType });
  if (blob.size !== total) throw new Error(`Incomplete trailer prefetch: ${blob.size}/${total} bytes`);
  return { blob, bytes: blob.size, chunks: parts.length, retries };
}

async function fetchChunk(
  fetchImpl: typeof fetch,
  url: string,
  start: number,
  end: number,
  timeoutMs: number,
  outerSignal: AbortSignal,
): Promise<FetchedChunk> {
  const controller = new AbortController();
  const abortFromOuter = () => controller.abort();
  outerSignal.addEventListener('abort', abortFromOuter, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { Range: `bytes=${start}-${end}` },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (response.status !== 206) throw new Error(`Expected HTTP 206, got ${response.status}`);
    const contentRange = parseContentRange(response.headers.get('content-range'));
    if (!contentRange || contentRange.start !== start || contentRange.end > end) {
      throw new Error(`Invalid Content-Range: ${response.headers.get('content-range') ?? 'missing'}`);
    }
    const buffer = await response.arrayBuffer();
    const expectedBytes = contentRange.end - contentRange.start + 1;
    if (buffer.byteLength !== expectedBytes) {
      throw new Error(`Incomplete range: ${buffer.byteLength}/${expectedBytes} bytes`);
    }
    return {
      data: new Uint8Array(buffer),
      end: contentRange.end,
      total: contentRange.total,
      contentType: response.headers.get('content-type') ?? 'video/mp4',
    };
  } finally {
    window.clearTimeout(timeout);
    outerSignal.removeEventListener('abort', abortFromOuter);
  }
}

function parseContentRange(value: string | null): { start: number; end: number; total: number } | null {
  const match = value ? /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(value) : null;
  if (!match) return null;
  const parsed = { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) };
  if (!Number.isSafeInteger(parsed.start) || !Number.isSafeInteger(parsed.end) ||
      !Number.isSafeInteger(parsed.total) || parsed.start > parsed.end || parsed.end >= parsed.total) {
    return null;
  }
  return parsed;
}

function abortError(): DOMException {
  return new DOMException('Trailer prefetch aborted', 'AbortError');
}

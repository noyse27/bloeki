import { describe, expect, it, vi } from 'vitest';
import { fetchTrailerBlobInChunks } from './fetchTrailerBlobInChunks';

function rangeResponse(bytes: number[], start: number, total: number): Response {
  const end = start + bytes.length - 1;
  return new Response(new Uint8Array(bytes), {
    status: 206,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Range': `bytes ${start}-${end}/${total}`,
    },
  });
}

describe('fetchTrailerBlobInChunks', () => {
  it('loads and joins a trailer through bounded range requests', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(rangeResponse([1, 2, 3, 4], 0, 6))
      .mockResolvedValueOnce(rangeResponse([5, 6], 4, 6));

    const result = await fetchTrailerBlobInChunks('/trailer', {
      signal: new AbortController().signal,
      chunkSize: 4,
      fetchImpl,
    });

    expect(Array.from(new Uint8Array(await result.blob.arrayBuffer()))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result).toMatchObject({ bytes: 6, chunks: 2, retries: 0 });
    expect(fetchImpl).toHaveBeenNthCalledWith(1, '/trailer', expect.objectContaining({
      headers: { Range: 'bytes=0-3' },
      cache: 'no-store',
    }));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, '/trailer', expect.objectContaining({
      headers: { Range: 'bytes=4-5' },
    }));
  });

  it('never requests the final range beyond the announced file size', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(rangeResponse([1, 2, 3], 0, 5))
      .mockResolvedValueOnce(rangeResponse([4, 5], 3, 5));

    const result = await fetchTrailerBlobInChunks('/trailer', {
      signal: new AbortController().signal,
      chunkSize: 3,
      fetchImpl,
    });

    expect(result.bytes).toBe(5);
    expect(fetchImpl).toHaveBeenNthCalledWith(2, '/trailer', expect.objectContaining({
      headers: { Range: 'bytes=3-4' },
    }));
  });

  it('retries a failed chunk without restarting completed chunks', async () => {
    const onRetry = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(rangeResponse([1, 2], 0, 4))
      .mockRejectedValueOnce(new Error('proxy stalled'))
      .mockResolvedValueOnce(rangeResponse([3, 4], 2, 4));

    const result = await fetchTrailerBlobInChunks('/trailer', {
      signal: new AbortController().signal,
      chunkSize: 2,
      fetchImpl,
      onRetry,
    });

    expect(result.retries).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ start: 2, end: 3, attempt: 2 }));
  });
});

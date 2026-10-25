import { RefObject, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../api';
import { describeAudioElement } from '../debugLogging';

interface PreparedTrailer {
  path: string;
  objectUrl: string;
  bytes: number;
}

interface BufferedTrailerOptions {
  currentPath: string | null | undefined;
  preparePath: string | null | undefined;
  playing: boolean;
  onEvent: (eventType: string, payload: Record<string, unknown>) => void;
  onUnavailable?: () => void;
}

interface BufferedTrailerResult {
  videoRef: RefObject<HTMLVideoElement>;
  preloadVideoRef: RefObject<HTMLVideoElement>;
}

// `preload="auto"` is only a hint and browsers are free to buffer very
// little. This hook downloads the selected next trailer completely into a
// Blob while also feeding it to a separate, hidden video element so the
// browser can parse metadata/prime its decoder without disturbing the
// currently visible player.
export function useBufferedTrailer({
  currentPath,
  preparePath,
  playing,
  onEvent,
  onUnavailable,
}: BufferedTrailerOptions): BufferedTrailerResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  const preloadVideoRef = useRef<HTMLVideoElement>(null);
  const [prepared, setPrepared] = useState<PreparedTrailer | null>(null);
  const loadedPathRef = useRef<string | null>(null);
  const loadedSourceRef = useRef<string | null>(null);
  const loggerRef = useRef(onEvent);
  const unavailableRef = useRef(onUnavailable);
  loggerRef.current = onEvent;
  unavailableRef.current = onUnavailable;

  useEffect(() => {
    if (!preparePath) {
      setPrepared(null);
      return;
    }

    const controller = new AbortController();
    let objectUrl: string | null = null;
    const startedAt = performance.now();
    loggerRef.current('video_prefetch_start', { trailerStreamPath: preparePath });

    void fetch(`${API_BASE_URL}${preparePath}`, {
      cache: 'force-cache',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setPrepared({ path: preparePath, objectUrl, bytes: blob.size });
        loggerRef.current('video_prefetch_complete', {
          trailerStreamPath: preparePath,
          bytes: blob.size,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        loggerRef.current('video_prefetch_failed', {
          trailerStreamPath: preparePath,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [preparePath]);

  useEffect(() => {
    const preloader = preloadVideoRef.current;
    if (!preloader) return;
    if (!prepared) {
      preloader.removeAttribute('src');
      preloader.load();
      return;
    }
    preloader.src = prepared.objectUrl;
    preloader.load();
  }, [prepared]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!currentPath) {
      video.removeAttribute('src');
      video.load();
      loadedPathRef.current = null;
      loadedSourceRef.current = null;
      return;
    }

    // Never swap sources underneath an already playing trailer. If the full
    // Blob finishes late, it is retained only as diagnostics/cache value;
    // the normal HTTP stream keeps playing uninterrupted.
    if (playing && loadedPathRef.current === currentPath) return;

    // Once the current round is over, `preparePath` points at the next
    // trailer. Keep the paused current source untouched instead of swapping
    // it back from its Blob to HTTP while the next Blob is being prepared.
    if (loadedPathRef.current === currentPath && preparePath !== currentPath) return;

    const source = prepared?.path === currentPath && preparePath === currentPath
      ? prepared.objectUrl
      : `${API_BASE_URL}${currentPath}`;
    if (loadedPathRef.current === currentPath && loadedSourceRef.current === source) return;
    video.src = source;
    video.load();
    loadedPathRef.current = currentPath;
    loadedSourceRef.current = source;
    loggerRef.current('video_load_start', {
      trailerStreamPath: currentPath,
      sourceKind: prepared?.path === currentPath && preparePath === currentPath ? 'prefetched-blob' : 'http-stream',
      prefetchedBytes: prepared?.path === currentPath && preparePath === currentPath ? prepared.bytes : null,
      video: describeAudioElement(video),
    });
  }, [currentPath, preparePath, playing, prepared]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const eventTypes = ['loadedmetadata', 'canplay', 'playing', 'waiting', 'stalled', 'error'] as const;
    const listeners = eventTypes.map((eventType) => {
      const listener = () => {
        loggerRef.current(`video_${eventType}`, { video: describeAudioElement(video) });
        if (eventType === 'error') unavailableRef.current?.();
      };
      video.addEventListener(eventType, listener);
      return { eventType, listener };
    });
    return () => listeners.forEach(({ eventType, listener }) => video.removeEventListener(eventType, listener));
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!playing) {
      video.pause();
      return;
    }

    let stopped = false;
    let playPending = false;
    try {
      video.currentTime = 0;
    } catch (err) {
      loggerRef.current('video_seek_failed', {
        errorMessage: err instanceof Error ? err.message : String(err),
        video: describeAudioElement(video),
      });
    }

    const tryPlay = () => {
      if (stopped || playPending || !video.paused) return;
      playPending = true;
      void video.play()
        .then(() => loggerRef.current('video_play_success', { video: describeAudioElement(video) }))
        .catch((err: unknown) => {
          loggerRef.current('video_play_rejected', {
            errorName: err instanceof Error ? err.name : null,
            errorMessage: err instanceof Error ? err.message : String(err),
            video: describeAudioElement(video),
          });
          unavailableRef.current?.();
        })
        .finally(() => {
          playPending = false;
        });
    };

    tryPlay();
    video.addEventListener('canplay', tryPlay);
    const retryId = window.setInterval(tryPlay, 1500);
    return () => {
      stopped = true;
      window.clearInterval(retryId);
      video.removeEventListener('canplay', tryPlay);
    };
  }, [playing, currentPath]);

  return { videoRef, preloadVideoRef };
}

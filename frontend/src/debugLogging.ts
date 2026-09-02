const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
const SESSION_KEY = 'bloeki:debug-client-session-id';
const DEVICE_KEY = 'bloeki:debug-device-id';
const ENABLED_KEY = 'bloeki:debug-enabled';
const MAX_BUFFER = 100;

export interface ClientDebugEvent {
  eventType: string;
  createdAt: string;
  clientSessionId: string;
  deviceId: string;
  clientKind?: 'player' | 'display';
  userId?: string | null;
  tableId?: string | null;
  gameId?: string | null;
  roundId?: string | null;
  roundIndex?: number | null;
  payload?: Record<string, unknown>;
}

let buffer: ClientDebugEvent[] = [];
let flushing = false;

function randomId(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function storageId(storage: Storage, key: string): string {
  const existing = storage.getItem(key);
  if (existing) return existing;
  const next = randomId();
  storage.setItem(key, next);
  return next;
}

export function betaDebugEnabled(): boolean {
  return import.meta.env.VITE_BETA_DEBUG_LOGGING === 'true' || window.localStorage.getItem(ENABLED_KEY) === 'true';
}

export function enableBetaDebugLogging(enabled: boolean): void {
  window.localStorage.setItem(ENABLED_KEY, String(enabled));
}

export function getClientDebugIds(): { clientSessionId: string; deviceId: string } {
  return {
    clientSessionId: storageId(window.sessionStorage, SESSION_KEY),
    deviceId: storageId(window.localStorage, DEVICE_KEY),
  };
}

export function getDebugBuffer(): ClientDebugEvent[] {
  return [...buffer];
}

export function logClientEvent(event: Omit<ClientDebugEvent, 'createdAt' | 'clientSessionId' | 'deviceId'>): void {
  if (!betaDebugEnabled()) return;
  const ids = getClientDebugIds();
  const entry: ClientDebugEvent = {
    ...event,
    ...ids,
    createdAt: new Date().toISOString(),
    payload: {
      route: window.location.pathname,
      visibilityState: document.visibilityState,
      online: navigator.onLine,
      userAgent: navigator.userAgent,
      ...(event.payload ?? {}),
    },
  };
  buffer = [...buffer.slice(-(MAX_BUFFER - 1)), entry];
}

export function snapshotClientDebugContext(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...getClientDebugIds(),
    route: window.location.pathname,
    visibilityState: document.visibilityState,
    online: navigator.onLine,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    userAgent: navigator.userAgent,
    recentEvents: getDebugBuffer().slice(-30),
    ...extra,
  };
}

export async function flushClientDebugEvents(force = false): Promise<void> {
  if ((!force && !betaDebugEnabled()) || flushing || buffer.length === 0) return;
  flushing = true;
  const events = buffer;
  try {
    const response = await fetch(`${API_BASE_URL}/debug/client-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
      keepalive: true,
    });
    if (response.ok) {
      buffer = buffer.slice(events.length);
    }
  } catch {
    // Keep the ringbuffer; the next anomaly or timed flush can retry.
  } finally {
    flushing = false;
  }
}

// Named describeAudioElement (not describeMediaElement) for historical
// reasons - accepts any HTMLMediaElement so LiveGameBoard.tsx's <video>
// (bloeki plays a video trailer, not audio like songster) can reuse it too.
export function describeAudioElement(audio: HTMLMediaElement): Record<string, unknown> {
  return {
    src: audio.currentSrc || audio.src || null,
    readyState: audio.readyState,
    networkState: audio.networkState,
    currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : null,
    duration: Number.isFinite(audio.duration) ? audio.duration : null,
    paused: audio.paused,
    muted: audio.muted,
    volume: audio.volume,
    error: audio.error
      ? {
          code: audio.error.code,
          message: audio.error.message,
        }
      : null,
  };
}

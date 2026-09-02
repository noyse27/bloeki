import { flushClientDebugEvents, logClientEvent } from './debugLogging';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`API request failed with status ${status}`);
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  const startedAt = performance.now();
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const requestId = response.headers.get('x-request-id');
  const elapsedMs = Math.round(performance.now() - startedAt);

  const data = response.status === 204 ? null : await response.json().catch(() => null);
  logClientEvent({
    eventType: response.ok ? 'api_request_success' : 'api_request_failed',
    payload: {
      method,
      path,
      status: response.status,
      requestId,
      elapsedMs,
      hasAuth: Boolean(options.token),
      errorBody: response.ok ? undefined : data,
    },
  });

  if (!response.ok) {
    // A 401 on a call that *presented* a token means that token is no
    // longer valid (expired, or the user behind it no longer exists/active
    // - e.g. after a dev DB reset). Only fires for authenticated calls, not
    // e.g. a failed /auth/login attempt (no token sent there). AuthProvider
    // listens for this to clear the stale session so every page's existing
    // "bitte anmelden" guard takes over, instead of the app looking dead.
    if (response.status === 401 && options.token) {
      window.dispatchEvent(new CustomEvent('bloeki:unauthorized'));
    }
    void flushClientDebugEvents(true);
    throw new ApiError(response.status, data);
  }

  return data as T;
}

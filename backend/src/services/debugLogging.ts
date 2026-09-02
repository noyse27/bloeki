import { pool } from '../db/pool';

export interface DebugEventInput {
  eventType: string;
  clientSessionId?: string | null;
  deviceId?: string | null;
  clientKind?: string | null;
  userId?: string | null;
  tableId?: string | null;
  gameId?: string | null;
  roundId?: string | null;
  roundIndex?: number | null;
  requestId?: string | null;
  payload?: Record<string, unknown>;
  createdAt?: string | null;
}

export interface GameEventInput {
  eventType: string;
  tableId?: string | null;
  gameId?: string | null;
  roundId?: string | null;
  roundIndex?: number | null;
  userId?: string | null;
  requestId?: string | null;
  payload?: Record<string, unknown>;
}

export function betaDebugLoggingEnabled(): boolean {
  return process.env.BETA_DEBUG_LOGGING === 'true' || process.env.NODE_ENV === 'test';
}

function asJsonObject(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  return payload;
}

function logStorageFailure(kind: string, err: unknown): void {
  if (process.env.NODE_ENV === 'test') return;
  console.warn(`failed to store ${kind}`, err);
}

export async function storeClientDebugEvent(input: DebugEventInput): Promise<void> {
  if (!betaDebugLoggingEnabled()) return;
  try {
    await pool.query(
      `INSERT INTO client_debug_event (
         created_at, event_type, client_session_id, device_id, client_kind,
         user_id, table_id, game_id, round_id, round_index, request_id, payload
       )
       VALUES (
         COALESCE($1::timestamptz, NOW()), $2, $3, $4, $5,
         $6, $7, $8, $9, $10, $11, $12::jsonb
       )`,
      [
        input.createdAt ?? null,
        input.eventType,
        input.clientSessionId ?? null,
        input.deviceId ?? null,
        input.clientKind ?? null,
        input.userId ?? null,
        input.tableId ?? null,
        input.gameId ?? null,
        input.roundId ?? null,
        input.roundIndex ?? null,
        input.requestId ?? null,
        JSON.stringify(asJsonObject(input.payload)),
      ],
    );
  } catch (err) {
    logStorageFailure('client debug event', err);
  }
}

export async function storeGameEvent(input: GameEventInput): Promise<void> {
  if (!betaDebugLoggingEnabled()) return;
  try {
    await pool.query(
      `INSERT INTO game_event_log (
         event_type, table_id, game_id, round_id, round_index, user_id, request_id, payload
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        input.eventType,
        input.tableId ?? null,
        input.gameId ?? null,
        input.roundId ?? null,
        input.roundIndex ?? null,
        input.userId ?? null,
        input.requestId ?? null,
        JSON.stringify(asJsonObject(input.payload)),
      ],
    );
  } catch (err) {
    logStorageFailure('game event', err);
  }
}

export function logBetaDebug(eventType: string, payload: Record<string, unknown> = {}): void {
  if (!betaDebugLoggingEnabled()) return;
  console.log(JSON.stringify({ level: 'info', scope: 'beta-debug', eventType, ...payload }));
}

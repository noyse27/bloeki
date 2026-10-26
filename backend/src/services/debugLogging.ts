import { pool } from '../db/pool';

const RETENTION_DAYS = 7;
let activeCaptureId: string | null = null;
let activeCaptureEnabledAt: string | null = null;

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
  return activeCaptureId !== null || process.env.BETA_DEBUG_LOGGING === 'true' || process.env.NODE_ENV === 'test';
}

export async function initializeDebugLogging(): Promise<void> {
  const result = await pool.query(
    `SELECT id, enabled_at FROM debug_capture WHERE disabled_at IS NULL ORDER BY enabled_at DESC LIMIT 1`,
  );
  activeCaptureId = result.rows[0]?.id ?? null;
  activeCaptureEnabledAt = result.rows[0]?.enabled_at ?? null;
}

export async function setDebugLoggingEnabled(enabled: boolean, userId: string): Promise<void> {
  if (enabled) {
    if (activeCaptureId) return;
    const result = await pool.query(
      `INSERT INTO debug_capture (enabled_by) VALUES ($1)
       ON CONFLICT ((disabled_at IS NULL)) WHERE disabled_at IS NULL
       DO UPDATE SET enabled_at = debug_capture.enabled_at
       RETURNING id, enabled_at`,
      [userId],
    );
    activeCaptureId = result.rows[0].id;
    activeCaptureEnabledAt = result.rows[0].enabled_at;
    return;
  }
  if (!activeCaptureId) return;
  await pool.query(
    `UPDATE debug_capture
     SET disabled_at = NOW(), expires_at = NOW() + ($2 || ' days')::interval
     WHERE id = $1 AND disabled_at IS NULL`,
    [activeCaptureId, RETENTION_DAYS],
  );
  activeCaptureId = null;
  activeCaptureEnabledAt = null;
}

export async function getDebugLoggingStatus(): Promise<{
  enabled: boolean;
  captureId: string | null;
  enabledAt: string | null;
  retentionDays: number;
}> {
  if (!activeCaptureId) return { enabled: false, captureId: null, enabledAt: null, retentionDays: RETENTION_DAYS };
  return {
    enabled: true,
    captureId: activeCaptureId,
    enabledAt: activeCaptureEnabledAt,
    retentionDays: RETENTION_DAYS,
  };
}

export async function deleteExpiredDebugCaptures(): Promise<number> {
  const result = await pool.query(`DELETE FROM debug_capture WHERE expires_at IS NOT NULL AND expires_at <= NOW()`);
  return result.rowCount ?? 0;
}

function asJsonObject(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  return payload;
}

function logStorageFailure(kind: string, err: unknown): void {
  if (process.env.NODE_ENV === 'test') return;
  console.warn(`failed to store ${kind}`, err);
}

async function archiveGame(captureId: string, gameId?: string | null): Promise<void> {
  if (!gameId) return;
  await pool.query(
    `INSERT INTO debug_game_archive
       (capture_id, game_id, table_id, table_name, is_solo, game_started_at)
     SELECT $1, g.id, t.id, t.name, t.is_solo, g.started_at
     FROM game g JOIN game_table t ON t.id = g.table_id
     WHERE g.id = $2
     ON CONFLICT (capture_id, game_id)
     DO UPDATE SET last_event_at = NOW()`,
    [captureId, gameId],
  );
}

export async function storeClientDebugEvent(input: DebugEventInput): Promise<void> {
  if (!betaDebugLoggingEnabled()) return;
  try {
    const captureId = activeCaptureId;
    if (captureId) await archiveGame(captureId, input.gameId);
    await pool.query(
      `INSERT INTO client_debug_event (
         created_at, event_type, client_session_id, device_id, client_kind,
         user_id, table_id, game_id, round_id, round_index, request_id, payload, capture_id
       )
       VALUES (
         COALESCE($1::timestamptz, NOW()), $2, $3, $4, $5,
         $6, $7, $8, $9, $10, $11, $12::jsonb, $13
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
        captureId,
      ],
    );
  } catch (err) {
    logStorageFailure('client debug event', err);
  }
}

export async function storeGameEvent(input: GameEventInput): Promise<void> {
  if (!betaDebugLoggingEnabled()) return;
  try {
    const captureId = activeCaptureId;
    if (captureId) await archiveGame(captureId, input.gameId);
    await pool.query(
      `INSERT INTO game_event_log (
         event_type, table_id, game_id, round_id, round_index, user_id, request_id, payload, capture_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
      [
        input.eventType,
        input.tableId ?? null,
        input.gameId ?? null,
        input.roundId ?? null,
        input.roundIndex ?? null,
        input.userId ?? null,
        input.requestId ?? null,
        JSON.stringify(asJsonObject(input.payload)),
        captureId,
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

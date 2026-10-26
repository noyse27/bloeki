import { Router } from 'express';
import { pool } from '../db/pool';
import { AuthenticatedRequest, requireAdmin, requireAuth } from '../middleware/auth';
import {
  getDebugLoggingStatus,
  setDebugLoggingEnabled,
  storeClientDebugEvent,
} from '../services/debugLogging';
import { BUILD_VERSION } from '../services/buildInfo';

export const debugRouter = Router();

const MAX_EVENTS = 50;
const MAX_PAYLOAD_BYTES = 24 * 1024;

function safeString(value: unknown, maxLength = 256): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, maxLength) : null;
}

function safeNumber(value: unknown): number | null {
  return Number.isInteger(value) ? value as number : null;
}

function safePayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const payload = value as Record<string, unknown>;
  const json = JSON.stringify(payload);
  if (json.length <= MAX_PAYLOAD_BYTES) return payload;
  return { truncated: true, originalBytes: json.length };
}

debugRouter.get('/debug/status', async (_req, res) => {
  const status = await getDebugLoggingStatus();
  res.status(200).json({ enabled: status.enabled });
});

debugRouter.post('/debug/client-events', async (req, res) => {
  const body = req.body ?? {};
  const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [body];

  await Promise.all(
    events.map((raw: unknown) => {
      const event = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      return storeClientDebugEvent({
        eventType: safeString(event.eventType, 128) ?? 'unknown',
        clientSessionId: safeString(event.clientSessionId),
        deviceId: safeString(event.deviceId),
        clientKind: safeString(event.clientKind, 32),
        userId: safeString(event.userId, 64),
        tableId: safeString(event.tableId, 64),
        gameId: safeString(event.gameId, 64),
        roundId: safeString(event.roundId, 64),
        roundIndex: safeNumber(event.roundIndex),
        requestId: safeString(req.headers['x-request-id']),
        createdAt: safeString(event.createdAt, 64),
        payload: safePayload(event.payload),
      });
    }),
  );

  res.status(202).json({ accepted: events.length });
});

debugRouter.get('/admin/debug/settings', requireAuth, requireAdmin, async (_req, res) => {
  res.status(200).json(await getDebugLoggingStatus());
});

debugRouter.put('/admin/debug/settings', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  if (typeof req.body?.enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled (boolean) is required' });
    return;
  }
  await setDebugLoggingEnabled(req.body.enabled, req.userId as string);
  res.status(200).json(await getDebugLoggingStatus());
});

debugRouter.get('/admin/debug/tables', requireAuth, requireAdmin, async (req, res) => {
  const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';
  if (query.length < 2) {
    res.status(200).json({ tables: [] });
    return;
  }
  const result = await pool.query(
    `SELECT table_id, table_name, is_solo, MAX(last_event_at) AS last_event_at,
            COUNT(DISTINCT game_id)::int AS game_count
     FROM debug_game_archive d
     JOIN debug_capture c ON c.id = d.capture_id
     WHERE (c.expires_at IS NULL OR c.expires_at > NOW())
       AND (d.table_name ILIKE $1 OR d.table_id::text ILIKE $1)
     GROUP BY table_id, table_name, is_solo
     ORDER BY last_event_at DESC LIMIT 25`,
    [`%${query}%`],
  );
  res.status(200).json({
    tables: result.rows.map((row) => ({
      tableId: row.table_id,
      tableName: row.table_name,
      isSolo: row.is_solo,
      gameCount: Number(row.game_count),
      lastEventAt: row.last_event_at,
    })),
  });
});

debugRouter.get('/admin/debug/tables/:tableId/games', requireAuth, requireAdmin, async (req, res) => {
  const result = await pool.query(
    `SELECT d.capture_id, d.game_id, d.table_id, d.table_name, d.is_solo,
            d.game_started_at, d.first_event_at, d.last_event_at,
            c.enabled_at, c.disabled_at, c.expires_at,
            (SELECT COUNT(*)::int FROM game_event_log e
             WHERE e.capture_id = d.capture_id AND e.game_id = d.game_id) AS server_event_count,
            (SELECT COUNT(*)::int FROM client_debug_event e
             WHERE e.capture_id = d.capture_id AND e.game_id = d.game_id) AS client_event_count
     FROM debug_game_archive d
     JOIN debug_capture c ON c.id = d.capture_id
     WHERE d.table_id = $1 AND (c.expires_at IS NULL OR c.expires_at > NOW())
     ORDER BY d.game_started_at DESC`,
    [req.params.tableId],
  );
  res.status(200).json({
    games: result.rows.map((row) => ({
      captureId: row.capture_id,
      gameId: row.game_id,
      tableId: row.table_id,
      tableName: row.table_name,
      isSolo: row.is_solo,
      gameStartedAt: row.game_started_at,
      firstEventAt: row.first_event_at,
      lastEventAt: row.last_event_at,
      captureEnabledAt: row.enabled_at,
      captureDisabledAt: row.disabled_at,
      expiresAt: row.expires_at,
      serverEventCount: Number(row.server_event_count),
      clientEventCount: Number(row.client_event_count),
    })),
  });
});

debugRouter.get('/admin/debug/captures/:captureId/games/:gameId', requireAuth, requireAdmin, async (req, res) => {
  const { captureId, gameId } = req.params;
  const metadata = await pool.query(
    `SELECT d.*, c.enabled_at, c.disabled_at, c.expires_at
     FROM debug_game_archive d JOIN debug_capture c ON c.id = d.capture_id
     WHERE d.capture_id = $1 AND d.game_id = $2
       AND (c.expires_at IS NULL OR c.expires_at > NOW())`,
    [captureId, gameId],
  );
  if (metadata.rowCount === 0) {
    res.status(404).json({ error: 'debug game not found or expired' });
    return;
  }
  const [serverEvents, clientEvents] = await Promise.all([
    pool.query(
      `SELECT created_at, event_type, table_id, game_id, round_id, round_index,
              user_id, request_id, payload
       FROM game_event_log WHERE capture_id = $1 AND game_id = $2 ORDER BY created_at ASC`,
      [captureId, gameId],
    ),
    pool.query(
      `SELECT created_at, received_at, event_type, client_session_id, device_id, client_kind,
              user_id, table_id, game_id, round_id, round_index, request_id, payload
       FROM client_debug_event WHERE capture_id = $1 AND game_id = $2 ORDER BY created_at ASC`,
      [captureId, gameId],
    ),
  ]);
  const row = metadata.rows[0];
  res.setHeader('Content-Disposition', `attachment; filename="bloeki-debug-${gameId}.json"`);
  res.status(200).json({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    serverBuildVersion: BUILD_VERSION,
    capture: {
      captureId: row.capture_id,
      enabledAt: row.enabled_at,
      disabledAt: row.disabled_at,
      expiresAt: row.expires_at,
    },
    game: {
      gameId: row.game_id,
      tableId: row.table_id,
      tableName: row.table_name,
      isSolo: row.is_solo,
      gameStartedAt: row.game_started_at,
      firstEventAt: row.first_event_at,
      lastEventAt: row.last_event_at,
    },
    serverEvents: serverEvents.rows,
    clientEvents: clientEvents.rows,
  });
});

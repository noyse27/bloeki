import { Router } from 'express';
import { storeClientDebugEvent } from '../services/debugLogging';

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

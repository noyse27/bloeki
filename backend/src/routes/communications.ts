import { Router } from 'express';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth';
import { emitChatMessage } from '../realtime/broadcast';
import {
  CHAT_MAX_LENGTH,
  createChatMessage,
  listChatMessages,
  normalizeChatBody,
  prepareChatBody,
} from '../services/communication';
import { loadActiveSeat } from '../services/tableAuthorization';

export const communicationsRouter = Router();

communicationsRouter.get('/communications/lobby/messages', requireAuth, async (_req, res) => {
  res.status(200).json({ messages: await listChatMessages('lobby', null) });
});

communicationsRouter.post('/communications/lobby/messages', requireAuth, async (req: AuthenticatedRequest, res) => {
  await createAndSend(req, res, 'lobby', null);
});

communicationsRouter.get('/tables/:tableId/messages', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.userId as string;
  const { tableId } = req.params;
  if (!(await loadActiveSeat(tableId, userId))) {
    res.status(404).json({ error: 'table not found' });
    return;
  }
  res.status(200).json({ messages: await listChatMessages('table', tableId) });
});

communicationsRouter.post('/tables/:tableId/messages', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.userId as string;
  const { tableId } = req.params;
  if (!(await loadActiveSeat(tableId, userId))) {
    res.status(404).json({ error: 'table not found' });
    return;
  }
  await createAndSend(req, res, 'table', tableId);
});

async function createAndSend(
  req: AuthenticatedRequest,
  res: Parameters<Parameters<Router['post']>[1]>[1],
  scope: 'lobby' | 'table',
  tableId: string | null,
): Promise<void> {
  const body = normalizeChatBody(req.body?.body);
  if (!body) {
    res.status(400).json({ error: `body must contain between 1 and ${CHAT_MAX_LENGTH} characters` });
    return;
  }

  const preparedBody = normalizeChatBody(await prepareChatBody(body));
  if (!preparedBody) {
    res.status(400).json({ error: `filtered body must contain between 1 and ${CHAT_MAX_LENGTH} characters` });
    return;
  }
  const result = await createChatMessage(scope, tableId, req.userId as string, preparedBody);
  if (!result.ok) {
    res.setHeader('Retry-After', result.retryAfterSeconds);
    res.status(429).json({ error: 'CHAT_RATE_LIMITED', retryAfterSeconds: result.retryAfterSeconds });
    return;
  }

  emitChatMessage(result.message);
  res.status(201).json({ message: result.message });
}

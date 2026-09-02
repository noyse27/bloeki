import { Router } from 'express';
import { checkDbConnection } from '../db/pool';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  const dbOk = await checkDbConnection();
  const status = dbOk ? 'ok' : 'degraded';
  res.status(dbOk ? 200 : 503).json({
    status,
    db: dbOk ? 'ok' : 'unreachable',
    timestamp: new Date().toISOString(),
  });
});

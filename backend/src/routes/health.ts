import { Router } from 'express';
import { checkDbConnection } from '../db/pool';
import { BUILD_VERSION } from '../services/buildInfo';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  const dbOk = await checkDbConnection();
  const status = dbOk ? 'ok' : 'degraded';
  res.status(dbOk ? 200 : 503).json({
    status,
    db: dbOk ? 'ok' : 'unreachable',
    buildVersion: BUILD_VERSION,
    timestamp: new Date().toISOString(),
  });
});

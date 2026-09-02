import 'express-async-errors';
import express, { Express, NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { setupRouter } from './routes/setup';
import { invitesRouter } from './routes/invites';
import { adminRouter } from './routes/admin';
import { tablesRouter } from './routes/tables';
import { roundsRouter } from './routes/rounds';
import { leaderboardRouter } from './routes/leaderboard';
import { usersRouter } from './routes/users';
import { trailersRouter } from './routes/trailers';
import { communicationsRouter } from './routes/communications';
import { hostDevicesRouter } from './routes/hostDevices';
import { debugRouter } from './routes/debug';
import { apiLimiter, authLimiter } from './middleware/rateLimit';
import { requestIdMiddleware } from './middleware/requestId';

export function createApp(): Express {
  const app = express();

  // The Docker Compose topology always puts exactly one reverse proxy
  // (frontend/nginx.conf) in front of this process - trust its
  // X-Forwarded-For so req.ip (and therefore every rate limiter below,
  // which keys on it) resolves to the real client, not nginx's own
  // container IP. Without this, every request from every player behind
  // that one proxy shares a single IP bucket - trivial to exceed apiLimiter
  // (120 req/min total, not per player) with completely normal multi-
  // player traffic, which the frontend was then misreporting as "backend
  // unreachable" instead of "rate limited".
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(requestIdMiddleware);

  app.use('/api/v1', healthRouter);
  app.use('/api/v1', apiLimiter);
  app.use('/api/v1/auth', authLimiter);
  app.use('/api/v1/setup', authLimiter);

  app.use('/api/v1', authRouter);
  app.use('/api/v1', setupRouter);
  app.use('/api/v1', invitesRouter);
  app.use('/api/v1/admin', adminRouter);
  app.use('/api/v1', tablesRouter);
  app.use('/api/v1', roundsRouter);
  app.use('/api/v1', leaderboardRouter);
  app.use('/api/v1', usersRouter);
  app.use('/api/v1', trailersRouter);
  app.use('/api/v1', communicationsRouter);
  app.use('/api/v1', hostDevicesRouter);
  app.use('/api/v1', debugRouter);

  // Last-resort net: without this, an error thrown/rejected anywhere in a
  // route handler (now forwarded here automatically by express-async-errors)
  // would otherwise crash the whole Node process for every connected user -
  // as happened with a stale JWT referencing a user deleted by a DB reset,
  // which turned a routine 401 into a Postgres FK-violation crash. Answering
  // with a generic 500 here is a safety net, not a substitute for handling
  // specific, expected error cases in the route itself.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('unhandled request error', err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}

import { NextFunction, Request, Response } from 'express';
import { DEMO_MODE } from '../config/demoMode';

// Applied to individual destructive admin routes (see routes/admin.ts) -
// blocks the actions that would let one demo visitor lock other visitors
// out of the shared instance (revoking someone's invite rights, blocking
// their registered account) or otherwise fight the periodic reset. Read-only
// admin endpoints (GET /admin/users, /admin/tables, /admin/invites/log) and
// low-risk ones (the trailer library scan, which only rescans the bundled
// demo clip directory) stay available so the demo still shows a working
// admin screen.
export function blockInDemoMode(action: string) {
  return function demoBlockMiddleware(_req: Request, res: Response, next: NextFunction): void {
    if (DEMO_MODE) {
      res.status(403).json({ error: `${action} is disabled in demo mode` });
      return;
    }
    next();
  };
}

import { Router } from 'express';
import { DEMO_MODE } from '../config/demoMode';
import { getDemoStatus } from '../services/demoReset';

export const demoRouter = Router();

// Public (no auth) and safe to expose: everything returned here is either
// already public knowledge for a demo instance (see docs/demo.md, which
// documents the fixed admin login and standing invite code) or timing
// information. Frontend's DemoBanner.tsx polls this to know whether to show
// itself at all - the same instance's code can run as a normal deployment
// with DEMO_MODE unset, in which case `active` is false and the banner
// renders nothing.
demoRouter.get('/demo/status', (_req, res) => {
  if (!DEMO_MODE) {
    res.status(200).json({ active: false });
    return;
  }
  res.status(200).json(getDemoStatus());
});

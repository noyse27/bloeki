import rateLimit from 'express-rate-limit';

// Integration tests exercise many endpoints in quick succession within a
// single Jest run; rate limiting them would test the limiter, not the
// feature under test. Jest sets NODE_ENV=test automatically.
const skipInTests = () => process.env.NODE_ENV === 'test';

// Baseline limiter for every API route (NFR from the Feinkonzept: rate
// limits on auth and game actions).
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests,
});

// Tighter limiter for credential- and invite-guessing surfaces.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests,
});

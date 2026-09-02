import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool';

const MIN_SECRET_LENGTH = 32;

// Historical defaults that shipped in .env.example / docker-compose.yml -
// anyone who never overrode them is running with a secret an attacker can
// find by reading this repository, so they're rejected outright rather
// than merely "not recommended".
const KNOWN_INSECURE_SECRETS = new Set(['dev-secret-change-me', 'change-me-in-production']);

function resolveJwtSecret(): string {
  const configured = process.env.JWT_SECRET;

  // Jest sets NODE_ENV=test itself (see jest.config.js / CI), so this
  // never fires for `npm test`; it only relaxes the check for the test
  // suite, never for `npm run dev`, `npm start`, or the Docker image.
  if (process.env.NODE_ENV === 'test') {
    return configured ?? 'test-only-secret-not-used-outside-jest';
  }

  if (!configured || configured.length < MIN_SECRET_LENGTH || KNOWN_INSECURE_SECRETS.has(configured)) {
    throw new Error(
      'JWT_SECRET is missing, shorter than 32 characters, or a known example value from .env.example. ' +
        "Set a random secret, e.g. `openssl rand -hex 32`, before starting the backend.",
    );
  }

  return configured;
}

export const JWT_SECRET = resolveJwtSecret();

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userRole?: string;
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'missing bearer token' });
    return;
  }

  let payload: { sub: string; sessionVersion: number };
  try {
    payload = jwt.verify(header.slice('Bearer '.length), JWT_SECRET, { algorithms: ['HS256'] }) as {
      sub: string;
      sessionVersion: number;
    };
  } catch {
    res.status(401).json({ error: 'invalid or expired token' });
    return;
  }

  // The JWT signature/expiry alone doesn't prove the user still exists -
  // e.g. a dev DB reset, or the account being deleted/blocked after the
  // token was issued. Without this check, a stale-but-unexpired token sails
  // through here and then blows up downstream as a raw FK-violation on
  // whichever table references the user (see game_table.owner_user_id).
  //
  // session_version also enforces single-active-session: every login bumps
  // it (see routes/auth.ts), so a token from an earlier login on another
  // device stops matching here on its very next request.
  //
  // The role is loaded from the DB, not trusted from the token payload:
  // a token only proves who signed in, never what role that account has
  // right now, otherwise anyone who can forge/replay a token (e.g. a
  // leaked or default JWT_SECRET) could simply claim role "admin".
  const result = await pool.query(
    `SELECT status, session_version, role FROM app_user WHERE id = $1`,
    [payload.sub],
  );
  if (
    result.rowCount === 0 ||
    result.rows[0].status !== 'active' ||
    result.rows[0].session_version !== payload.sessionVersion
  ) {
    res.status(401).json({ error: 'invalid or expired token' });
    return;
  }

  req.userId = payload.sub;
  req.userRole = result.rows[0].role;
  next();
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (req.userRole !== 'admin') {
    res.status(403).json({ error: 'admin role required' });
    return;
  }
  next();
}

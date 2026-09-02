import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../middleware/auth';

// Hostmodus (gemeinsames Anzeigegerät): a display token authenticates a
// shared screen (TV/tablet) for one table without it ever being an
// app_user login - deliberately no `sub` claim, so it can never collide
// with the single-active-session check in middleware/auth.ts/socketServer.ts
// (a normal login there would kick a real player off their own phone).
// 12h covers a full game night; the table itself also expires long before
// that via the inactivity auto-close (see tableActivity.ts).
const DISPLAY_TOKEN_TTL_SECONDS = 12 * 60 * 60;

interface DisplayTokenPayload {
  kind: 'display';
  tableId: string;
  hostDeviceId?: string;
}

export function issueDisplayToken(tableId: string, hostDeviceId?: string): string {
  const payload: DisplayTokenPayload = { kind: 'display', tableId, hostDeviceId };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: DISPLAY_TOKEN_TTL_SECONDS });
}

export function verifyDisplayToken(token: string): { tableId: string; hostDeviceId: string | null } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as Partial<DisplayTokenPayload> & Record<string, unknown>;
    if (payload.kind !== 'display' || typeof payload.tableId !== 'string') return null;
    return { tableId: payload.tableId, hostDeviceId: typeof payload.hostDeviceId === 'string' ? payload.hostDeviceId : null };
  } catch {
    return null;
  }
}

import jwt from 'jsonwebtoken';
import { pool } from '../../src/db/pool';
import { JWT_SECRET } from '../../src/middleware/auth';

export function uniqueSuffix(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// sessionVersion: 1 matches app_user.session_version's DEFAULT (see the
// session-version migration) - fine as long as tests mint tokens directly
// rather than going through the real /auth/login flow (which bumps it) for
// the same user, which is true of every current test using this helper.
export function signToken(userId: string, role: string): string {
  return jwt.sign({ sub: userId, role, sessionVersion: 1 }, JWT_SECRET, { expiresIn: 3600 });
}

export function authHeader(userId: string, role: string): { Authorization: string } {
  return { Authorization: `Bearer ${signToken(userId, role)}` };
}

export async function createUserDirect(opts: {
  role?: 'user' | 'admin';
  canCreateInvites?: boolean;
  status?: 'active' | 'blocked';
}): Promise<{ id: string; username: string }> {
  const suffix = uniqueSuffix();
  const result = await pool.query(
    `INSERT INTO app_user (username, email, password_hash, role, can_create_invites, status)
     VALUES ($1, $2, 'x', $3, $4, $5)
     RETURNING id, username`,
    [
      `user_${suffix}`,
      `user_${suffix}@example.test`,
      opts.role ?? 'user',
      opts.canCreateInvites ?? false,
      opts.status ?? 'active',
    ],
  );
  return result.rows[0];
}

/** Marks a seated player ready directly via SQL - used by tests that need
 * a table to actually start (see tables.ts's /ready gate) but aren't
 * themselves testing the readiness mechanic. */
export async function markSeatReadyDirect(tableId: string, userId: string): Promise<void> {
  await pool.query(
    `UPDATE table_seat SET ready = TRUE WHERE table_id = $1 AND user_id = $2 AND left_at IS NULL`,
    [tableId, userId],
  );
}

export async function createInviteDirect(createdBy: string, overrides: Partial<{
  maxUses: number;
  expiresAt: Date | null;
  disabledAt: Date | null;
}> = {}): Promise<{ id: string; code: string }> {
  const code = `invite_${uniqueSuffix()}`;
  const result = await pool.query(
    `INSERT INTO invite_token (code, created_by, max_uses, expires_at, disabled_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, code`,
    [
      code,
      createdBy,
      overrides.maxUses ?? 1,
      overrides.expiresAt ?? null,
      overrides.disabledAt ?? null,
    ],
  );
  return result.rows[0];
}

import { Router } from 'express';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool';
import { JWT_SECRET } from '../middleware/auth';

export const authRouter = Router();

const JWT_EXPIRES_IN_SECONDS = 3600;

authRouter.post('/auth/register', async (req, res) => {
  const { username, email, password, inviteCode } = req.body ?? {};

  if (!username || !email || !password || !inviteCode) {
    res.status(400).json({ error: 'username, email, password and inviteCode are required' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const inviteResult = await client.query(
      `SELECT id, max_uses, used_count, expires_at, disabled_at
       FROM invite_token
       WHERE code = $1
       FOR UPDATE`,
      [inviteCode],
    );

    if (inviteResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'invalid invite code' });
      return;
    }

    const invite = inviteResult.rows[0];
    const isExpired = invite.expires_at && new Date(invite.expires_at) < new Date();
    const isDisabled = Boolean(invite.disabled_at);
    const isExhausted = invite.used_count >= invite.max_uses;

    if (isExpired || isDisabled || isExhausted) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'invite code is not usable' });
      return;
    }

    const passwordHash = await argon2.hash(password);

    const userResult = await client.query(
      `INSERT INTO app_user (username, email, password_hash, registered_via_invite_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username`,
      [username, email, passwordHash, invite.id],
    );

    await client.query(
      `UPDATE invite_token SET used_count = used_count + 1 WHERE id = $1`,
      [invite.id],
    );

    await client.query('COMMIT');

    res.status(201).json({
      userId: userResult.rows[0].id,
      username: userResult.rows[0].username,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: 'username or email already in use' });
      return;
    }
    throw err;
  } finally {
    client.release();
  }
});

authRouter.post('/auth/login', async (req, res) => {
  const { usernameOrEmail, password } = req.body ?? {};

  if (!usernameOrEmail || !password) {
    res.status(400).json({ error: 'usernameOrEmail and password are required' });
    return;
  }

  const result = await pool.query(
    `SELECT id, username, password_hash, role, status, can_create_invites
     FROM app_user
     WHERE username = $1 OR email = $1`,
    [usernameOrEmail],
  );

  if (result.rowCount === 0) {
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }

  const user = result.rows[0];

  if (user.status !== 'active') {
    res.status(403).json({ error: 'account is not active' });
    return;
  }

  const passwordValid = await argon2.verify(user.password_hash, password);
  if (!passwordValid) {
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }

  // Single-active-session: bump the version now so any token from a prior
  // login (a different device/browser) stops matching on its next request
  // - see requireAuth/the socket handshake check, both of which compare
  // against this column. A fresh login always succeeds regardless of what
  // else is logged in, so a dead/unreachable old device never locks the
  // account out - it just gets superseded.
  const sessionResult = await pool.query(
    `UPDATE app_user SET session_version = session_version + 1 WHERE id = $1 RETURNING session_version`,
    [user.id],
  );
  const sessionVersion = sessionResult.rows[0].session_version as number;

  const accessToken = jwt.sign(
    { sub: user.id, role: user.role, sessionVersion },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN_SECONDS },
  );

  res.status(200).json({
    accessToken,
    expiresIn: JWT_EXPIRES_IN_SECONDS,
    user: { id: user.id, username: user.username, role: user.role, canCreateInvites: user.can_create_invites },
  });
});

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

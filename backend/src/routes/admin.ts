import { Router } from 'express';
import crypto from 'crypto';
import argon2 from 'argon2';
import { pool } from '../db/pool';
import { AuthenticatedRequest, requireAdmin, requireAuth, requireSuperAdmin } from '../middleware/auth';
import {
  loadCommunicationSettings,
  normalizeBlockedWords,
  saveCommunicationSettings,
  validateReactionConfig,
} from '../services/communication';
import { broadcastLobby, broadcastReactionConfig } from '../realtime/broadcast';
import { ADMIN_INACTIVE_MS } from '../services/tableActivity';
import { blockInDemoMode } from '../middleware/demoBlock';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

adminRouter.get('/trailer-playlists/search', async (req, res) => {
  const prefix = typeof req.query.prefix === 'string' ? req.query.prefix.trim().toLowerCase() : '';
  if (prefix.length < 3) {
    res.status(200).json({ playlists: [] });
    return;
  }
  const result = await pool.query(
    `SELECT id, table_name, created_at, expires_at FROM game_trailer_playlist
     WHERE LOWER(id::text) LIKE $1 ORDER BY created_at DESC LIMIT 20`,
    [`${prefix}%`],
  );
  res.status(200).json({
    playlists: result.rows.map((row) => ({
      playlistId: row.id,
      tableName: row.table_name,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    })),
  });
});

adminRouter.get('/trailer-playlists/:playlistId', async (req, res) => {
  const playlistResult = await pool.query(
    `SELECT id, table_id, table_name, game_id, created_at, expires_at
     FROM game_trailer_playlist WHERE id = $1`,
    [req.params.playlistId],
  );
  if (playlistResult.rowCount === 0) {
    res.status(404).json({ error: 'trailer playlist not found' });
    return;
  }
  const p = playlistResult.rows[0];
  const items = await pool.query(
    `SELECT id, position, trailer_ref_id, imdb_id, title, year_value
     FROM game_trailer_playlist_item WHERE playlist_id = $1 ORDER BY position`,
    [p.id],
  );
  res.status(200).json({
    playlistId: p.id,
    tableId: p.table_id,
    tableName: p.table_name,
    gameId: p.game_id,
    createdAt: p.created_at,
    expiresAt: p.expires_at,
    trailers: items.rows.map((row) => ({
      itemId: row.id,
      position: row.position,
      trailerId: row.trailer_ref_id,
      imdbId: row.imdb_id,
      title: row.title,
      year: row.year_value,
    })),
  });
});

// Trailer-Bibliotheks-Verwaltung (Scan-Trigger, Bestandsliste) lebt in
// routes/trailers.ts (POST /admin/trailers/scan, GET /admin/trailers) - kein
// Adolar-Aequivalent hier, bloeki hat keinen externen Musik-/Video-Lieferant.

adminRouter.get('/communication-settings', async (_req, res) => {
  res.status(200).json(await loadCommunicationSettings());
});

adminRouter.put('/communication-settings', blockInDemoMode('changing communication settings'), async (req, res) => {
  const textChat = req.body?.textChat;
  const blockedWords = normalizeBlockedWords(textChat?.blockedWords);
  const reactions = validateReactionConfig(req.body?.reactions);
  if (typeof textChat?.autoConvertEmoticons !== 'boolean' || !blockedWords || !reactions) {
    res.status(400).json({ error: 'invalid communication settings' });
    return;
  }

  await saveCommunicationSettings({
    textChat: { autoConvertEmoticons: textChat.autoConvertEmoticons, blockedWords },
    reactions,
  });
  broadcastReactionConfig(reactions);
  res.status(200).json({ textChat: { autoConvertEmoticons: textChat.autoConvertEmoticons, blockedWords }, reactions });
});

// Backs the admin user-management screen: the mutation endpoints below
// (invite-permission, revoke-invites, reset-invite-quota) all need a
// userId, and this is the only way to discover one.
adminRouter.get('/users', async (_req, res) => {
  const result = await pool.query(
    `SELECT id, username, email, role, status, can_create_invites, karma_points, score_points, created_at,
            must_change_password, password_reset_requested_at, is_super_admin
     FROM app_user ORDER BY created_at DESC`,
  );

  res.status(200).json({
    users: result.rows.map((row) => ({
      userId: row.id,
      username: row.username,
      email: row.email,
      role: row.role,
      status: row.status,
      canCreateInvites: row.can_create_invites,
      karmaPoints: row.karma_points,
      scorePoints: row.score_points,
      createdAt: row.created_at,
      mustChangePassword: row.must_change_password,
      passwordResetRequestedAt: row.password_reset_requested_at,
      isSuperAdmin: row.is_super_admin,
    })),
  });
});

// Promotes a user to admin, or demotes an admin back to a regular user.
// Restricted to the super-admin (see requireSuperAdmin) so a promoted admin
// can't appoint an accomplice or demote whoever appointed them.
//
// Two safety nets beyond that: demoting the last remaining admin is refused
// (409), and the super-admin's own row is refused entirely (409) - they are
// always admin by definition (is_super_admin never moves, see the
// add-super-admin migration), and demoting themselves would otherwise leave
// the system with zero accounts able to pass requireSuperAdmin, forever.
adminRouter.post(
  '/users/:userId/role',
  requireSuperAdmin,
  blockInDemoMode('changing a user role'),
  async (req: AuthenticatedRequest, res) => {
    const { userId } = req.params;
    const { role } = req.body ?? {};

    if (role !== 'user' && role !== 'admin') {
      res.status(400).json({ error: "role must be 'user' or 'admin'" });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const current = await client.query(
        `SELECT role, is_super_admin FROM app_user WHERE id = $1 FOR UPDATE`,
        [userId],
      );
      if (current.rowCount === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'user not found' });
        return;
      }

      if (current.rows[0].is_super_admin) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: "the super-admin's role cannot be changed" });
        return;
      }

      if (current.rows[0].role === 'admin' && role === 'user') {
        const adminCount = await client.query(`SELECT COUNT(*) FROM app_user WHERE role = 'admin'`);
        if (Number(adminCount.rows[0].count) <= 1) {
          await client.query('ROLLBACK');
          res.status(409).json({ error: 'cannot demote the last remaining admin' });
          return;
        }
      }

      const result = await client.query(
        `UPDATE app_user SET role = $1 WHERE id = $2 RETURNING id, username, role`,
        [role, userId],
      );
      await client.query('COMMIT');

      res.status(200).json({
        userId: result.rows[0].id,
        username: result.rows[0].username,
        role: result.rows[0].role,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
);

// Deletes the current password and issues a random temporary one, which is
// returned once in the response for the admin to relay to the user (e.g.
// because they requested a reset via POST /auth/request-password-reset,
// visible here as passwordResetRequestedAt) - it is never stored or logged
// in plaintext anywhere. must_change_password forces the user through
// POST /users/me/change-password on their next login before they can do
// anything else with the account. Bumping session_version also logs out
// any session still open under the old password.
adminRouter.post('/users/:userId/reset-password', blockInDemoMode('resetting a password'), async (req, res) => {
  const { userId } = req.params;
  const temporaryPassword = crypto.randomBytes(9).toString('base64url');
  const passwordHash = await argon2.hash(temporaryPassword);

  const result = await pool.query(
    `UPDATE app_user
     SET password_hash = $1, must_change_password = TRUE, password_reset_requested_at = NULL,
         session_version = session_version + 1
     WHERE id = $2
     RETURNING id, username`,
    [passwordHash, userId],
  );

  if (result.rowCount === 0) {
    res.status(404).json({ error: 'user not found' });
    return;
  }

  res.status(200).json({
    userId: result.rows[0].id,
    username: result.rows[0].username,
    temporaryPassword,
  });
});

// Grant or revoke a user's right to create invites.
adminRouter.post('/users/:userId/invite-permission', blockInDemoMode('changing invite permissions'), async (req, res) => {
  const { userId } = req.params;
  const { canCreateInvites } = req.body ?? {};

  if (typeof canCreateInvites !== 'boolean') {
    res.status(400).json({ error: 'canCreateInvites (boolean) is required' });
    return;
  }

  const result = await pool.query(
    `UPDATE app_user SET can_create_invites = $1 WHERE id = $2 RETURNING id, username, can_create_invites`,
    [canCreateInvites, userId],
  );

  if (result.rowCount === 0) {
    res.status(404).json({ error: 'user not found' });
    return;
  }

  res.status(200).json({
    userId: result.rows[0].id,
    username: result.rows[0].username,
    canCreateInvites: result.rows[0].can_create_invites,
  });
});

// Revoke a user's invite right, with optional cascading cleanup:
// - invalidateCreatedInvites: disable every invite the user created
// - deactivateRegisteredUsers: block every account that registered via one
//   of that user's invites
adminRouter.post('/users/:userId/revoke-invites', blockInDemoMode('revoking invites'), async (req, res) => {
  const { userId } = req.params;
  const { invalidateCreatedInvites, deactivateRegisteredUsers } = req.body ?? {};

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      `UPDATE app_user SET can_create_invites = FALSE WHERE id = $1 RETURNING id, username`,
      [userId],
    );

    if (userResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'user not found' });
      return;
    }

    let invalidatedInviteCount = 0;
    let deactivatedUserCount = 0;

    if (invalidateCreatedInvites) {
      const invalidated = await client.query(
        `UPDATE invite_token
         SET disabled_at = NOW()
         WHERE created_by = $1 AND disabled_at IS NULL
         RETURNING id`,
        [userId],
      );
      invalidatedInviteCount = invalidated.rowCount ?? 0;
    }

    if (deactivateRegisteredUsers) {
      const deactivated = await client.query(
        `UPDATE app_user
         SET status = 'blocked'
         WHERE registered_via_invite_id IN (SELECT id FROM invite_token WHERE created_by = $1)
           AND status = 'active'
         RETURNING id`,
        [userId],
      );
      deactivatedUserCount = deactivated.rowCount ?? 0;
    }

    await client.query('COMMIT');

    res.status(200).json({
      userId: userResult.rows[0].id,
      username: userResult.rows[0].username,
      canCreateInvites: false,
      invalidatedInviteCount,
      deactivatedUserCount,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Resets a delegated user's monthly invite quota so they can create up to
// the full monthly allowance again, even mid-month.
adminRouter.post('/users/:userId/reset-invite-quota', blockInDemoMode('resetting invite quota'), async (req, res) => {
  const { userId } = req.params;

  const result = await pool.query(
    `UPDATE app_user SET invite_quota_reset_at = NOW() WHERE id = $1 RETURNING id, username, invite_quota_reset_at`,
    [userId],
  );

  if (result.rowCount === 0) {
    res.status(404).json({ error: 'user not found' });
    return;
  }

  res.status(200).json({
    userId: result.rows[0].id,
    username: result.rows[0].username,
    inviteQuotaResetAt: result.rows[0].invite_quota_reset_at,
  });
});

// Admin log view: every invite with its creator and everyone who registered
// through it.
adminRouter.get('/invites/log', async (_req, res) => {
  const result = await pool.query(
    `SELECT
        it.id AS invite_id,
        it.code,
        creator.username AS creator_username,
        it.disabled_at,
        it.expires_at,
        it.max_uses,
        it.used_count,
        COALESCE(
          json_agg(registered.username) FILTER (WHERE registered.username IS NOT NULL),
          '[]'
        ) AS registered_usernames
     FROM invite_token it
     JOIN app_user creator ON creator.id = it.created_by
     LEFT JOIN app_user registered ON registered.registered_via_invite_id = it.id
     GROUP BY it.id, creator.username
     ORDER BY it.created_at DESC`,
  );

  res.status(200).json({
    entries: result.rows.map((row) => ({
      inviteId: row.invite_id,
      code: row.code,
      creatorUsername: row.creator_username,
      disabledAt: row.disabled_at,
      expiresAt: row.expires_at,
      maxUses: row.max_uses,
      usedCount: row.used_count,
      registeredUsernames: row.registered_usernames,
    })),
  });
});

// Every table, admin-visible regardless of visibility/state - flags
// anything untouched for ADMIN_INACTIVE_MS as "inactive" well before the
// much longer INACTIVITY_DELETE_MS auto-delete threshold actually kicks in
// (see tableCleanup.ts), purely so an admin can see what's about to be
// swept without waiting for it to actually happen.
adminRouter.get('/tables', async (_req, res) => {
  const result = await pool.query(
    `SELECT
        t.id, t.name, t.visibility, t.state, t.created_at, t.last_activity_at,
        u.username AS owner_username,
        COUNT(*) FILTER (WHERE s.seat_type = 'player' AND s.left_at IS NULL) AS active_players,
        COUNT(*) FILTER (WHERE s.seat_type = 'spectator' AND s.left_at IS NULL) AS active_spectators,
        (t.last_activity_at <= NOW() - ($1 || ' milliseconds')::interval) AS inactive
     FROM game_table t
     JOIN app_user u ON u.id = t.owner_user_id
     LEFT JOIN table_seat s ON s.table_id = t.id
     GROUP BY t.id, u.username
     ORDER BY t.created_at DESC`,
    [ADMIN_INACTIVE_MS],
  );

  res.status(200).json({
    tables: result.rows.map((row) => ({
      tableId: row.id,
      name: row.name,
      visibility: row.visibility,
      state: row.state,
      ownerUsername: row.owner_username,
      activePlayers: Number(row.active_players),
      activeSpectators: Number(row.active_spectators),
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
      inactive: row.inactive,
    })),
  });
});

adminRouter.delete('/tables/:tableId', blockInDemoMode('deleting a table'), async (req, res) => {
  const result = await pool.query(`DELETE FROM game_table WHERE id = $1 RETURNING id`, [req.params.tableId]);
  if (result.rowCount === 0) {
    res.status(404).json({ error: 'table not found' });
    return;
  }

  await broadcastLobby();
  res.status(204).send();
});

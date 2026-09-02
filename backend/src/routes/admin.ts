import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAdmin, requireAuth } from '../middleware/auth';
import {
  loadCommunicationSettings,
  normalizeBlockedWords,
  saveCommunicationSettings,
  validateReactionConfig,
} from '../services/communication';
import { broadcastLobby, broadcastReactionConfig } from '../realtime/broadcast';
import { ADMIN_INACTIVE_MS } from '../services/tableActivity';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

// Trailer-Bibliotheks-Verwaltung (Scan-Trigger, Bestandsliste) lebt in
// routes/trailers.ts (POST /admin/trailers/scan, GET /admin/trailers) - kein
// Adolar-Aequivalent hier, bloeki hat keinen externen Musik-/Video-Lieferant.

adminRouter.get('/communication-settings', async (_req, res) => {
  res.status(200).json(await loadCommunicationSettings());
});

adminRouter.put('/communication-settings', async (req, res) => {
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
    `SELECT id, username, email, role, status, can_create_invites, karma_points, score_points, created_at
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
    })),
  });
});

// Grant or revoke a user's right to create invites.
adminRouter.post('/users/:userId/invite-permission', async (req, res) => {
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
adminRouter.post('/users/:userId/revoke-invites', async (req, res) => {
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
adminRouter.post('/users/:userId/reset-invite-quota', async (req, res) => {
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

adminRouter.delete('/tables/:tableId', async (req, res) => {
  const result = await pool.query(`DELETE FROM game_table WHERE id = $1 RETURNING id`, [req.params.tableId]);
  if (result.rowCount === 0) {
    res.status(404).json({ error: 'table not found' });
    return;
  }

  await broadcastLobby();
  res.status(204).send();
});

import { Router } from 'express';
import argon2 from 'argon2';
import { checkDbConnection, pool } from '../db/pool';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { isPlacementCorrect } from '../services/timeline';
import { verifySetupToken, consumeSetupToken } from '../services/setupToken';

// Arbitrary fixed key for the bootstrap advisory lock (any int8 works - it
// just needs to be the same constant every time). Held for the duration of
// the transaction, so two concurrent bootstrap requests are serialized even
// while no admin row exists yet to `SELECT ... FOR UPDATE` on.
const BOOTSTRAP_LOCK_KEY = 72700100;

export const setupRouter = Router();

// Lets the browser wizard decide, without side effects, whether to show
// the "create admin" step or skip straight past it. Anders als songster
// gibt es keinen "Musikdaten"-Schritt - bloeki hat keinen externen
// Musik-/Video-Lieferant zu konfigurieren, die Trailer-Bibliothek wird vom
// zyklischen Scan (services/trailerScan.ts) automatisch befuellt, sobald
// tools/snippet-cutter Trailer in den gemounteten Ordner geschnitten hat.
setupRouter.get('/setup/status', async (_req, res) => {
  const result = await pool.query(`SELECT id FROM app_user WHERE role = 'admin' LIMIT 1`);
  res.status(200).json({
    adminExists: (result.rowCount ?? 0) > 0,
  });
});

// One-time bootstrap: creates the first admin account. Only usable while
// no admin exists yet, so it cannot be used to escalate privileges later.
setupRouter.post('/setup/bootstrap', async (req, res) => {
  const { username, email, password, setupToken } = req.body ?? {};

  if (!username || !email || !password) {
    res.status(400).json({ error: 'username, email and password are required' });
    return;
  }

  if (!verifySetupToken(setupToken)) {
    res.status(403).json({ error: 'setup token missing or invalid' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Serializes concurrent bootstrap attempts even in the empty-table
    // case, where `SELECT ... FOR UPDATE` below has no row to lock yet.
    await client.query(`SELECT pg_advisory_xact_lock($1)`, [BOOTSTRAP_LOCK_KEY]);

    const existingAdmin = await client.query(
      `SELECT id FROM app_user WHERE role = 'admin' LIMIT 1 FOR UPDATE`,
    );

    if ((existingAdmin.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'an admin account already exists' });
      return;
    }

    const passwordHash = await argon2.hash(password);
    const result = await client.query(
      `INSERT INTO app_user (username, email, password_hash, role, can_create_invites)
       VALUES ($1, $2, $3, 'admin', TRUE)
       RETURNING id, username`,
      [username, email, passwordHash],
    );

    await client.query('COMMIT');
    consumeSetupToken();
    res.status(201).json({ userId: result.rows[0].id, username: result.rows[0].username });
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

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

// FR-063: integrated function test run at the end of the setup wizard.
// A full realtime round needs a live table/game, which is more than a
// health check should spin up; instead it exercises the same
// placement-correctness logic a real round relies on, against synthetic
// data, so a broken deploy is caught without side effects.
setupRouter.post('/setup/self-test', requireAuth, requireAdmin, async (_req, res) => {
  const databaseOk = await checkDbConnection();

  const trailerPoolResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM trailer_ref WHERE is_valid = TRUE AND clip_status = 'ready'`,
  );
  const trailerPoolOk = trailerPoolResult.rows[0].count > 0;

  const roundLogicOk =
    isPlacementCorrect([{ yearValue: 1980 }, { yearValue: 2000 }], 1, 1990) &&
    !isPlacementCorrect([{ yearValue: 1980 }, { yearValue: 2000 }], 0, 1990);

  const healthy = databaseOk && trailerPoolOk && roundLogicOk;

  res.status(healthy ? 200 : 503).json({
    healthy,
    checks: {
      database: databaseOk,
      trailerPool: trailerPoolOk,
      roundLogic: roundLogicOk,
    },
  });
});

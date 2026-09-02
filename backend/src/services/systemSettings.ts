import { pool } from '../db/pool';

/** Returns null (not a throw) on any DB error, including "no DB configured
 * at all" - callers with a sensible default should keep working even if the
 * DB is unreachable. */
export async function getSetting(key: string): Promise<string | null> {
  try {
    const result = await pool.query(`SELECT value FROM system_setting WHERE key = $1`, [key]);
    return result.rowCount ? (result.rows[0].value as string) : null;
  } catch {
    return null;
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO system_setting (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value],
  );
}

import crypto from 'crypto';
import { pool } from '../db/pool';
import { issueDisplayToken } from './displayToken';
import { getIO } from '../realtime/io';

const PAIRING_TTL_MS = 10 * 60 * 1000;
const ONLINE_WINDOW_MS = 45 * 1000;

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function randomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i += 1) out += alphabet[crypto.randomInt(alphabet.length)];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export async function createHostDevicePairing(label: string, installId: string) {
  const deviceSecret = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  let pairingCode = randomCode();

  for (let tries = 0; tries < 4; tries += 1) {
    try {
      const result = await pool.query(
        `INSERT INTO host_device (label, install_id_hash, device_secret_hash, pairing_code, pairing_expires_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING id, label, pairing_code, pairing_expires_at`,
        [label.slice(0, 120), sha256(installId), sha256(deviceSecret), pairingCode, expiresAt],
      );
      return {
        deviceId: result.rows[0].id as string,
        deviceSecret,
        label: result.rows[0].label as string,
        pairingCode: result.rows[0].pairing_code as string,
        pairingExpiresAt: result.rows[0].pairing_expires_at as string,
      };
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code !== '23505') throw err;
      pairingCode = randomCode();
    }
  }

  throw new Error('could not allocate host pairing code');
}

export async function authorizeHostDevice(pairingCode: string, userId: string): Promise<{ id: string; label: string } | null> {
  const result = await pool.query(
    `UPDATE host_device
     SET authorized_user_id = $2,
         status = 'authorized',
         pairing_code = NULL,
         pairing_expires_at = NULL,
         authorized_at = NOW(),
         revoked_at = NULL
     WHERE pairing_code = $1
       AND status = 'pairing'
       AND pairing_expires_at > NOW()
     RETURNING id, label`,
    [pairingCode.toUpperCase(), userId],
  );
  if (result.rowCount === 0) return null;
  return { id: result.rows[0].id as string, label: result.rows[0].label as string };
}

export async function loadHostDeviceForApp(deviceId: string, deviceSecret: string) {
  const result = await pool.query(
    `SELECT id, label, authorized_user_id, status, pairing_expires_at, current_table_id, current_display_token
     FROM host_device
     WHERE id = $1 AND device_secret_hash = $2`,
    [deviceId, sha256(deviceSecret)],
  );
  return result.rows[0] ?? null;
}

export async function heartbeatHostDevice(deviceId: string, deviceSecret: string) {
  const device = await loadHostDeviceForApp(deviceId, deviceSecret);
  if (!device) return null;
  if (device.status === 'pairing' && device.pairing_expires_at && new Date(device.pairing_expires_at).getTime() <= Date.now()) {
    await pool.query(`UPDATE host_device SET status = 'expired' WHERE id = $1`, [deviceId]);
    return { ...device, status: 'expired' };
  }
  await pool.query(`UPDATE host_device SET last_seen_at = NOW() WHERE id = $1`, [deviceId]);
  return device;
}

export async function revokeHostDevice(deviceId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE host_device
     SET status = 'revoked',
         revoked_at = NOW(),
         current_table_id = NULL,
         current_display_token = NULL
     WHERE id = $1 AND authorized_user_id = $2 AND status = 'authorized'`,
    [deviceId, userId],
  );
  const revoked = (result.rowCount ?? 0) > 0;
  if (revoked) disconnectHostDeviceSockets(deviceId);
  return revoked;
}

export async function closeHostDeviceFromApp(deviceId: string, deviceSecret: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE host_device
     SET status = 'revoked',
         revoked_at = NOW(),
         current_table_id = NULL,
         current_display_token = NULL
     WHERE id = $1 AND device_secret_hash = $2 AND status IN ('pairing', 'authorized')`,
    [deviceId, sha256(deviceSecret)],
  );
  const closed = (result.rowCount ?? 0) > 0;
  if (closed) disconnectHostDeviceSockets(deviceId);
  return closed;
}

export async function listUserHostDevices(userId: string) {
  await pool.query(
    `UPDATE host_device
     SET status = 'revoked',
         revoked_at = COALESCE(revoked_at, NOW()),
         current_table_id = NULL,
         current_display_token = NULL
     WHERE authorized_user_id = $1
       AND status = 'authorized'
       AND last_seen_at <= NOW() - INTERVAL '90 seconds'`,
    [userId],
  );

  const result = await pool.query(
    `SELECT id, label, status, last_seen_at, current_table_id, created_at, authorized_at
     FROM host_device
     WHERE authorized_user_id = $1 AND status = 'authorized'
     ORDER BY COALESCE(last_seen_at, authorized_at, created_at) DESC`,
    [userId],
  );
  return result.rows.map((row) => ({
    id: row.id as string,
    label: row.label as string,
    status: row.status as string,
    online: row.last_seen_at ? Date.now() - new Date(row.last_seen_at).getTime() <= ONLINE_WINDOW_MS : false,
    lastSeenAt: row.last_seen_at as string | null,
    currentTableId: row.current_table_id as string | null,
    createdAt: row.created_at as string,
    authorizedAt: row.authorized_at as string | null,
  }));
}

export async function attachHostDeviceToTable(deviceId: string, userId: string, tableId: string): Promise<string | null> {
  const displayToken = issueDisplayToken(tableId, deviceId);
  const result = await pool.query(
    `UPDATE host_device
     SET current_table_id = $3,
         current_display_token = $4
     WHERE id = $1
       AND authorized_user_id = $2
       AND status = 'authorized'
       AND last_seen_at > NOW() - INTERVAL '45 seconds'
     RETURNING id`,
    [deviceId, userId, tableId, displayToken],
  );
  if (result.rowCount === 0) return null;
  return displayToken;
}

export async function isHostDisplayTokenActive(hostDeviceId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM host_device
     WHERE id = $1
       AND status = 'authorized'
       AND current_display_token IS NOT NULL
       AND last_seen_at > NOW() - INTERVAL '60 seconds'`,
    [hostDeviceId],
  );
  return (result.rowCount ?? 0) > 0;
}

function disconnectHostDeviceSockets(hostDeviceId: string): void {
  const io = getIO();
  if (!io) return;
  for (const socket of io.sockets.sockets.values()) {
    if ((socket.data as { hostDeviceId?: string }).hostDeviceId === hostDeviceId) socket.disconnect(true);
  }
}

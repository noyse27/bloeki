import { Router } from 'express';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth';
import {
  attachHostDeviceToTable,
  authorizeHostDevice,
  closeHostDeviceFromApp,
  createHostDevicePairing,
  heartbeatHostDevice,
  listUserHostDevices,
  revokeHostDevice,
} from '../services/hostDevices';
import { pool } from '../db/pool';

export const hostDevicesRouter = Router();

hostDevicesRouter.post('/host-devices/pairings', async (req, res) => {
  const { label, installId } = req.body ?? {};
  if (typeof label !== 'string' || typeof installId !== 'string' || installId.length < 16) {
    res.status(400).json({ error: 'label and installId are required' });
    return;
  }

  const pairing = await createHostDevicePairing(label, installId);
  res.status(201).json(pairing);
});

hostDevicesRouter.post('/host-devices/authorize', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { pairingCode } = req.body ?? {};
  if (typeof pairingCode !== 'string') {
    res.status(400).json({ error: 'pairingCode is required' });
    return;
  }

  const device = await authorizeHostDevice(pairingCode.trim(), req.userId as string);
  if (!device) {
    res.status(404).json({ error: 'pairing code not found or expired' });
    return;
  }
  res.status(200).json({ device });
});

hostDevicesRouter.get('/host-devices/app/:deviceId', async (req, res) => {
  const deviceSecret = req.header('X-Host-Device-Secret');
  if (!deviceSecret) {
    res.status(401).json({ error: 'missing host device secret' });
    return;
  }

  const device = await heartbeatHostDevice(req.params.deviceId, deviceSecret);
  if (!device) {
    res.status(404).json({ error: 'host device not found' });
    return;
  }
  if (device.status === 'revoked' || device.status === 'expired') {
    res.status(401).json({ error: 'host device revoked' });
    return;
  }

  res.status(200).json({
    id: device.id,
    label: device.label,
    status: device.status,
    authorized: device.status === 'authorized' && Boolean(device.authorized_user_id),
    currentTableId: device.current_table_id ?? null,
    displayToken: device.current_display_token ?? null,
  });
});

hostDevicesRouter.delete('/host-devices/app/:deviceId', async (req, res) => {
  const deviceSecret = req.header('X-Host-Device-Secret');
  if (!deviceSecret) {
    res.status(401).json({ error: 'missing host device secret' });
    return;
  }
  await closeHostDeviceFromApp(req.params.deviceId, deviceSecret);
  res.status(204).send();
});

hostDevicesRouter.get('/users/me/host-devices', requireAuth, async (req: AuthenticatedRequest, res) => {
  res.status(200).json({ devices: await listUserHostDevices(req.userId as string) });
});

hostDevicesRouter.delete('/users/me/host-devices/:deviceId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const revoked = await revokeHostDevice(req.params.deviceId, req.userId as string);
  if (!revoked) {
    res.status(404).json({ error: 'host device not found' });
    return;
  }
  res.status(204).send();
});

hostDevicesRouter.get('/host-devices/available', requireAuth, async (req: AuthenticatedRequest, res) => {
  res.status(200).json({ devices: (await listUserHostDevices(req.userId as string)).filter((device) => device.online) });
});

hostDevicesRouter.post('/tables/:tableId/host-device', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { deviceId } = req.body ?? {};
  if (typeof deviceId !== 'string') {
    res.status(400).json({ error: 'deviceId is required' });
    return;
  }

  const tableResult = await pool.query(`SELECT visibility, owner_user_id FROM game_table WHERE id = $1`, [req.params.tableId]);
  const table = tableResult.rows[0];
  if (!table) {
    res.status(404).json({ error: 'table not found' });
    return;
  }
  if (table.visibility !== 'private' || table.owner_user_id !== req.userId) {
    res.status(403).json({ error: 'host app only available to the owner of a private table' });
    return;
  }

  const displayToken = await attachHostDeviceToTable(deviceId, req.userId as string, req.params.tableId);
  if (!displayToken) {
    res.status(404).json({ error: 'active host device not found' });
    return;
  }

  res.status(200).json({ tableId: req.params.tableId, displayToken });
});

import { promises as fs } from 'fs';
import path from 'path';
import { deleteSetting, getSetting, setSetting } from './systemSettings';

const SETTING_KEY = 'trailer_clip_dir';

export class TrailerLibraryPathError extends Error {}

export interface TrailerLibraryConfig {
  configured: boolean;
  path: string | null;
  hostPath: string | null;
  source: 'environment' | 'database' | 'unset';
  editable: boolean;
}

export async function getTrailerLibraryConfig(): Promise<TrailerLibraryConfig> {
  const hostPath = process.env.TRAILER_CLIP_HOST_DIR?.trim() || null;
  const environmentPath = process.env.TRAILER_CLIP_DIR?.trim();
  if (environmentPath) {
    return {
      configured: true,
      path: path.resolve(environmentPath),
      hostPath,
      source: 'environment',
      editable: false,
    };
  }
  const storedPath = await getSetting(SETTING_KEY);
  if (storedPath) {
    return { configured: true, path: storedPath, hostPath, source: 'database', editable: true };
  }
  return { configured: false, path: null, hostPath, source: 'unset', editable: true };
}

export function normalizeTrailerLibraryPath(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 1024) {
    throw new TrailerLibraryPathError('Bibliothekspfad fehlt oder ist zu lang.');
  }
  return path.resolve(value.trim());
}

export async function inspectTrailerLibraryPath(storedPath: string): Promise<string> {
  const resolved = path.resolve(storedPath);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new TrailerLibraryPathError('Der Bibliothekspfad ist kein lesbares Verzeichnis.');
  }
  try {
    await fs.access(resolved, fs.constants.R_OK);
  } catch {
    throw new TrailerLibraryPathError('Der Bibliothekspfad ist kein lesbares Verzeichnis.');
  }
  return resolved;
}

export async function saveTrailerLibraryPath(value: unknown): Promise<string> {
  if (process.env.TRAILER_CLIP_DIR?.trim()) {
    throw new TrailerLibraryPathError('Der Bibliothekspfad wird durch TRAILER_CLIP_DIR vorgegeben.');
  }
  const resolved = normalizeTrailerLibraryPath(value);
  await setSetting(SETTING_KEY, resolved);
  return resolved;
}

export async function restoreTrailerLibraryPath(previousPath: string | null): Promise<void> {
  if (previousPath) await setSetting(SETTING_KEY, previousPath);
  else await deleteSetting(SETTING_KEY);
}

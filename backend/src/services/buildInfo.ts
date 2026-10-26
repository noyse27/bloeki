import fs from 'fs';
import path from 'path';

const FALLBACK_BUILD_VERSION = '0.1.0-beta_dev';

function readBuildVersion(): string {
  if (process.env.BLOEKI_BUILD_VERSION) return process.env.BLOEKI_BUILD_VERSION;
  try {
    return fs.readFileSync(path.join(__dirname, '..', 'build-version.txt'), 'utf8').trim() || FALLBACK_BUILD_VERSION;
  } catch {
    return FALLBACK_BUILD_VERSION;
  }
}

export const BUILD_VERSION = readBuildVersion();

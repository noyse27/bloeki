/* eslint-disable @typescript-eslint/no-var-requires */
const { spawnSync } = require('child_process');
const path = require('path');
const { Pool } = require('pg');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', 'db', 'postgres']);
const DEFAULT_TEST_DATABASE_URL = 'postgres://bloeki:bloeki@localhost:15532/bloeki_test';

const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendRoot, '..');

function parseDatabaseUrl(connectionString) {
  try {
    return new URL(connectionString);
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid Postgres connection string.');
  }
}

function assertDisposableLocalDatabase(url) {
  const database = url.pathname.replace(/^\//, '');

  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `Refusing to run integration tests against host "${url.hostname}". ` +
        'Use a local disposable database, for example localhost:15532/bloeki_test.',
    );
  }

  if (!/(^|[_-])test($|[_-])/i.test(database)) {
    throw new Error(
      `Refusing to run integration tests against database "${database}". ` +
        'Use a database name that clearly marks it as disposable, for example bloeki_test.',
    );
  }
}

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function ensureDatabaseExists(testDatabaseUrl) {
  const testUrl = parseDatabaseUrl(testDatabaseUrl);
  assertDisposableLocalDatabase(testUrl);

  const database = testUrl.pathname.replace(/^\//, '');
  const maintenanceUrl = new URL(testUrl.toString());
  maintenanceUrl.pathname = '/postgres';

  const pool = new Pool({ connectionString: maintenanceUrl.toString() });

  try {
    const result = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if ((result.rowCount ?? 0) > 0) {
      console.log(`integration: using existing disposable database "${database}"`);
      return;
    }

    await pool.query(`CREATE DATABASE ${quoteIdentifier(database)}`);
    console.log(`integration: created disposable database "${database}"`);
  } finally {
    await pool.end();
  }
}

function runNodeScript(scriptPath, args, env) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: backendRoot,
    env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function main() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  const safeProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => value !== undefined && !key.startsWith('=')),
  );
  const env = {
    ...safeProcessEnv,
    DATABASE_URL: testDatabaseUrl,
  };

  await ensureDatabaseExists(testDatabaseUrl);
  runNodeScript(path.join(repoRoot, 'node_modules', 'node-pg-migrate', 'bin', 'node-pg-migrate.js'), ['up'], env);
  runNodeScript(path.join(repoRoot, 'node_modules', 'jest', 'bin', 'jest.js'), ['--selectProjects', 'integration'], env);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

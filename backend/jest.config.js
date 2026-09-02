/** @type {import('jest').Config} */
module.exports = {
  // Integration tests share one Postgres instance and include invariants
  // that only hold with a single admin account (bootstrap), so they must
  // not run across parallel workers.
  maxWorkers: 1,
  // Round/token/bonus timers and rejoin-grace checks use real setTimeout
  // calls; ones scheduled far in the future (e.g. production-default
  // REJOIN_GRACE_MS) can still be pending harmlessly after a test file's
  // assertions and its own afterAll(pool.end()) are done. Without this,
  // Jest waits on the open handle instead of exiting.
  forceExit: true,
  projects: [
    {
      displayName: 'unit',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/unit/**/*.test.ts'],
    },
    {
      displayName: 'integration',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/integration/**/*.test.ts'],
      globalSetup: '<rootDir>/test/integration/globalSetup.js',
    },
  ],
};

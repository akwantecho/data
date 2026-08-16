/**
 * Integration/e2e configuration — requires a reachable PostgreSQL instance
 * (DATABASE_URL). Run with `pnpm --filter @sip/api test:e2e`.
 */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: 'test/.*\\.e2e-spec\\.ts$',
  // Must run before the app module is imported: ConfigModule validates eagerly.
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  testTimeout: 30000,
};

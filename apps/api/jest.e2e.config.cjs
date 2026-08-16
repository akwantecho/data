/**
 * Integration/e2e configuration — requires a reachable PostgreSQL instance
 * (DATABASE_URL). Run with `pnpm --filter @sip/api test:e2e`.
 */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: 'test/.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  testTimeout: 30000,
};

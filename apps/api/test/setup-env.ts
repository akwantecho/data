/**
 * Runs before the test file — and therefore before `ConfigModule.forRoot()`,
 * which validates the environment eagerly when `app.module.ts` is imported.
 *
 * Rate limiting is off for integration tests because a suite signs in far more
 * often than a real client would. `rate-limit.e2e-spec.ts` turns it back on and
 * imports the app afterwards.
 */
process.env.NODE_ENV ??= 'test';
process.env.THROTTLE_ENABLED = 'false';

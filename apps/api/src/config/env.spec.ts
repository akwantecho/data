import { parseCorsOrigins, validateEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
};

describe('environment validation', () => {
  it('applies defaults for optional variables', () => {
    const env = validateEnv(base);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.API_PREFIX).toBe('api');
    expect(env.RATE_LIMIT).toBe(120);
    expect(env.JWT_ACCESS_TTL).toBe(900);
    expect(env.JWT_REFRESH_TTL).toBe(604_800);
    expect(env.COOKIE_SECURE).toBe(false);
  });

  it('rejects a missing DATABASE_URL', () => {
    const { DATABASE_URL: _omitted, ...withoutDatabase } = base;

    expect(() => validateEnv(withoutDatabase)).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => validateEnv({ ...base, PORT: 'not-a-port' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('coerces PORT from a string', () => {
    expect(validateEnv({ ...base, PORT: '8080' }).PORT).toBe(8080);
  });

  it('splits and trims CORS origins', () => {
    const env = validateEnv({ ...base, CORS_ORIGINS: 'http://a.test, http://b.test ,' });

    expect(parseCorsOrigins(env.CORS_ORIGINS)).toEqual(['http://a.test', 'http://b.test']);
  });

  describe('authentication settings', () => {
    it('requires both signing secrets', () => {
      const { JWT_ACCESS_SECRET: _access, ...withoutAccess } = base;

      expect(() => validateEnv(withoutAccess)).toThrow(/JWT_ACCESS_SECRET/);
    });

    it('rejects a short signing secret', () => {
      expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'too-short' })).toThrow(
        /at least 32 characters/,
      );
    });

    it('rejects reusing one secret for both tokens', () => {
      const secret = 'c'.repeat(48);

      expect(() =>
        validateEnv({ ...base, JWT_ACCESS_SECRET: secret, JWT_REFRESH_SECRET: secret }),
      ).toThrow(/must differ/);
    });

    it('rejects an access token that outlives the refresh token', () => {
      expect(() => validateEnv({ ...base, JWT_ACCESS_TTL: '600', JWT_REFRESH_TTL: '300' })).toThrow(
        /shorter than JWT_REFRESH_TTL/,
      );
    });

    it('refuses insecure cookies in production', () => {
      expect(() =>
        validateEnv({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'false' }),
      ).toThrow(/COOKIE_SECURE must be true in production/);
    });

    it('accepts secure cookies in production', () => {
      const env = validateEnv({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'true' });

      expect(env.COOKIE_SECURE).toBe(true);
    });
  });
});

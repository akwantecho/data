import { parseCorsOrigins, validateEnv } from './env';

describe('environment validation', () => {
  const base = { DATABASE_URL: 'postgresql://user:pass@localhost:5432/db' };

  it('applies defaults for optional variables', () => {
    const env = validateEnv(base);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.API_PREFIX).toBe('api');
    expect(env.RATE_LIMIT).toBe(120);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
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
});

import { z } from 'zod';

/**
 * Environment contract. The API refuses to boot with an invalid environment —
 * failing loudly at startup is preferable to leaking misconfiguration at runtime.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().default('api'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** Comma separated list of allowed browser origins. */
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  /** Requests per minute per IP (plan §44: rate limiting). */
  RATE_LIMIT: z.coerce.number().int().positive().default(120),
  /**
   * Escape hatch for integration tests, which sign in far more often than a real
   * client. Never disable outside tests — see the production check below.
   */
  THROTTLE_ENABLED: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .default(true)
    .transform((value) => value === true || value === 'true'),
  LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),

  /**
   * Signing secrets. No defaults on purpose: a fallback secret that works in
   * development inevitably reaches production. Generate with
   * `openssl rand -base64 48`.
   */
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  /** Access token lifetime in seconds (default 15 minutes). */
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  /** Refresh token lifetime in seconds (default 7 days). */
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(604_800),
  /** Set false only for local HTTP development; cookies are Secure everywhere else. */
  COOKIE_SECURE: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .default(false)
    .transform((value) => value === true || value === 'true'),
  COOKIE_DOMAIN: z.string().optional(),
});

/**
 * Cross-field rules that only make sense once every value is known.
 * These are the misconfigurations that silently weaken authentication.
 */
export const environmentSchema = envSchema.superRefine((env, ctx) => {
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    ctx.addIssue({
      code: 'custom',
      path: ['JWT_REFRESH_SECRET'],
      message: 'JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET',
    });
  }

  if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
    ctx.addIssue({
      code: 'custom',
      path: ['COOKIE_SECURE'],
      message: 'COOKIE_SECURE must be true in production',
    });
  }

  if (env.NODE_ENV === 'production' && !env.THROTTLE_ENABLED) {
    ctx.addIssue({
      code: 'custom',
      path: ['THROTTLE_ENABLED'],
      message: 'THROTTLE_ENABLED cannot be false in production',
    });
  }

  if (env.JWT_ACCESS_TTL >= env.JWT_REFRESH_TTL) {
    ctx.addIssue({
      code: 'custom',
      path: ['JWT_ACCESS_TTL'],
      message: 'JWT_ACCESS_TTL must be shorter than JWT_REFRESH_TTL',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = environmentSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return parsed.data;
}

/** Turns the comma separated CORS_ORIGINS value into an allow-list. */
export function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

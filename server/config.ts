import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.url(),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
  ADMIN_SETUP_TOKEN: z.string().min(32).max(256),
  DATABASE_SSL: z.enum(['true', 'false']).default('false'),
  DATABASE_CA_FILE: z.string().optional(),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
});

export interface Config {
  production: boolean;
  port: number;
  origin: string;
  databaseUrl: string;
  setupToken: string;
  databaseSsl: boolean;
  databaseCaFile?: string;
  trustProxyHops: number;
  sessionHours: number;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    // Report field names, never values (URLs and setup tokens are secrets).
    throw new Error(`Invalid environment: ${result.error.issues.map(i => i.path.join('.')).join(', ')}`);
  }
  const e = result.data;
  const url = new URL(e.APP_ORIGIN);
  if (url.origin !== e.APP_ORIGIN || url.username || url.password) throw new Error('APP_ORIGIN must be an origin without a path or trailing slash');
  if (e.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('Production requires HTTPS APP_ORIGIN');
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('APP_ORIGIN must use HTTP or HTTPS');
  return {
    production: e.NODE_ENV === 'production', port: e.PORT, origin: url.origin,
    databaseUrl: e.DATABASE_URL, setupToken: e.ADMIN_SETUP_TOKEN,
    databaseSsl: e.DATABASE_SSL === 'true', databaseCaFile: e.DATABASE_CA_FILE,
    trustProxyHops: e.TRUST_PROXY_HOPS, sessionHours: 12,
  };
}

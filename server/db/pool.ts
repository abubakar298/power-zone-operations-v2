import pg from 'pg';
import { readFileSync } from 'node:fs';
import type { Config } from '../config.js';

export function createPool(config: Config) {
  return new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? {
      rejectUnauthorized: true,
      ...(config.databaseCaFile ? { ca: readFileSync(config.databaseCaFile, 'utf8') } : {}),
    } : false,
    max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
    statement_timeout: 10000, application_name: 'power-zone-v2',
  });
}

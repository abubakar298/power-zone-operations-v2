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
    // Bound avoidable per-query memory on the small production database.
    // Startup options apply to every newly opened pooled connection.
    options: '-c jit=off -c work_mem=1MB -c max_parallel_workers_per_gather=0',
    max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
    statement_timeout: 10000, application_name: 'power-zone-v2',
  });
}

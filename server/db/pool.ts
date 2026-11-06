import pg from 'pg';
import { readFileSync } from 'node:fs';
import type { Config } from '../config.js';

export function createPool(config: Config) {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? {
      rejectUnauthorized: true,
      ...(config.databaseCaFile ? { ca: readFileSync(config.databaseCaFile, 'utf8') } : {}),
    } : false,
    // Bound avoidable per-query memory on the small production database.
    // Startup options apply to every newly opened pooled connection.
    options: '-c jit=off -c work_mem=1MB -c max_parallel_workers_per_gather=0',
    max: 4, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000,
    statement_timeout: 10000, application_name: 'power-zone-v2',
  });
  // pg-pool handles idle-client errors, but checked-out clients can also lose
  // their connection between queries while a transaction is doing async work.
  // Keep that event from terminating Node; the query/transaction still fails
  // and PostgreSQL rolls its transaction back. Never retry a business command.
  pool.on('connect', client => client.on('error', error => {
    console.error(JSON.stringify({event:'database.client.disconnected',code:(error as Error & {code?:string}).code??'CONNECTION_CLOSED'}));
  }));
  return pool;
}

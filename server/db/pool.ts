import pg from 'pg';
import { readFileSync } from 'node:fs';
import type { Config } from '../config.js';

export function databaseStartupOptions(config: Pick<Config,'databaseWorkMem'|'databaseParallelWorkersPerGather'>) {
  return `-c jit=off -c work_mem=${config.databaseWorkMem} -c max_parallel_workers_per_gather=${config.databaseParallelWorkersPerGather}`;
}

export function createPool(config: Config) {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? {
      rejectUnauthorized: true,
      ...(config.databaseCaFile ? { ca: readFileSync(config.databaseCaFile, 'utf8') } : {}),
    } : false,
    // Per-query memory, parallel workers and pool size come from the
    // environment (DATABASE_WORK_MEM, DATABASE_MAX_PARALLEL_WORKERS_PER_GATHER,
    // DATABASE_POOL_MAX). Startup options apply to every newly opened pooled connection.
    options: databaseStartupOptions(config),
    max: config.databasePoolMax, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000,
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

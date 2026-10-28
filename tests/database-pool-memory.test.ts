import test from 'node:test';
import assert from 'node:assert/strict';
import type {PoolClient} from 'pg';
import {createPool} from '../server/db/pool.js';
import {readConfig} from '../server/config.js';
import {testDatabase} from './database.js';

test('application pool bounds query memory on every connection and reuse', async () => {
  const db = await testDatabase({skipMigrations:true});
  const pool = createPool(readConfig({
    NODE_ENV:'test', APP_ORIGIN:'http://127.0.0.1:3199',
    DATABASE_URL:db.url, DATABASE_SSL:'false',
    ADMIN_SETUP_TOKEN:'isolated-pool-memory-test-only-000000',
  }));
  const clients:PoolClient[]=[];
  try {
    // Hold both connections simultaneously so this proves initialization of
    // separate backends rather than two queries on the same idle connection.
    clients.push(await pool.connect(),await pool.connect());
    const settings=await Promise.all(clients.map(c=>c.query(`SELECT pg_backend_pid() AS pid,
      current_setting('jit') AS jit, current_setting('work_mem') AS work_mem,
      current_setting('max_parallel_workers_per_gather') AS parallel_workers,
      current_setting('statement_timeout') AS statement_timeout`)));
    assert.notEqual(settings[0].rows[0].pid,settings[1].rows[0].pid);
    for(const result of settings){
      const {pid,...values}=result.rows[0];
      assert.deepEqual(values,{jit:'off',work_mem:'1MB',parallel_workers:'0',statement_timeout:'10s'});
    }
    for(const c of clients.splice(0))c.release();
    const reused=await pool.query(`SELECT current_setting('jit') AS jit,
      current_setting('work_mem') AS work_mem,
      current_setting('max_parallel_workers_per_gather') AS parallel_workers,
      (SELECT sum(value) FROM generate_series(1,100) AS s(value))::text AS total`);
    assert.deepEqual(reused.rows[0],{jit:'off',work_mem:'1MB',parallel_workers:'0',total:'5050'});
  } finally {
    for(const c of clients)c.release();
    await pool.end();
    await db.close();
  }
});

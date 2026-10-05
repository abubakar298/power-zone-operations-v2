import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { migrate } from '../server/db/migrate.js';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

export async function testDatabase() {
  // Refuse to use production credentials: tests always own an isolated disposable cluster.
  const directory = await mkdtemp(join(tmpdir(), 'pz-v2-test-'));
  const socket = createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('No available test port');
  const port = address.port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  if (process.env.TEST_PGLITE === 'true') {
    // Explicit sandbox-only fallback; the production API still uses pg over TCP.
    // Native PostgreSQL remains the default test backend and is required by CI.
    const database = await PGlite.create(join(directory,'pglite'));
    const server = new PGLiteSocketServer({db:database,port,host:'127.0.0.1',maxConnections:20});
    await server.start();
    const url = `postgresql://postgres@127.0.0.1:${port}/postgres`;
    const pool = new pg.Pool({connectionString:url,max:5});
    await migrate(pool);
    return {pool,url,async close() {await pool.end();await server.stop();await database.close();await rm(directory,{recursive:true,force:true});}};
  }
  const postgres = new EmbeddedPostgres({
    databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-test-only',
    persistent: false, authMethod: 'scram-sha-256', postgresFlags: ['-h', '127.0.0.1'],
    initdbFlags: ['--locale=C', '--encoding=UTF8', '-c', 'shared_memory_type=mmap', '-c', 'dynamic_shared_memory_type=mmap'],
    onLog: () => {}, onError: message => console.error(message),
  });
  try {
    await postgres.initialise(); await postgres.start(); await postgres.createDatabase('power_zone_test');
    const url = `postgresql://postgres:isolated-test-only@127.0.0.1:${port}/power_zone_test`;
    const pool = new pg.Pool({ connectionString: url, max: 5 });
    await migrate(pool);
    return { pool, url, async close() { await pool.end(); await postgres.stop(); await rm(directory, {recursive: true, force: true}); } };
  } catch (error) {
    await postgres.stop().catch(() => {});
    await rm(directory, {recursive: true, force: true});
    throw error;
  }
}

import EmbeddedPostgres from 'embedded-postgres';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

// Development only. Production always uses the configured external PostgreSQL service.
await mkdir('.local', {recursive: true});
const pg = new EmbeddedPostgres({
  databaseDir: resolve('.local/postgres'), user: 'postgres', password: 'local-development-only',
  port: 55432, persistent: true, authMethod: 'scram-sha-256',
  initdbFlags: ['--locale=C', '--encoding=UTF8', '-c', 'shared_memory_type=mmap', '-c', 'dynamic_shared_memory_type=mmap'],
  postgresFlags: ['-h', '127.0.0.1'], onLog: () => {}, onError: message => console.error(message),
});
await pg.initialise();
await pg.start();
const client = pg.getPgClient();
await client.connect();
const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = 'power_zone'");
await client.end();
if (!exists.rowCount) await pg.createDatabase('power_zone');
console.log('Local PostgreSQL ready on 127.0.0.1:55432. Stop with Ctrl+C.');
let closing = false;
async function stop() { if (closing) return; closing = true; await pg.stop(); process.exit(0); }
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });

import { resolve } from 'node:path';
import { readConfig } from './config.js';
import { createPool } from './db/pool.js';
import { createApp } from './app.js';
import { AuthRepository } from './auth/repository.js';

const config = readConfig();
const pool = createPool(config);
pool.on('error', () => console.error('Database connection interrupted.'));
const app = createApp(pool, config, resolve('dist/web'));
const server = app.listen(config.port, '0.0.0.0', () => console.log(`Power Zone V2 listening on port ${config.port}`));
const repository = new AuthRepository(pool);
const cleanup = setInterval(() => { void repository.cleanup().catch(() => console.error('Session cleanup failed.')); }, 15 * 60 * 1000);
cleanup.unref();
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(cleanup);
  const timeout = setTimeout(() => { console.error('Shutdown timed out.'); process.exit(1); }, 10000).unref();
  server.close(() => { void pool.end().finally(() => { clearTimeout(timeout); }); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

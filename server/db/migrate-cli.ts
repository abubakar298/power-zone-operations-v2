import { readConfig } from '../config.js';
import { createPool } from './pool.js';
import { migrate } from './migrate.js';

const pool = createPool(readConfig());
try { await migrate(pool); console.log('Database migrations are up to date.'); }
catch { console.error('Database migration failed. Check database access and migration history.'); process.exitCode = 1; }
finally { await pool.end(); }
